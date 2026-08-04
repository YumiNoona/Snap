mod capture;
mod audio;
mod input_hook;
mod export;

use serde::Serialize;
use std::sync::Mutex;
use tauri::Emitter;
use tauri::Manager;

/// Pending video/log paths handed to the dedicated editor window.
struct EditorPaths(Mutex<Option<(String, String)>>);

/// Open the editor in its own dedicated window. Reuses the window if it
/// already exists; otherwise creates it centered with the custom titlebar.
#[tauri::command]
fn open_editor_window(
    app: tauri::AppHandle,
    state: tauri::State<EditorPaths>,
    video: String,
    log: String,
) -> Result<(), String> {
    *state.0.lock().map_err(|e| e.to_string())? = Some((video.clone(), log.clone()));

    if let Some(win) = app.get_webview_window("editor") {
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.emit("editor-open", (video, log));
        return Ok(());
    }

    tauri::WebviewWindowBuilder::new(&app, "editor", tauri::WebviewUrl::App("index.html".into()))
        .title("Snap Editor")
        .inner_size(1360.0, 860.0)
        .min_inner_size(980.0, 640.0)
        .center()
        .decorations(false)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_pending_editor_paths(state: tauri::State<EditorPaths>) -> Result<(String, String), String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "No editor paths pending".to_string())
}

#[derive(Serialize)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
}

#[tauri::command]
fn read_text_file(path: String) -> std::result::Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Cannot read {path}: {e}"))
}

#[tauri::command]
fn open_explorer(path: String) -> std::result::Result<(), String> {
    std::process::Command::new("explorer")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Cannot open explorer: {e}"))?;
    Ok(())
}

#[derive(Serialize)]
struct CursorPackState {
    name: String,
    path: String,
    url: String,
}

#[derive(Serialize)]
struct CursorPack {
    name: String,
    label: String,
    pointer_path: String,
    pointer_url: String,
    states: Vec<CursorPackState>,
}

fn resolve_cursors_dir() -> Option<std::path::PathBuf> {
    let candidates = [
        std::env::current_dir().ok()?.join("public").join("Cursors"),
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("public")
            .join("Cursors"),
    ];
    candidates.into_iter().find(|p| p.is_dir())
}

#[derive(Serialize)]
struct WallpaperEntry {
    name: String,
    path: String,
    url: String,
}

const WALLPAPER_EXTENSIONS: [&str; 6] = ["png", "jpg", "jpeg", "webp", "bmp", "gif"];

fn resolve_wallpapers_dir() -> Option<std::path::PathBuf> {
    let candidates = [
        std::env::current_dir().ok()?.join("public").join("Wallpapers"),
        std::env::current_dir().ok()?.join("public").join("wallpapers"),
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("public")
            .join("Wallpapers"),
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("public")
            .join("wallpapers"),
    ];
    candidates.into_iter().find(|p| p.is_dir())
}

/// Enumerate wallpaper images under public/Wallpapers/ (png/jpg/jpeg/webp/bmp/gif).
#[tauri::command]
fn list_wallpaper_images() -> std::result::Result<Vec<WallpaperEntry>, String> {
    let dir =
        resolve_wallpapers_dir().ok_or_else(|| "public/Wallpapers directory not found".to_string())?;
    let mut entries: Vec<WallpaperEntry> = Vec::new();

    for entry in std::fs::read_dir(&dir).map_err(|e| format!("Cannot read {}: {e}", dir.display()))? {
        let entry = entry.map_err(|e| format!("Cannot read dir entry: {e}"))?;
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let ext = entry
            .path()
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if !WALLPAPER_EXTENSIONS.contains(&ext.as_str()) {
            continue;
        }
        entries.push(WallpaperEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            url: format!("/Wallpapers/{}", entry.file_name().to_string_lossy()),
        });
    }

    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(entries)
}

fn pack_label(name: &str) -> String {
    name.split(['-', '_', ' '])
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Enumerate cursor packs under public/Cursors/<pack-name>/*.png.
/// Each subfolder is one selectable pack; `pointer.png` is preferred as the
/// active state, otherwise the first PNG found is used.
#[tauri::command]
fn list_cursor_packs() -> std::result::Result<Vec<CursorPack>, String> {
    let dir =
        resolve_cursors_dir().ok_or_else(|| "public/Cursors directory not found".to_string())?;
    let mut packs = Vec::new();

    for entry in std::fs::read_dir(&dir).map_err(|e| format!("Cannot read {}: {e}", dir.display()))? {
        let entry = entry.map_err(|e| format!("Cannot read dir entry: {e}"))?;
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }

        let pack_dir = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        let mut states: Vec<CursorPackState> = Vec::new();
        let mut pointer_path: Option<String> = None;
        let mut pointer_url: Option<String> = None;

        if let Ok(rd) = std::fs::read_dir(&pack_dir) {
            for f in rd.flatten() {
                if !f.file_type().map(|t| t.is_file()).unwrap_or(false) {
                    continue;
                }
                let ext = f
                    .path()
                    .extension()
                    .map(|e| e.to_string_lossy().to_lowercase())
                    .unwrap_or_default();
                if ext != "png" {
                    continue;
                }
                let fname = f.file_name().to_string_lossy().to_string();
                let path = f.path().to_string_lossy().to_string();
                let url = format!("/Cursors/{name}/{fname}");
                if pointer_path.is_none() && fname.to_lowercase() == "pointer.png" {
                    pointer_path = Some(path.clone());
                    pointer_url = Some(url.clone());
                }
                states.push(CursorPackState {
                    name: fname.clone(),
                    path,
                    url,
                });
            }
        }

        if states.is_empty() {
            continue;
        }

        states.sort_by(|a, b| a.name.cmp(&b.name));
        let pointer_path = pointer_path.unwrap_or_else(|| states[0].path.clone());
        let pointer_url = pointer_url.unwrap_or_else(|| states[0].url.clone());
        packs.push(CursorPack {
            label: pack_label(&name),
            name,
            pointer_path,
            pointer_url,
            states,
        });
    }

    packs.sort_by(|a, b| a.label.to_lowercase().cmp(&b.label.to_lowercase()));
    Ok(packs)
}

#[tauri::command]
fn list_directory(path: String) -> std::result::Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();
    let dir = std::fs::read_dir(&path)
        .map_err(|e| format!("Cannot read directory {path}: {e}"))?;
    for entry in dir {
        if let Ok(entry) = entry {
            let meta = entry.metadata().ok();
            entries.push(FileEntry {
                name: entry.file_name().to_string_lossy().to_string(),
                path: entry.path().to_string_lossy().to_string(),
                is_dir: meta.as_ref().map(|m| m.is_dir()).unwrap_or(false),
                size: meta.map(|m| m.len()).unwrap_or(0),
            });
        }
    }
    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(EditorPaths(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            capture::enumerate_targets,
            capture::get_target_bounds,
            capture::start_recording,
            capture::stop_recording,
            capture::get_videos_dir,
            audio::enumerate_audio_devices,
            audio::start_audio_capture,
            audio::stop_audio_capture,
            input_hook::start_input_logging,
            input_hook::stop_input_logging,
            export::export_video,
            open_editor_window,
            get_pending_editor_paths,
            read_text_file,
            list_directory,
            list_cursor_packs,
            list_wallpaper_images,
            open_explorer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
