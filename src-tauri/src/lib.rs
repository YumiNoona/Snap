mod capture;
mod audio;
mod input_hook;
mod export;

#[tauri::command]
fn read_text_file(path: String) -> std::result::Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Cannot read {path}: {e}"))
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
            read_text_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
