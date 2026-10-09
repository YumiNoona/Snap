//! Small post-capture summary, assembled from existing encoder progress.
use serde::{Deserialize, Serialize};
use std::{io::Read, path::Path};

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingHealth {
    pub encoders: Vec<String>,
    pub encoded_frames: u64,
    pub media_seconds: f64,
    pub quiet_intervals: u64,
    pub recovery_attempts: usize,
    pub interrupted: bool,
}

pub fn write(path: &Path, health: &RecordingHealth) {
    // Capture has already stopped. Diagnostics must never prevent saving video.
    if let Ok(bytes) = serde_json::to_vec(health) {
        let _ = std::fs::write(path.with_extension("health.json"), bytes);
    }
}

#[tauri::command]
pub fn recording_health(app: tauri::AppHandle, path: String) -> Result<Option<RecordingHealth>, String> {
    crate::access::require(&app, Path::new(&path))?;
    let companion = Path::new(&path).with_extension("health.json");
    let file = match std::fs::File::open(companion) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Recording summary is unavailable".into()),
    };
    let mut bytes = Vec::new();
    file.take(16_385).read_to_end(&mut bytes).map_err(|_| "Recording summary is unavailable")?;
    if bytes.len() > 16_384 { return Err("Recording summary is too large".into()); }
    serde_json::from_slice(&bytes).map(Some).map_err(|_| "Recording summary is invalid".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn summary_is_small_and_uses_the_recording_basename() {
        let directory = std::env::temp_dir().join(format!("snap-health-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("capture.mp4");
        let summary = RecordingHealth { encoders: vec!["h264_qsv".into()], encoded_frames: 600, media_seconds: 10.0, quiet_intervals: 1, recovery_attempts: 0, interrupted: false };
        write(&path, &summary);
        let bytes = std::fs::read(path.with_extension("health.json")).unwrap();
        assert!(bytes.len() < 1024);
        let restored: RecordingHealth = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(restored.encoded_frames, 600);
        assert_eq!(restored.quiet_intervals, 1);
        assert_eq!(restored.encoders, vec!["h264_qsv"]);
        std::fs::remove_file(path.with_extension("health.json")).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }
}
