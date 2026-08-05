mod capture;
mod audio;
mod input_hook;
mod export;

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::Emitter;
use tauri::Manager;

/// Pending video/log paths handed to the dedicated editor window.
struct EditorPaths(Mutex<Option<(String, String)>>);

/// Live state mirrored to the floating recording dock window.
struct DockState(Mutex<DockStateSnapshot>);

#[derive(Clone, Serialize, Deserialize)]
struct DockStateSnapshot {
    recording: bool,
    elapsed: u64,
    paused: bool,
    mic_muted: bool,
}

impl Default for DockStateSnapshot {
    fn default() -> Self {
        Self {
            recording: false,
            elapsed: 0,
            paused: false,
            mic_muted: false,
        }
    }
}

/// Open the editor window, hand it the recording, and focus it.
/// The window is created on demand (runtime) rather than predeclared hidden —
/// predeclared invisible windows can fail to display on some Windows setups.
#[tauri::command]
fn open_editor_window(
    app: tauri::AppHandle,
    state: tauri::State<EditorPaths>,
    video: String,
    log: String,
) -> Result<(), String> {
    *state.0.lock().map_err(|e| e.to_string())? = Some((video.clone(), log.clone()));

    if let Some(win) = app.get_webview_window("editor") {
        eprintln!("[Snap] open_editor_window: reusing existing editor window");
        let _ = win.emit("editor-open", (video, log));
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }

    eprintln!("[Snap] open_editor_window: creating editor window at runtime");
    let win = tauri::WebviewWindowBuilder::new(
        &app,
        "editor",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Snap Editor")
    .inner_size(1360.0, 860.0)
    .min_inner_size(980.0, 640.0)
    .center()
    .decorations(false)
    .devtools(true)
    .on_page_load(|_webview, payload| {
        eprintln!("[Snap Editor] page load: {:?} {:?}", payload.url(), payload.event());
    })
    .build()
    .map_err(|e| format!("Failed to create editor window: {e}"))?;

    eprintln!("[Snap] editor window created, emitting editor-open");
    win.emit("editor-open", (video.clone(), log.clone()))
        .map_err(|e| format!("Failed to notify editor window: {e}"))?;
    let _ = win.show();
    win.set_focus().map_err(|e| format!("Failed to focus editor window: {e}"))?;
    eprintln!("[Snap] Press F12 or right-click > Inspect on the editor window to view JS console errors");
    Ok(())
}

/// Open the standalone teleprompter as its own OS-level window (not a DOM overlay),
/// so it stays off-screen relative to the launcher and can be independently positioned.
#[tauri::command]
fn open_teleprompter_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("teleprompter") {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }

    let win = tauri::WebviewWindowBuilder::new(
        &app,
        "teleprompter",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Snap Teleprompter")
    .inner_size(620.0, 480.0)
    .min_inner_size(420.0, 320.0)
    .center()
    .decorations(false)
    .devtools(true)
    .always_on_top(true)
    .build()
    .map_err(|e| format!("Failed to create teleprompter window: {e}"))?;

    let _ = win.show();
    win.set_focus().map_err(|e| format!("Failed to focus teleprompter window: {e}"))?;
    eprintln!("[Snap] Press F12 or right-click > Inspect on the teleprompter window to view JS console errors");
    Ok(())
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

/// Show/hide the floating dock window, centered near the bottom of the
/// primary monitor so it floats above the desktop — independent of the
/// small launcher window.
#[tauri::command]
fn set_dock_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    let win = app
        .get_webview_window("dock")
        .ok_or_else(|| "Dock window not found".to_string())?;

    if visible {
        // Center above the bottom edge of the main window's monitor.
        if let Some(mon) = app
            .get_webview_window("main")
            .and_then(|m| m.current_monitor().ok())
            .flatten()
        {
            let scale = mon.scale_factor();
            let logical_w = (mon.size().width as f64 / scale) as i32;
            let logical_h = (mon.size().height as f64 / scale) as i32;
            let logical_x = (mon.position().x as f64 / scale) as i32;
            let logical_y = (mon.position().y as f64 / scale) as i32;
            let x0 = logical_x + (logical_w - 460) / 2;
            let y0 = logical_y + logical_h - 74 - 48;
            let _ = win.set_position(tauri::LogicalPosition::new(x0 as f64, y0 as f64));
        }
        let _ = win.show();
    } else {
        let _ = win.hide();
    }

    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("dock-visibility", visible);
    }
    Ok(())
}

/// Mirror the latest recording state to the dock window.
#[tauri::command]
fn update_dock_state(
    app: tauri::AppHandle,
    state: tauri::State<DockState>,
    snapshot: DockStateSnapshot,
) -> Result<(), String> {
    *state.0.lock().map_err(|e| e.to_string())? = snapshot.clone();
    if let Some(dock) = app.get_webview_window("dock") {
        let _ = dock.emit("dock-state", snapshot);
    }
    Ok(())
}

#[tauri::command]
fn get_dock_state(state: tauri::State<DockState>) -> Result<DockStateSnapshot, String> {
    Ok(state.0.lock().map_err(|e| e.to_string())?.clone())
}

/// Relay a dock button action (stop / pause / mic) to the launcher window.
#[tauri::command]
fn dock_action(app: tauri::AppHandle, action: String) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("dock-action", action);
    }
    Ok(())
}

#[derive(Clone, Serialize, Deserialize)]
struct OverlayRegion {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

/// Last shown overlay appearance (style + region) so a pause toggle can
/// re-emit the state without the frontend re-sending coordinates.
static OVERLAY_APPEARANCE: Mutex<Option<(String, Option<OverlayRegion>)>> = Mutex::new(None);

/// True while the recording is paused — the border renders green.
static OVERLAY_PAUSED: AtomicBool = AtomicBool::new(false);

/// Emit a countdown value (3, 2, 1, or null to clear) to the recorder-overlay
/// window so it renders full-screen, not clipped to the small launcher window.
#[tauri::command]
fn set_countdown(app: tauri::AppHandle, value: Option<u32>) -> Result<(), String> {
    let win = app
        .get_webview_window("recorder-overlay")
        .ok_or_else(|| "Overlay window not found".to_string())?;

    let payload = serde_json::json!({ "countdown": value });
    win.emit("countdown-state", payload)
        .map_err(|e| format!("Failed to emit countdown: {e}"))?;

    if value.is_some() {
        win.set_ignore_cursor_events(true)
            .map_err(|e| format!("Failed to set overlay click-through: {e}"))?;
        let _ = win.show();
    } else {
        let _ = win.hide();
    }

    Ok(())
}

#[tauri::command]
fn set_recording_overlay(
    app: tauri::AppHandle,
    enabled: bool,
    style: String,
    region: Option<OverlayRegion>,
) -> Result<(), String> {
    let win = app
        .get_webview_window("recorder-overlay")
        .ok_or_else(|| "Overlay window not found".to_string())?;

    if !enabled {
        OVERLAY_PAUSED.store(false, Ordering::SeqCst);
        if let Ok(mut guard) = OVERLAY_APPEARANCE.lock() {
            *guard = None;
        }
        let _ = win.set_ignore_cursor_events(false);
        let _ = win.hide();
        return Ok(());
    }

    let monitor = app
        .get_webview_window("main")
        .and_then(|m| m.current_monitor().ok())
        .flatten()
        .ok_or_else(|| "No monitor available".to_string())?;

    let scale = monitor.scale_factor();
    let logical_w = monitor.size().width as f64 / scale;
    let logical_h = monitor.size().height as f64 / scale;
    let logical_x = monitor.position().x as f64 / scale;
    let logical_y = monitor.position().y as f64 / scale;

    let _ = win.set_size(tauri::LogicalSize::new(logical_w, logical_h));
    let _ = win.set_position(tauri::LogicalPosition::new(logical_x, logical_y));

    let logical_region = region.map(|r| OverlayRegion {
        x: (r.x as f64 / scale).round() as i32,
        y: (r.y as f64 / scale).round() as i32,
        w: (r.w as f64 / scale).round() as i32,
        h: (r.h as f64 / scale).round() as i32,
    });

    if let Ok(mut guard) = OVERLAY_APPEARANCE.lock() {
        *guard = Some((style.clone(), logical_region.clone()));
    }

    let paused = OVERLAY_PAUSED.load(Ordering::SeqCst);
    let payload = serde_json::json!({
        "style": style,
        "region": logical_region,
        "paused": paused,
    });
    let _ = win.emit("overlay-state", payload);
    // Make the whole monitor overlay click-through — CSS pointer-events can't
    // do this at the OS level, so without this the overlay blocks every click.
    let _ = win.set_ignore_cursor_events(true);
    let _ = win.show();
    Ok(())
}

/// Flip the overlay between "recording" and "paused" appearance — the border
/// turns green while paused. Re-emits the current overlay state.
#[tauri::command]
fn set_overlay_paused(app: tauri::AppHandle, paused: bool) -> Result<(), String> {
    OVERLAY_PAUSED.store(paused, Ordering::SeqCst);
    let appearance = OVERLAY_APPEARANCE.lock().map_err(|e| e.to_string())?;
    if let Some((style, region)) = appearance.as_ref() {
        if let Some(win) = app.get_webview_window("recorder-overlay") {
            let payload = serde_json::json!({
                "style": style,
                "region": region,
                "paused": paused,
            });
            let _ = win.emit("overlay-state", payload);
        }
    }
    Ok(())
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
        .manage(DockState(Mutex::new(DockStateSnapshot::default())))
        .invoke_handler(tauri::generate_handler![
            capture::enumerate_targets,
            capture::get_target_bounds,
            capture::start_recording,
            capture::stop_recording,
            capture::set_paused,
            capture::get_videos_dir,
            audio::enumerate_audio_devices,
            audio::start_audio_capture,
            audio::stop_audio_capture,
            audio::set_audio_paused,
            input_hook::start_input_logging,
            input_hook::stop_input_logging,
            input_hook::set_input_paused,
            export::export_video,
            open_editor_window,
            open_teleprompter_window,
            get_pending_editor_paths,
            set_dock_visible,
            update_dock_state,
            get_dock_state,
            dock_action,
            set_recording_overlay,
            set_overlay_paused,
            set_countdown,
            read_text_file,
            list_directory,
            list_cursor_packs,
            list_wallpaper_images,
            open_explorer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
