mod capture;
mod audio;
mod input_hook;
mod export;

use serde::Serialize;

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
        .invoke_handler(tauri::generate_handler![
            capture::enumerate_targets,
            capture::start_recording,
            capture::stop_recording,
            capture::get_videos_dir,
            audio::enumerate_audio_devices,
            audio::start_audio_capture,
            audio::stop_audio_capture,
            input_hook::start_input_logging,
            input_hook::stop_input_logging,
            export::export_video,
            read_text_file,
            list_directory,
            open_explorer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
