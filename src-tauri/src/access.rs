//! Local files are available only inside the recording library or after selection.
use std::path::Path;
use tauri::Manager;

pub(crate) fn require(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    if !path.is_absolute()
        || path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("Select an absolute local file path without parent traversal".into());
    }
    if app.asset_protocol_scope().is_allowed(path) {
        Ok(())
    } else {
        Err(format!(
            "Access denied. Select this file through Open first: {}",
            path.display()
        ))
    }
}

pub(crate) fn grant_video(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !["mp4", "mov", "mkv", "webm", "avi"].contains(&ext.as_str()) {
        return Err("Select a supported video file".into());
    }
    if !path.is_file() {
        return Err(
            "Project video is missing. Select its current location through Open recording.".into(),
        );
    }
    let scope = app.asset_protocol_scope();
    scope.allow_file(path).map_err(|e| e.to_string())?;
    let (data, log) = crate::recording_data_paths(path);
    scope
        .allow_directory(&data, true)
        .map_err(|e| e.to_string())?;
    scope.allow_file(&data).map_err(|e| e.to_string())?;
    scope.allow_file(log).map_err(|e| e.to_string())?;
    scope
        .allow_file(path.with_extension("json"))
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn project_assets(app: &tauri::AppHandle, text: &str) -> Result<(), String> {
    let Ok(project) = serde_json::from_str::<serde_json::Value>(text) else {
        return Ok(());
    };
    if project["schemaVersion"].as_u64() != Some(1) {
        return Ok(());
    }
    if let Some(video) = project["media"]["videoPath"].as_str() {
        let path = Path::new(video);
        if !path.is_absolute()
            || path
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return Err("Project contains an invalid video path".into());
        }
        grant_video(app, path)?;
    }
    // Imported audio lives beside the recording. External audio must be selected again.
    Ok(())
}
