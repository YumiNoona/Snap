use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::process::{recording_command, spawn_recording_child};

macro_rules! eprintln {
    ($($arg:tt)*) => { crate::process::recording_diagnostic(format_args!($($arg)*)) };
}

struct CameraHandle {
    is_recording: Arc<AtomicBool>,
    is_paused: Arc<AtomicBool>,
    done_rx: tokio::sync::oneshot::Receiver<Result<(), String>>,
}

static CAMERA_STATE: Mutex<Option<CameraHandle>> = Mutex::new(None);
const CAMERA_MOVFLAGS: &str = "+frag_keyframe+empty_moov+default_base_moof";

pub async fn start_camera_capture(
    device_name: Option<String>,
    output_dir: String,
    recording_fps: u32,
) -> Result<(), String> {
    let Some(device_name) = device_name.filter(|name| !name.trim().is_empty()) else {
        return Ok(());
    };
    let mut guard = CAMERA_STATE.lock().map_err(|error| error.to_string())?;
    if guard.is_some() {
        return Err("Camera capture is already active".to_string());
    }

    let is_recording = Arc::new(AtomicBool::new(true));
    let is_paused = Arc::new(AtomicBool::new(false));
    let worker_recording = is_recording.clone();
    let worker_paused = is_paused.clone();
    let (startup_tx, startup_rx) = std::sync::mpsc::sync_channel(1);
    let (done_tx, done_rx) = tokio::sync::oneshot::channel();
    thread::spawn(move || {
        let result = camera_worker(
            &device_name,
            Path::new(&output_dir),
            recording_fps.clamp(24, 30),
            worker_recording,
            worker_paused,
            startup_tx,
        );
        let _ = done_tx.send(result);
    });

    match startup_rx.recv_timeout(Duration::from_secs(8)) {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            is_recording.store(false, Ordering::Release);
            return Err(error);
        }
        Err(_) => {
            is_recording.store(false, Ordering::Release);
            return Err("Camera did not produce a frame within 8 seconds".to_string());
        }
    }
    *guard = Some(CameraHandle {
        is_recording,
        is_paused,
        done_rx,
    });
    Ok(())
}

pub fn set_camera_paused(paused: bool) -> Result<(), String> {
    if let Some(handle) = CAMERA_STATE
        .lock()
        .map_err(|error| error.to_string())?
        .as_ref()
    {
        handle.is_paused.store(paused, Ordering::Release);
    }
    Ok(())
}

pub async fn stop_camera_capture() -> Result<(), String> {
    let handle = CAMERA_STATE
        .lock()
        .map_err(|error| error.to_string())?
        .take();
    let Some(handle) = handle else {
        return Ok(());
    };
    handle.is_recording.store(false, Ordering::Release);
    match tokio::time::timeout(Duration::from_secs(15), handle.done_rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("Camera worker ended without a result".to_string()),
        Err(_) => Err("Camera finalization timed out after 15 seconds".to_string()),
    }
}

fn spawn_camera_segment(device_name: &str, path: &Path, fps: u32) -> Result<Child, String> {
    let input = format!("video={device_name}");
    let filter =
        format!("scale=640:-2:force_original_aspect_ratio=decrease:flags=fast_bilinear,fps={fps}");
    let mut command = recording_command("ffmpeg");
    command
        .args([
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-fflags",
            "+genpts+nobuffer",
            "-f",
            "dshow",
            "-rtbufsize",
            "32M",
            "-i",
            &input,
            "-an",
            "-vf",
            &filter,
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-tune",
            "zerolatency",
            "-threads",
            "1",
            "-b:v",
            "1M",
            "-maxrate",
            "1M",
            "-bufsize",
            "1M",
            "-g",
            &(fps * 2).to_string(),
            "-pix_fmt",
            "yuv420p",
            "-fps_mode",
            "cfr",
            "-movflags",
            CAMERA_MOVFLAGS,
        ])
        .arg(path)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    spawn_recording_child(&mut command)
        .map_err(|error| format!("Unable to open camera \"{device_name}\": {error}"))
}

fn stop_child(child: &mut Child) {
    if let Some(stdin) = child.stdin.as_mut() {
        let _ = stdin.write_all(b"q\n");
        let _ = stdin.flush();
    }
    let deadline = Instant::now() + Duration::from_secs(6);
    while Instant::now() < deadline {
        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn usable(path: &Path) -> bool {
    std::fs::metadata(path)
        .map(|metadata| metadata.len() > 1_024)
        .unwrap_or(false)
}

fn camera_worker(
    device_name: &str,
    output_dir: &Path,
    fps: u32,
    is_recording: Arc<AtomicBool>,
    is_paused: Arc<AtomicBool>,
    startup_tx: std::sync::mpsc::SyncSender<Result<(), String>>,
) -> Result<(), String> {
    std::fs::create_dir_all(output_dir)
        .map_err(|error| format!("Unable to create camera recording folder: {error}"))?;
    let output = output_dir.join("camera.mp4");
    let mut parts = Vec::<PathBuf>::new();
    let mut index = 0usize;
    let mut startup = Some(startup_tx);
    let mut start_offset_written = false;
    let mut unexpected_exits = 0usize;
    let mut terminal_warning = None;

    while is_recording.load(Ordering::Acquire) {
        if is_paused.load(Ordering::Acquire) {
            thread::sleep(Duration::from_millis(25));
            continue;
        }
        let part = output_dir.join(format!("camera.capture-part-{index}.mp4"));
        let _ = std::fs::remove_file(&part);
        let mut child = match spawn_camera_segment(device_name, &part, fps) {
            Ok(child) => child,
            Err(error) => {
                if let Some(tx) = startup.take() {
                    let _ = tx.send(Err(error.clone()));
                }
                return Err(error);
            }
        };
        let deadline = Instant::now() + Duration::from_secs(7);
        while Instant::now() < deadline && !usable(&part) {
            if child.try_wait().ok().flatten().is_some() {
                break;
            }
            thread::sleep(Duration::from_millis(50));
        }
        if !usable(&part) {
            stop_child(&mut child);
            let error = format!(
                "Camera \"{device_name}\" opened but did not deliver usable video. Close other apps using it or select Camera off."
            );
            if let Some(tx) = startup.take() {
                let _ = tx.send(Err(error.clone()));
            }
            return Err(error);
        }
        if !start_offset_written {
            let offset_ms = crate::input_hook::capture_timeline_elapsed_ms();
            let metadata = serde_json::json!({
                "version": 1,
                "startOffsetMs": offset_ms,
                "width": 640,
                "fps": fps,
            });
            let _ = std::fs::write(
                output_dir.join("camera.json"),
                serde_json::to_vec_pretty(&metadata).unwrap_or_default(),
            );
            start_offset_written = true;
        }
        if let Some(tx) = startup.take() {
            let _ = tx.send(Ok(()));
        }

        let mut unexpected_exit = false;
        while is_recording.load(Ordering::Acquire) && !is_paused.load(Ordering::Acquire) {
            if child.try_wait().ok().flatten().is_some() {
                unexpected_exit = true;
                break;
            }
            thread::sleep(Duration::from_millis(30));
        }
        stop_child(&mut child);
        if usable(&part) {
            parts.push(part);
        }
        index += 1;
        if unexpected_exit {
            unexpected_exits += 1;
            if unexpected_exits > 3 {
                terminal_warning = Some(
                    "Camera disconnected repeatedly; the usable camera portion was saved"
                        .to_string(),
                );
                break;
            }
            thread::sleep(Duration::from_millis(350));
        } else {
            unexpected_exits = 0;
        }
    }

    if parts.is_empty() {
        return Err("Camera produced no usable video".to_string());
    }
    let list_path = output_dir.join("camera.capture-parts.txt");
    let list = parts
        .iter()
        .map(|path| format!("file '{}'", path.to_string_lossy().replace('\'', "'\\''")))
        .collect::<Vec<_>>()
        .join("\n");
    std::fs::write(&list_path, list)
        .map_err(|error| format!("Unable to prepare camera segments: {error}"))?;
    let result = recording_command("ffmpeg")
        .args([
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
        ])
        .arg(&list_path)
        .args(["-an", "-c:v", "copy", "-movflags", "+faststart"])
        .arg(&output)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| format!("Unable to finalize camera video: {error}"))?;
    let _ = std::fs::remove_file(&list_path);
    if !result.success() || !usable(&output) {
        return Err("Camera video could not be finalized; recoverable fragments were kept".into());
    }
    for part in parts {
        let _ = std::fs::remove_file(part);
    }
    if let Some(warning) = terminal_warning {
        eprintln!("[Snap Camera] {warning}");
    }
    Ok(())
}
