//! Export-only interpolation; editor overlays are composed afterwards.
use crate::process::{background_command, spawn_recording_child};
use std::io::Read;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};
use tauri::Manager;

struct MotionJob {
    id: String,
    owner: String,
    path: PathBuf,
    cancel: Arc<AtomicBool>,
    running: bool,
}
static JOB: OnceLock<Mutex<Option<MotionJob>>> = OnceLock::new();
fn job() -> &'static Mutex<Option<MotionJob>> {
    JOB.get_or_init(|| Mutex::new(None))
}

fn motion_filter(fps: u32, duration: f64) -> Result<String, String> {
    if !(24..=240).contains(&fps) || !duration.is_finite() || duration <= 0.0 {
        return Err("Invalid motion interpolation settings".into());
    }
    // Padding flushes lookahead, then trim retains the exact original clock.
    Ok(format!("tpad=stop_mode=clone:stop_duration=0.25,minterpolate=fps={fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:scd=fdiff:scd_threshold=10,trim=duration={duration:.6},setpts=PTS-STARTPTS"))
}

fn source_duration(path: &std::path::Path) -> Result<f64, String> {
    // Metadata-only probe avoids scanning every packet before interpolation.
    let output = background_command("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(path)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err("Could not read source video duration".into());
    }
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|duration| duration.is_finite() && *duration > 0.0)
        .ok_or_else(|| "Source video has no valid duration".into())
}

#[tauri::command]
pub async fn prepare_export_motion(
    app: tauri::AppHandle,
    window: tauri::Window,
    input_video: String,
    fps: u32,
    job_id: String,
) -> Result<String, String> {
    if crate::capture::recording_is_active() {
        return Err("Stop recording before analyzing export motion".into());
    }
    let input = PathBuf::from(input_video);
    crate::access::require(&app, &input)?;
    if job_id.is_empty()
        || job_id.len() > 80
        || !job_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("Invalid export job".into());
    }
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("export-motion");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path = dir.join(format!("motion-{job_id}.mp4"));
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut current = job().lock().map_err(|error| error.to_string())?;
        if current.is_some() {
            return Err("Another motion export is active".into());
        }
        *current = Some(MotionJob {
            id: job_id.clone(),
            owner: window.label().into(),
            path: path.clone(),
            cancel: cancel.clone(),
            running: true,
        });
    }
    let output = path.clone();
    let mut result = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        if cancel.load(Ordering::Acquire) {
            return Err("Export cancelled".into());
        }
        let duration = source_duration(&input)?;
        let filter = motion_filter(fps, duration)?;
        if cancel.load(Ordering::Acquire) {
            return Err("Export cancelled".into());
        }
        let mut command = background_command("ffmpeg");
        command
            .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
            .arg(&input)
            .args([
                "-an",
                "-vf",
                &filter,
                "-c:v",
                "libx264",
                "-preset",
                "fast",
                "-crf",
                "14",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
            ])
            .arg(&output)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        let mut child = spawn_recording_child(&mut command)
            .map_err(|error| format!("Could not start optical flow: {error}"))?;
        let mut stderr = child
            .stderr
            .take()
            .ok_or("Could not read optical flow output")?;
        let reader = std::thread::spawn(move || {
            let mut contents = String::new();
            let _ = stderr.read_to_string(&mut contents);
            contents
        });
        let status = loop {
            if cancel.load(Ordering::Acquire) {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return Err("Export cancelled".into());
            }
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => std::thread::sleep(std::time::Duration::from_millis(50)),
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = reader.join();
                    return Err(error.to_string());
                }
            }
        };
        let diagnostics = reader.join().unwrap_or_default();
        if !status.success() {
            return Err(format!("Optical flow failed: {diagnostics}"));
        }
        super::validate_video_metrics(super::probe_video_metrics(&output)?, duration, fps, true)?;
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())
    .and_then(|result| result);
    {
        let mut current = job().lock().map_err(|error| error.to_string())?;
        if let Some(active) = current.as_mut().filter(|active| active.id == job_id) {
            active.running = false;
            if active.cancel.load(Ordering::Acquire) {
                result = Err("Export cancelled".into());
            }
        }
        if result.is_err() {
            let _ = std::fs::remove_file(&path);
            *current = None;
        }
    }
    result?;
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into())
}

#[tauri::command]
pub fn cancel_export_motion(window: tauri::Window, job_id: String) -> Result<(), String> {
    let current = job().lock().map_err(|error| error.to_string())?;
    if let Some(active) = current
        .as_ref()
        .filter(|active| active.id == job_id && active.owner == window.label())
    {
        active.cancel.store(true, Ordering::Release);
    }
    Ok(())
}

#[tauri::command]
pub fn discard_export_motion(
    app: tauri::AppHandle,
    window: tauri::Window,
    job_id: String,
) -> Result<(), String> {
    let mut current = job().lock().map_err(|error| error.to_string())?;
    if current.as_ref().is_some_and(|active| {
        active.id == job_id && active.owner == window.label() && !active.running
    }) {
        let active = current.take().unwrap();
        let _ = app.asset_protocol_scope().forbid_file(&active.path);
        std::fs::remove_file(&active.path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn discard_for_window(owner: &str) {
    if let Ok(mut current) = job().lock() {
        if let Some(active) = current.as_ref().filter(|active| active.owner == owner) {
            active.cancel.store(true, Ordering::Release);
            if !active.running {
                let active = current.take().unwrap();
                let _ = std::fs::remove_file(active.path);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn interpolation_retains_tail_and_detects_scene_changes() {
        let filter = motion_filter(60, 1.25).unwrap();
        assert!(filter.contains("minterpolate=fps=60:mi_mode=mci"));
        assert!(filter.contains("scd=fdiff"));
        assert!(filter.ends_with("trim=duration=1.250000,setpts=PTS-STARTPTS"));
        for (fps, duration) in [(0, 1.0), (241, 1.0), (60, f64::NAN), (60, -1.0)] {
            assert!(motion_filter(fps, duration).is_err());
        }
    }
    #[test]
    #[ignore = "Requires FFmpeg; validates real motion interpolation and duration"]
    fn optical_flow_generates_a_complete_sixty_fps_video() {
        let base = std::env::temp_dir().join(format!("snap-motion-proof-{}", std::process::id()));
        let input = base.with_extension("source.mp4");
        let output = base.with_extension("flow.mp4");
        let source = super::super::run_ffmpeg(&[
            "-y".into(),
            "-f".into(),
            "lavfi".into(),
            "-i".into(),
            "testsrc2=size=320x180:rate=24:duration=1".into(),
            "-c:v".into(),
            "libx264".into(),
            "-crf".into(),
            "14".into(),
            input.to_string_lossy().into(),
        ])
        .unwrap();
        assert!(source.status.success());
        let filter = motion_filter(60, 1.0).unwrap();
        let generated = super::super::run_ffmpeg(&[
            "-y".into(),
            "-i".into(),
            input.to_string_lossy().into(),
            "-an".into(),
            "-vf".into(),
            filter,
            "-c:v".into(),
            "libx264".into(),
            "-crf".into(),
            "14".into(),
            output.to_string_lossy().into(),
        ])
        .unwrap();
        assert!(
            generated.status.success(),
            "{}",
            String::from_utf8_lossy(&generated.stderr)
        );
        let metrics = super::super::probe_video_metrics(&output).unwrap();
        assert_eq!(metrics.packets, 60);
        assert!((metrics.duration_seconds - 1.0).abs() < 0.02);
        let hash = background_command("ffmpeg")
            .args(["-v", "error", "-i"])
            .arg(&output)
            .args(["-f", "framemd5", "-"])
            .output()
            .unwrap();
        let hashes = String::from_utf8_lossy(&hash.stdout)
            .lines()
            .filter(|line| !line.starts_with('#'))
            .filter_map(|line| line.rsplit(',').next().map(|hash| hash.trim().to_string()))
            .collect::<std::collections::HashSet<_>>();
        assert!(
            hashes.len() > 24,
            "Interpolation must create new pixels, not repeat frames"
        );
        let _ = std::fs::remove_file(input);
        let _ = std::fs::remove_file(output);
    }
}
