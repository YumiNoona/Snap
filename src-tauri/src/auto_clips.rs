//! Editor-only local analysis. Owned processes are cancelled before capture starts.
use crate::{process, recording_session, transcription};
#[cfg(test)]
use std::{fs, io::Write};
use serde::{Deserialize, Serialize};
use std::{
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::Manager;

static BUSY: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);
static CAPTURE_STARTING: AtomicBool = AtomicBool::new(false);
static CAPTION_SETUP: AtomicBool = AtomicBool::new(false);
static GATE: Mutex<()> = Mutex::new(());
pub(crate) struct Job;
impl Job {
    pub(crate) fn begin(window: &tauri::WebviewWindow) -> Result<Self, String> {
        let _gate = GATE.lock().map_err(|e| e.to_string())?;
        if window.label() != "editor" {
            return Err("Open the editor to use Auto Clips.".into());
        }
        if CAPTURE_STARTING.load(Ordering::Acquire) || recording_active() {
            return Err("Finish recording before using Auto Clips.".into());
        }
        if BUSY.swap(true, Ordering::AcqRel) {
            return Err("Wait for the current Auto Clips job to finish.".into());
        }
        CANCEL.store(false, Ordering::Release);
        Ok(Self)
    }
}
impl Drop for Job {
    fn drop(&mut self) {
        BUSY.store(false, Ordering::Release);
    }
}
pub(crate) fn cancel() {
    CANCEL.store(true, Ordering::Release);
    if CAPTION_SETUP.load(Ordering::Acquire) {
        crate::caption_install::cancel();
    }
}
pub(crate) struct CaptureGuard;
impl Drop for CaptureGuard {
    fn drop(&mut self) {
        CAPTURE_STARTING.store(false, Ordering::Release);
    }
}
pub(crate) fn before_capture() -> Result<CaptureGuard, String> {
    {
        let _gate = GATE.lock().map_err(|e| e.to_string())?;
        CAPTURE_STARTING.store(true, Ordering::Release);
        cancel();
    }
    let guard = CaptureGuard;
    let start = Instant::now();
    while BUSY.load(Ordering::Acquire) {
        if start.elapsed() > Duration::from_secs(5) {
            return Err(
                "Auto Clips is releasing its local worker. Try recording again in a moment.".into(),
            );
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    Ok(guard)
}
fn recording_active() -> bool {
    use recording_session::RecordingPhase::*;
    recording_session::get_recording_session_state()
        .ok()
        .flatten()
        .is_some_and(|s| {
            matches!(
                s.phase,
                Starting | Recording | Pausing | Paused | Resuming | Stopping | Finalizing
            )
        })
}
pub(crate) fn check() -> Result<(), String> {
    if CANCEL.load(Ordering::Acquire) || recording_active() {
        Err("Auto Clips cancelled.".into())
    } else {
        Ok(())
    }
}
#[tauri::command]
pub fn cancel_auto_clips(window: tauri::WebviewWindow) {
    if window.label() == "editor" {
        cancel();
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub phase: String,
    pub percent: u8,
}
pub(crate) fn progress(channel: &tauri::ipc::Channel<Progress>, phase: &str, percent: u8) {
    let _ = channel.send(Progress {
        phase: phase.into(),
        percent,
    });
}

/// Drain bounded stdout and poll process lifetime; the job owns every child.
pub(crate) fn run(
    command: &mut Command,
    timeout: Duration,
    limit: usize,
) -> Result<Vec<u8>, String> {
    check()?;
    let owner = process::ProcessJob::new().map_err(|e| e.to_string())?;
    let mut child = owner
        .spawn(
            command
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null()),
        )
        .map_err(|e| format!("Cannot start local analysis: {e}"))?;
    let mut pipe = child
        .stdout
        .take()
        .ok_or("Analysis output is unavailable")?;
    let reader = std::thread::spawn(move || {
        let mut result = Vec::new();
        let mut buf = [0; 65536];
        let mut exceeded = false;
        loop {
            let n = pipe.read(&mut buf)?;
            if n == 0 {
                break;
            }
            let keep = n.min(limit.saturating_sub(result.len()));
            result.extend_from_slice(&buf[..keep]);
            exceeded |= keep < n;
        }
        Ok::<_, std::io::Error>((result, exceeded))
    });
    let start = Instant::now();
    let outcome = loop {
        if let Err(e) = check() {
            break Err(e);
        }
        if start.elapsed() > timeout {
            break Err("Local analysis timed out. Try a shorter video or Fast mode.".to_string());
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                break if status.success() {
                    Ok(())
                } else {
                    Err("Local analysis failed. Check that the source plays and the selected model is installed.".into())
                }
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(e) => break Err(e.to_string()),
        }
    };
    if outcome.is_err() {
        let _ = child.kill();
    }
    let _ = child.wait();
    drop(owner);
    let (bytes, exceeded) = reader
        .join()
        .map_err(|_| "Analysis output reader stopped")?
        .map_err(|e| e.to_string())?;
    outcome?;
    if exceeded {
        return Err("Analysis output exceeded its memory limit. Use a shorter video.".into());
    }
    Ok(bytes)
}
pub(crate) fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|p| p.join("auto-clips"))
        .map_err(|e| e.to_string())
}

pub(crate) fn energy_bins(raw: &[u8]) -> Vec<f64> {
    raw.chunks(16000 * 2)
        .map(|second| {
            let mut sum = 0.0;
            let mut n = 0;
            for pair in second.chunks_exact(2) {
                let x = i16::from_le_bytes([pair[0], pair[1]]) as f64 / 32768.0;
                sum += x * x;
                n += 1;
            }
            if n == 0 {
                0.0
            } else {
                (sum / n as f64).sqrt()
            }
        })
        .collect()
}
pub(crate) fn motion_bins(raw: &[u8]) -> Vec<f64> {
    let frames: Vec<_> = raw.chunks_exact(160 * 90).collect();
    frames
        .iter()
        .enumerate()
        .map(|(i, frame)| {
            if i == 0 {
                0.0
            } else {
                frame
                    .iter()
                    .zip(frames[i - 1])
                    .map(|(a, b)| (*a as f64 - *b as f64).abs())
                    .sum::<f64>()
                    / (160.0 * 90.0 * 255.0)
            }
        })
        .collect()
}
pub(crate) fn oriented_dimensions(video: &serde_json::Value) -> (u32, u32) {
    let width = video["width"].as_u64().unwrap_or(0) as u32;
    let height = video["height"].as_u64().unwrap_or(0) as u32;
    let rotation = video["side_data_list"]
        .as_array()
        .and_then(|a| a.iter().find_map(|v| v["rotation"].as_f64()))
        .or_else(|| {
            video["tags"]["rotate"]
                .as_str()
                .and_then(|s| s.parse().ok())
        })
        .unwrap_or(0.0);
    if rotation.round().abs() as i32 % 180 == 90 {
        (height, width)
    } else {
        (width, height)
    }
}

#[cfg(test)]
pub(crate) fn write_wav(path: &Path, raw: &[u8]) -> Result<(), String> {
    let mut f = fs::File::create(path).map_err(|e| e.to_string())?;
    let len = u32::try_from(raw.len()).map_err(|_| "Audio is too long")?;
    let mut header = Vec::new();
    header.extend(b"RIFF");
    header.extend((36 + len).to_le_bytes());
    header.extend(b"WAVEfmt ");
    header.extend(16u32.to_le_bytes());
    header.extend(1u16.to_le_bytes());
    header.extend(1u16.to_le_bytes());
    header.extend(16000u32.to_le_bytes());
    header.extend(32000u32.to_le_bytes());
    header.extend(2u16.to_le_bytes());
    header.extend(16u16.to_le_bytes());
    header.extend(b"data");
    header.extend(len.to_le_bytes());
    f.write_all(&header)
        .and_then(|_| f.write_all(raw))
        .map_err(|e| e.to_string())
}

pub(crate) fn detect_facecam(
    path: &Path,
    duration: f64,
    start: f64,
    width: u32,
    height: u32,
) -> Result<Option<Rect>, String> {
    use windows::{
        Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap},
        Media::FaceAnalysis::FaceDetector,
        Storage::Streams::DataWriter,
        Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
    };
    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe {
                RoUninitialize();
            }
        }
    }
    unsafe {
        RoInitialize(RO_INIT_MULTITHREADED).map_err(|e| e.to_string())?;
    };
    let _apartment = Apartment;
    let detector = FaceDetector::CreateAsync()
        .and_then(|op| op.get())
        .map_err(|e| e.to_string())?;
    let h = ((480.0 * height as f64 / width as f64).round() as u32).clamp(32, 960);
    let mut groups: Vec<(Rect, usize)> = Vec::new();
    for i in 0..3 {
        check()?;
        let time = start + (duration * (i as f64 + 1.0) / 4.0).min((duration - 0.1).max(0.0));
        let raw = run(
            process::background_command("ffmpeg")
                .args(["-v", "error", "-nostdin", "-ss"])
                .arg(format!("{time:0.3}"))
                .arg("-i")
                .arg(path)
                .args(["-frames:v", "1", "-vf"])
                .arg(format!("scale=480:{h},format=gray"))
                .args(["-f", "rawvideo", "pipe:1"]),
            Duration::from_secs(20),
            480 * h as usize,
        )?;
        if raw.len() != 480 * h as usize {
            continue;
        }
        let writer = DataWriter::new().map_err(|e| e.to_string())?;
        writer.WriteBytes(&raw).map_err(|e| e.to_string())?;
        let buffer = writer.DetachBuffer().map_err(|e| e.to_string())?;
        let bitmap =
            SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Gray8, 480, h as i32)
                .map_err(|e| e.to_string())?;
        let faces = detector
            .DetectFacesAsync(&bitmap)
            .and_then(|op| op.get())
            .map_err(|e| e.to_string())?;
        for face in faces {
            let b = face.FaceBox().map_err(|e| e.to_string())?;
            let r = Rect {
                x: b.X as f64 / 480.0,
                y: b.Y as f64 / h as f64,
                w: b.Width as f64 / 480.0,
                h: b.Height as f64 / h as f64,
            };
            // A stable small face near an edge is only a proposal, never identity recognition.
            if r.w > 0.3 || r.h > 0.5 || (r.x > 0.3 && r.x + r.w < 0.7) {
                continue;
            }
            if let Some((_, count)) = groups.iter_mut().find(|(old, _)| {
                (old.x - r.x).abs() < 0.06
                    && (old.y - r.y).abs() < 0.06
                    && (old.w - r.w).abs() < 0.06
            }) {
                *count += 1;
            } else {
                groups.push((r, 1));
            }
        }
        let _ = bitmap.Close();
    }
    Ok(groups
        .into_iter()
        .filter(|(_, count)| *count >= 2)
        .max_by_key(|(_, count)| *count)
        .map(|(r, _)| {
            let x = (r.x - r.w * 0.65).max(0.0);
            let y = (r.y - r.h * 0.4).max(0.0);
            Rect {
                x,
                y,
                w: (r.w * 2.3).min(1.0 - x),
                h: (r.h * 2.0).min(1.0 - y),
            }
        }))
}

#[tauri::command]
pub async fn install_auto_clips_ai(
    window: tauri::WebviewWindow,
    updates: tauri::ipc::Channel<Progress>,
) -> Result<(), String> {
    let job = Job::begin(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _job = job;
        crate::clip_ai::install(&root(&app)?.join("ai"), &updates)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn install_auto_clips_captions(
    window: tauri::WebviewWindow,
    updates: tauri::ipc::Channel<Progress>,
) -> Result<(), String> {
    let job = Job::begin(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _job = job;
        struct SetupGuard;
        impl Drop for SetupGuard {
            fn drop(&mut self) {
                CAPTION_SETUP.store(false, Ordering::Release);
            }
        }
        let _setup = SetupGuard;
        CAPTION_SETUP.store(true, Ordering::Release);
        crate::caption_install::begin();
        check()?;
        crate::caption_install::install(
            &transcription::user_transcription_root(),
            |percent, phase, _, _| progress(&updates, phase, percent),
        )?;
        check()
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn auto_clips_ai_ready(window: tauri::WebviewWindow) -> bool {
    window.label() == "editor"
        && root(window.app_handle()).is_ok_and(|r| crate::clip_ai::ready(&r.join("ai")))
}
#[tauri::command]
pub async fn rank_auto_clips(
    window: tauri::WebviewWindow,
    candidates: serde_json::Value,
    instruction: String,
    updates: tauri::ipc::Channel<Progress>,
) -> Result<serde_json::Value, String> {
    let job = Job::begin(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _job = job;
        crate::clip_ai::rank(&root(&app)?.join("ai"), candidates, &instruction, &updates)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    #[test]
    fn portrait_rotation_uses_display_dimensions() {
        assert_eq!(
            super::oriented_dimensions(
                &serde_json::json!({"width":1920,"height":1080,"side_data_list":[{"rotation":-90}]})
            ),
            (1080, 1920)
        );
    }
    #[test]
    fn quiet_audio_is_not_a_reaction() {
        assert_eq!(super::energy_bins(&[0; 32000]), vec![0.0]);
    }
    #[test]
    fn measures_one_bin_per_second() {
        let mut bytes = Vec::new();
        for _ in 0..32000 {
            bytes.extend(16384i16.to_le_bytes());
        }
        assert_eq!(super::energy_bins(&bytes), vec![0.5, 0.5]);
    }
    #[test]
    fn static_frames_have_no_motion() {
        assert_eq!(super::motion_bins(&vec![12; 160 * 90 * 2]), vec![0.0, 0.0]);
    }
    #[test]
    #[ignore = "Runs real FFmpeg and Windows face analysis; explicit local smoke check"]
    fn real_media_smoke() {
        use super::*;
        let dir = std::env::temp_dir().join(format!("snap-clips-smoke-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("fixture.mp4");
        run(
            process::background_command("ffmpeg")
                .args([
                    "-y",
                    "-v",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "testsrc2=size=320x180:rate=10",
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=440:sample_rate=16000",
                    "-t",
                    "4",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "ultrafast",
                    "-c:a",
                    "aac",
                ])
                .arg(&path),
            Duration::from_secs(30),
            1024,
        )
        .unwrap();
        let raw = run(
            process::background_command("ffmpeg")
                .args(["-v", "error", "-i"])
                .arg(&path)
                .args(["-vn", "-ar", "16000", "-ac", "1", "-f", "s16le", "pipe:1"]),
            Duration::from_secs(20),
            32000 * 5,
        )
        .unwrap();
        let bins = energy_bins(&raw);
        assert!(bins.len() >= 4);
        assert!(bins.iter().any(|n| *n > 0.01));
        let wav = dir.join("speech.wav");
        write_wav(&wav, &raw).unwrap();
        assert!(!transcription::pcm16_mono_activity(&wav).unwrap().is_empty());
        let raw = run(
            process::background_command("ffmpeg")
                .args(["-v", "error", "-i"])
                .arg(&path)
                .args([
                    "-an",
                    "-vf",
                    "fps=1,scale=160:90,format=gray",
                    "-f",
                    "rawvideo",
                    "pipe:1",
                ]),
            Duration::from_secs(20),
            160 * 90 * 5,
        )
        .unwrap();
        assert!(motion_bins(&raw).iter().any(|n| *n > 0.001));
        match detect_facecam(&path,4.0,0.0,320,180) {Ok(rect)=>{assert!(rect.is_none());println!("Windows local face analysis available; no false facecam on test pattern.");},Err(error)=>println!("Windows face analysis unavailable in this environment; UI manual fallback: {error}")};
        fs::remove_file(&path).unwrap();
        fs::remove_file(&wav).unwrap();
        fs::remove_dir(&dir).unwrap();
    }
}
