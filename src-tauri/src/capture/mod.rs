use std::ffi::c_void;
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::process::background_command;

use serde::{Deserialize, Serialize};
use windows::core::*;
use windows::Graphics::Capture::*;
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Direct3D::*;
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::*;
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::System::Com::*;
use windows::Win32::System::WinRT::Direct3D11::*;
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::System::WinRT::*;
use windows::Win32::UI::WindowsAndMessaging::*;

// ── Target type ──────────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
pub struct DisplayTarget {
    pub id: String,
    pub name: String,
    pub target_type: String,
}

#[derive(Clone, Serialize)]
pub struct TargetBounds {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

#[derive(Clone, Copy, Deserialize)]
pub struct CaptureRegion {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

#[derive(Clone, Copy)]
struct CropRect {
    x: u32,
    y: u32,
    w: u32,
    h: u32,
}

/// Physical-pixel bounds of a monitor or window target. The editor uses these to
/// map input-hook screen coordinates onto the recorded video frame.
#[tauri::command]
pub fn get_target_bounds(target_id: String) -> std::result::Result<TargetBounds, String> {
    unsafe {
        if let Some(hmon) = hmonitor_from_id(&target_id) {
            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            if GetMonitorInfoW(hmon, &mut info).as_bool() {
                let r = info.rcMonitor;
                return Ok(TargetBounds {
                    x: r.left,
                    y: r.top,
                    w: r.right - r.left,
                    h: r.bottom - r.top,
                });
            }
        }
        if let Some(hwnd) = hwnd_from_id(&target_id) {
            let mut r = RECT::default();
            if GetWindowRect(hwnd, &mut r).is_ok() {
                return Ok(TargetBounds {
                    x: r.left,
                    y: r.top,
                    w: r.right - r.left,
                    h: r.bottom - r.top,
                });
            }
        }
    }
    Err(format!("Could not resolve bounds for target {target_id}"))
}

// ── Utility: get user's Videos directory path ────────────────────────────────

#[tauri::command]
pub fn get_videos_dir() -> std::result::Result<String, String> {
    let library = get_videos_root().join("Snap");
    std::fs::create_dir_all(&library)
        .map_err(|error| format!("Unable to create the Snap recording library: {error}"))?;
    Ok(library.to_string_lossy().to_string())
}

pub fn get_videos_root() -> std::path::PathBuf {
    let userprofile = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".to_string());
    std::path::PathBuf::from(userprofile).join("Videos")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingPreflight {
    pub available_bytes: u64,
    pub required_bytes: u64,
    pub ffmpeg_available: bool,
    pub writable: bool,
}

/// Fast preflight performed before hooks, audio devices, or capture sessions
/// are opened. The estimate deliberately includes generous headroom for raw
/// audio, temporary files, and encoder bitrate spikes.
#[tauri::command]
pub fn recording_preflight(
    output_path: String,
    expected_seconds: Option<u64>,
) -> std::result::Result<RecordingPreflight, String> {
    let output = std::path::PathBuf::from(&output_path);
    let parent = output.parent().unwrap_or_else(|| std::path::Path::new("."));
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("Cannot create recording folder: {error}"))?;
    let probe = parent.join(".snap-write-test.tmp");
    let writable = std::fs::write(&probe, b"snap").is_ok();
    let _ = std::fs::remove_file(&probe);
    if !writable {
        return Err(format!(
            "Recording folder is not writable: {}",
            parent.display()
        ));
    }
    let available_bytes = fs2::available_space(parent)
        .map_err(|error| format!("Cannot inspect free disk space: {error}"))?;
    let seconds = expected_seconds.unwrap_or(3600).clamp(60, 86_400);
    let required_bytes = (seconds * 3_000_000).max(1_073_741_824);
    if available_bytes < required_bytes {
        return Err(format!("Not enough disk space. Snap needs at least {:.1} GB free for this recording estimate; {:.1} GB is available.", required_bytes as f64 / 1_073_741_824.0, available_bytes as f64 / 1_073_741_824.0));
    }
    let ffmpeg_available = crate::process::background_command("ffmpeg")
        .arg("-version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if !ffmpeg_available {
        return Err(
            "FFmpeg is unavailable. Install or bundle FFmpeg before recording.".to_string(),
        );
    }
    Ok(RecordingPreflight {
        available_bytes,
        required_bytes,
        ffmpeg_available,
        writable,
    })
}

#[tauri::command]
pub async fn install_ffmpeg() -> std::result::Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let output = crate::process::background_command("winget.exe")
            .args([
                "install",
                "--id",
                "Gyan.FFmpeg.Essentials",
                "--exact",
                "--silent",
                "--accept-package-agreements",
                "--accept-source-agreements",
                "--disable-interactivity",
            ])
            .output()
            .map_err(|error| format!("Windows Package Manager is unavailable: {error}"))?;
        if !output.status.success() {
            return Err(format!(
                "FFmpeg installation failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        Ok("FFmpeg installed. Snap can now record and export video.".to_string())
    })
    .await
    .map_err(|error| format!("FFmpeg installer failed: {error}"))?
}

// ── Capture handle (held by the Tauri command thread) ────────────────────────

struct CaptureHandle {
    is_recording: Arc<AtomicBool>,
    is_paused: Arc<AtomicBool>,
    done_rx: tokio::sync::oneshot::Receiver<std::result::Result<(), String>>,
}

static STATE: Mutex<Option<CaptureHandle>> = Mutex::new(None);

// ── Helpers ──────────────────────────────────────────────────────────────────

fn hmonitor_from_id(id: &str) -> Option<HMONITOR> {
    id.strip_prefix("monitor:")
        .and_then(|s| s.parse::<usize>().ok())
        .map(|v| HMONITOR(v as *mut c_void))
}

fn hwnd_from_id(id: &str) -> Option<HWND> {
    id.strip_prefix("window:")
        .and_then(|s| s.parse::<usize>().ok())
        .map(|v| HWND(v as *mut c_void))
}

fn widestr_to_string(wide: &[u16]) -> String {
    let len = wide.iter().position(|&c| c == 0).unwrap_or(wide.len());
    String::from_utf16_lossy(&wide[..len])
}

// ── Enumerate targets (runs fine on any thread) ──────────────────────────────

#[tauri::command]
pub fn enumerate_targets() -> std::result::Result<Vec<DisplayTarget>, String> {
    let mut targets = Vec::new();
    enumerate_monitors(&mut targets).map_err(|e| format!("{e}"))?;
    enumerate_windows(&mut targets);
    Ok(targets)
}

fn enumerate_monitors(targets: &mut Vec<DisplayTarget>) -> Result<()> {
    let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1()? };

    for adapter_idx in 0u32.. {
        let adapter: IDXGIAdapter1 = match unsafe { factory.EnumAdapters1(adapter_idx) } {
            Ok(a) => a,
            Err(e) if e.code() == DXGI_ERROR_NOT_FOUND => break,
            Err(_) => continue,
        };

        for output_idx in 0u32.. {
            let output: IDXGIOutput = match unsafe { adapter.EnumOutputs(output_idx) } {
                Ok(o) => o,
                Err(e) if e.code() == DXGI_ERROR_NOT_FOUND => break,
                Err(_) => continue,
            };

            let desc = unsafe { output.GetDesc()? };
            if desc.Monitor.is_invalid() {
                continue;
            }

            targets.push(DisplayTarget {
                id: format!("monitor:{}", desc.Monitor.0 as usize),
                name: widestr_to_string(&desc.DeviceName),
                target_type: "monitor".to_string(),
            });
        }
    }

    Ok(())
}

fn desktop_duplication_output_index(hmonitor: HMONITOR) -> Result<u32> {
    let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1()? };
    let mut global_index = 0u32;
    for adapter_idx in 0u32.. {
        let adapter: IDXGIAdapter1 = match unsafe { factory.EnumAdapters1(adapter_idx) } {
            Ok(value) => value,
            Err(error) if error.code() == DXGI_ERROR_NOT_FOUND => break,
            Err(_) => continue,
        };
        for output_idx in 0u32.. {
            let output: IDXGIOutput = match unsafe { adapter.EnumOutputs(output_idx) } {
                Ok(value) => value,
                Err(error) if error.code() == DXGI_ERROR_NOT_FOUND => break,
                Err(_) => continue,
            };
            let description = unsafe { output.GetDesc()? };
            if description.Monitor == hmonitor {
                return Ok(global_index);
            }
            global_index += 1;
        }
    }
    Err(Error::new(E_FAIL, "Selected display is unavailable to Desktop Duplication"))
}

fn enumerate_windows(targets: &mut Vec<DisplayTarget>) {
    struct Ctx<'a> {
        targets: &'a mut Vec<DisplayTarget>,
    }

    unsafe extern "system" fn callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = &mut *(lparam.0 as *mut Ctx);

        if !IsWindowVisible(hwnd).as_bool() {
            return BOOL::from(true);
        }

        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        if (style & WS_EX_TOOLWINDOW.0) != 0 {
            return BOOL::from(true);
        }

        let mut text = [0u16; 256];
        let len = GetWindowTextW(hwnd, &mut text);
        if len == 0 {
            return BOOL::from(true);
        }

        ctx.targets.push(DisplayTarget {
            id: format!("window:{}", hwnd.0 as usize),
            name: widestr_to_string(&text),
            target_type: "window".to_string(),
        });

        BOOL::from(true)
    }

    let mut ctx = Ctx { targets };
    unsafe {
        let _ = EnumWindows(Some(callback), LPARAM((&raw mut ctx) as isize));
    }
}

// ── Start recording (async — never blocks the UI thread) ─────────────────────

#[tauri::command]
pub async fn start_recording(
    target_id: String,
    output_path: String,
    region: Option<CaptureRegion>,
) -> std::result::Result<(), String> {
    if let Some(selected) = region {
        if selected.w < 256 || selected.h < 144 {
            return Err("Recording region must be at least 256x144 pixels".to_string());
        }
    }
    let mut guard = STATE.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Err("Recording already in progress".to_string());
    }

    let is_recording = Arc::new(AtomicBool::new(true));
    let is_paused = Arc::new(AtomicBool::new(false));
    let (done_tx, done_rx) = tokio::sync::oneshot::channel();
    let (startup_tx, startup_rx) = std::sync::mpsc::channel::<std::result::Result<(), String>>();
    let is_rec_clone = is_recording.clone();
    let is_paused_clone = is_paused.clone();
    let target_bounds = get_target_bounds(target_id.clone()).ok();
    let crop = region.and_then(|selected| {
        target_bounds.map(|bounds| {
            let left = (selected.x - bounds.x).clamp(0, bounds.w.saturating_sub(2));
            let top = (selected.y - bounds.y).clamp(0, bounds.h.saturating_sub(2));
            let max_w = bounds.w - left;
            let max_h = bounds.h - top;
            let mut w = selected.w.clamp(2, max_w) as u32;
            let mut h = selected.h.clamp(2, max_h) as u32;
            w -= w % 2;
            h -= h % 2;
            CropRect {
                x: left as u32,
                y: top as u32,
                w: w.max(2),
                h: h.max(2),
            }
        })
    });

    // Use std::thread::spawn instead of tokio::task::spawn_blocking to guarantee
    // a fresh thread with no prior COM initialization (avoids RPC_E_CHANGED_MODE).
    thread::spawn(move || {
        let result = run_capture_thread(
            &target_id,
            &output_path,
            crop,
            is_rec_clone,
            is_paused_clone,
            startup_tx.clone(),
        );
        if let Err(error) = &result {
            let _ = startup_tx.send(Err(error.clone()));
        }
        let _ = done_tx.send(result);
    });

    match startup_rx.recv_timeout(Duration::from_secs(6)) {
        Ok(Ok(())) => {}
        Ok(Err(error)) => return Err(error),
        Err(_) => {
            is_recording.store(false, Ordering::SeqCst);
            return Err("Recorder failed to initialize within 6 seconds".to_string());
        }
    }

    *guard = Some(CaptureHandle {
        is_recording,
        is_paused,
        done_rx,
    });

    Ok(())
}

/// Pause (true) or resume (false) the current recording. While paused, no
/// video frames are written to FFmpeg — the paused segment is omitted from
/// the output file entirely.
#[tauri::command]
pub fn set_paused(paused: bool) -> std::result::Result<(), String> {
    let guard = STATE.lock().map_err(|e| e.to_string())?;
    if let Some(handle) = guard.as_ref() {
        handle.is_paused.store(paused, Ordering::SeqCst);
        eprintln!("[Snap] Recording {}paused", if paused { "" } else { "un" });
    }
    Ok(())
}

// ── Stop recording (async — never blocks the UI thread) ──────────────────────

#[tauri::command]
pub async fn stop_recording() -> std::result::Result<(), String> {
    let handle = {
        let mut guard = STATE.lock().map_err(|e| e.to_string())?;
        guard
            .take()
            .ok_or_else(|| "No recording in progress".to_string())?
    };

    eprintln!("[Snap] Signaling capture thread to stop...");
    handle.is_recording.store(false, Ordering::SeqCst);

    match tokio::time::timeout(Duration::from_secs(20), handle.done_rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("Capture thread failed (no result)".to_string()),
        Err(_) => Err("Capture stop timed out after 20s".to_string()),
    }
}

// ── Capture thread (runs on a dedicated OS thread via thread::spawn) ─────────

fn run_capture_thread(
    target_id: &str,
    output_path: &str,
    crop: Option<CropRect>,
    is_recording: Arc<AtomicBool>,
    is_paused: Arc<AtomicBool>,
    startup_tx: std::sync::mpsc::Sender<std::result::Result<(), String>>,
) -> std::result::Result<(), String> {
    // Resolve the absolute output path now, before we hand it to FFmpeg
    let abs_path = match std::path::absolute(output_path) {
        Ok(p) => p,
        Err(_) => std::path::PathBuf::from(output_path),
    };
    eprintln!(
        "[Snap] Step 4/7: FFmpeg output path resolved to: {}",
        abs_path.display()
    );

    // Ensure the parent directory exists
    if let Some(parent) = abs_path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            eprintln!("[Snap] WARNING: could not create output directory: {e}");
        }
    }

    // Windows.Graphics.Capture can stop invalidating frames for hardware-overlay
    // browser/video content on some driver combinations. Full-display recording
    // therefore uses DXGI Desktop Duplication through FFmpeg; window and region
    // capture retain WGC because it provides their exact target geometry.
    if crop.is_none() {
        if let Some(monitor) = hmonitor_from_id(target_id) {
            return run_desktop_duplication_capture(
                monitor,
                &abs_path,
                is_recording,
                is_paused,
                startup_tx,
            );
        }
    }

    let result = (|| -> Result<()> {
        // ── Step 1: COM initialization ──
        eprintln!("[Snap] Step 1/7: COM initializing (COINIT_MULTITHREADED)...");
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED)
                .ok()
                .map_err(|e| Error::new(E_FAIL, format!("CoInitializeEx failed: {e}")))?;
        }
        eprintln!("[Snap] Step 1/7: COM initialized OK");

        // ── Step 2: D3D11 device ──
        eprintln!("[Snap] Step 2/7: Creating D3D11 device...");
        let (device, context) = create_d3d11_device()?;
        eprintln!("[Snap] Step 2/7: D3D11 device created OK");

        // ── Step 3: Capture item ──
        eprintln!("[Snap] Step 3/7: Creating capture item for target...");
        let dxgi_device: IDXGIDevice = device.cast()?;
        let inspectable = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi_device) }?;
        let d3d_device: IDirect3DDevice = inspectable.cast()?;
        let item = create_capture_item(target_id)?;
        let size = item.Size()?;
        let width = size.Width as u32;
        let height = size.Height as u32;
        let active_crop = crop.map(|c| CropRect {
            x: c.x.min(width.saturating_sub(2)),
            y: c.y.min(height.saturating_sub(2)),
            w: c.w.min(width.saturating_sub(c.x)).max(2) & !1,
            h: c.h.min(height.saturating_sub(c.y)).max(2) & !1,
        });
        let encode_w = active_crop.map(|c| c.w).unwrap_or(width);
        let encode_h = active_crop.map(|c| c.h).unwrap_or(height);
        eprintln!("[Snap] Step 3/7: Capture item created OK ({width}x{height})");

        // ── Step 4: FFmpeg subprocess ──
        let abs_path_str = abs_path.to_string_lossy().to_string();
        let (mut ffmpeg_child, ffmpeg_stdin, hardware_encoder) =
            spawn_ffmpeg(&abs_path_str, encode_w, encode_h)?;
        // FFmpeg continuously writes progress and diagnostics. Leaving stderr
        // attached to an unread pipe eventually fills its OS buffer and blocks
        // the encoder, producing a video that appears frozen on one frame.
        let ffmpeg_stderr = ffmpeg_child.stderr.take();
        let stderr_reader = thread::spawn(move || {
            let mut text = String::new();
            if let Some(mut stderr) = ffmpeg_stderr {
                let _ = stderr.read_to_string(&mut text);
            }
            text
        });
        eprintln!("[Snap] Step 4/7: FFmpeg spawned OK ({hardware_encoder} hardware encoder)");

        // ── Step 5: Frame pool + capture session ──
        eprintln!("[Snap] Step 5/7: Creating Direct3D11 frame pool...");
        let frame_pool = Direct3D11CaptureFramePool::Create(
            &d3d_device,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            2,
            size,
        )?;
        let session = frame_pool.CreateCaptureSession(&item)?;
        // Never bake the OS cursor into the raw video — the editor draws its own
        // custom cursor overlay from the input-hook log. Must be set before
        // StartCapture. Only affects NEW recordings.
        session.SetIsCursorCaptureEnabled(false)?;
        eprintln!("[Snap] Step 5/7: Frame pool and capture session created OK (OS cursor capture disabled)");

        // ── Step 6: Start capture (polling — no DispatcherQueue needed) ──
        eprintln!("[Snap] Step 6/7: Starting capture session (polling mode)...");
        let stdin = Arc::new(Mutex::new(ffmpeg_stdin));
        session.StartCapture()?;
        let _ = startup_tx.send(Ok(()));
        eprintln!("[Snap] Step 6/7: Capture session started OK");

        // ── Step 7: Poll for frames ──
        eprintln!("[Snap] Step 7/7: polling for frames (first frame 3s timeout)...");
        let mut frame_count: u64 = 0;
        let mut frames_sent: u64 = 0;
        let first_frame_deadline = Instant::now() + Duration::from_secs(3);
        let mut log_interval = Instant::now();
        let frame_interval = Duration::from_micros(16_667);
        let mut next_target = Instant::now();
        // Reusable staging texture — created once on first frame, reused for all
        // subsequent frames to avoid per-frame GPU allocation overhead.
        let mut staging_cache: Option<(ID3D11Texture2D, u32, u32)> = None;
        let mut health_check = Instant::now();
        let mut consecutive_write_errors = 0u8;
        let mut capture_failure: Option<String> = None;
        let mut last_frame_at = Instant::now();

        while is_recording.load(Ordering::Relaxed) {
            if health_check.elapsed() >= Duration::from_secs(5) {
                health_check = Instant::now();
                if let Some(parent) = abs_path.parent() {
                    if let Ok(free) = fs2::available_space(parent) {
                        if free < 268_435_456 {
                            capture_failure = Some(format!("Recording stopped safely because disk space fell below 256 MB ({} MB remaining)", free / 1_048_576));
                            break;
                        }
                    }
                }
                if let Ok(Some(status)) = ffmpeg_child.try_wait() {
                    capture_failure =
                        Some(format!("Hardware encoder stopped unexpectedly: {status}"));
                    break;
                }
            }
            // Pause gate: while paused, drain and drop frames so the paused
            // segment is omitted from the video entirely. On resume, reset the
            // pacing target to avoid a burst of catch-up frames.
            if is_paused.load(Ordering::Relaxed) {
                while is_paused.load(Ordering::Relaxed) && is_recording.load(Ordering::Relaxed) {
                    let _ = frame_pool.TryGetNextFrame();
                    thread::sleep(Duration::from_millis(10));
                }
                if !is_recording.load(Ordering::Relaxed) {
                    break;
                }
                next_target = Instant::now() + frame_interval;
                continue;
            }

            let now = Instant::now();
            match frame_pool.TryGetNextFrame() {
                Ok(frame) => {
                    last_frame_at = now;
                    frame_count += 1;

                    // First frame == video time 0 — stamp it into the input log so
                    // the editor can align input-event timestamps with the video.
                    if frame_count == 1 {
                        crate::input_hook::mark_capture_start();
                        eprintln!("[Snap] Step 7/7: first frame received via poll OK");
                    }

                    if now >= next_target || frame_count == 1 {
                        if frame_count == 1 {
                            eprintln!("[Snap] Step 7/7: first frame received via poll OK");
                        }
                        if let Err(e) = write_frame_to_ffmpeg(
                            &frame,
                            &device,
                            &context,
                            &stdin,
                            &mut staging_cache,
                            active_crop,
                        ) {
                            eprintln!("[Snap] frame write error: {e}");
                            consecutive_write_errors = consecutive_write_errors.saturating_add(1);
                            if consecutive_write_errors >= 3 {
                                capture_failure =
                                    Some(format!("Frame pipeline failed repeatedly: {e}"));
                                break;
                            }
                        } else {
                            consecutive_write_errors = 0;
                        }
                        frames_sent += 1;
                        next_target += frame_interval;
                        // Clamp next_target so we don't try to "catch up" if a frame
                        // took longer than one interval to process.
                        if next_target < now {
                            next_target = now + frame_interval;
                        }
                    }

                    if log_interval.elapsed() >= Duration::from_secs(2) {
                        eprintln!(
                            "[Snap] frame {frame_count} polled, {frames_sent} sent to FFmpeg"
                        );
                        log_interval = Instant::now();
                    }
                }
                Err(_) => {
                    if frame_count == 0 && now > first_frame_deadline {
                        session.Close()?;
                        return Err(Error::new(
                            E_FAIL,
                            "capture timed out waiting for first frame (3s)",
                        ));
                    }
                    if frame_count > 0 && last_frame_at.elapsed() > Duration::from_secs(5) {
                        capture_failure = Some("Capture target stopped producing frames for 5 seconds. The window may have closed, the display may have disconnected, or the graphics device may have reset.".to_string());
                        break;
                    }
                }
            }
            thread::sleep(Duration::from_millis(2));
        }

        eprintln!("[Snap] Polled {frame_count} frames, sent {frames_sent} to FFmpeg");
        crate::input_hook::mark_capture_end(frames_sent);
        drop(stdin);

        // ── Cleanup ──
        session.Close()?;
        frame_pool.Close()?;
        eprintln!("[Snap] Session & frame pool closed — finalizing FFmpeg...");

        // Wait for FFmpeg with timeout, then read its stderr
        let ffmpeg_status = wait_for_ffmpeg(&mut ffmpeg_child);
        let stderr_text = stderr_reader
            .join()
            .unwrap_or_else(|_| "FFmpeg diagnostics reader crashed".to_string());

        eprintln!("[Snap] FFmpeg stderr:\n{stderr_text}");

        unsafe { CoUninitialize() };
        eprintln!("[Snap] COM uninitialized");

        // ── File verification ──
        validate_output(&abs_path, ffmpeg_status, &stderr_text)?;

        if let Some(failure) = capture_failure {
            return Err(Error::new(E_FAIL, failure));
        }

        Ok(())
    })();

    result.map_err(|e| format!("{e}"))
}

fn run_desktop_duplication_capture(
    monitor: HMONITOR,
    output_path: &Path,
    is_recording: Arc<AtomicBool>,
    is_paused: Arc<AtomicBool>,
    startup_tx: std::sync::mpsc::Sender<std::result::Result<(), String>>,
) -> std::result::Result<(), String> {
    let output_index = desktop_duplication_output_index(monitor).map_err(|error| error.to_string())?;
    let source = format!("ddagrab=output_idx={output_index}:framerate=60:draw_mouse=0,hwdownload,format=bgra");
    let stem = output_path.file_stem().unwrap_or_default().to_string_lossy();
    let parent = output_path.parent().unwrap_or_else(|| Path::new("."));
    let mut parts = Vec::new();
    let mut part_index = 0usize;
    let mut started = false;
    let mut last_diagnostics = String::new();

    while is_recording.load(Ordering::Relaxed) {
        let part = parent.join(format!("{stem}.capture-part-{part_index}.mp4"));
        let _ = std::fs::remove_file(&part);
        let (mut child, mut control, encoder) = spawn_desktop_duplication(&source, &part)?;
        let stderr = child.stderr.take();
        let stderr_reader = thread::spawn(move || {
            let mut diagnostics = String::new();
            if let Some(mut stream) = stderr { let _ = stream.read_to_string(&mut diagnostics); }
            diagnostics
        });
        if !started {
            crate::input_hook::mark_capture_start();
            let _ = startup_tx.send(Ok(()));
            started = true;
        }
        eprintln!("[Snap] Full-display Desktop Duplication segment {part_index} started on output {output_index} ({encoder})");
        let mut exited = false;
        while is_recording.load(Ordering::Relaxed) {
            if let Ok(Some(status)) = child.try_wait() {
                eprintln!("[Snap] Desktop Duplication segment ended ({status}); attempting recovery");
                exited = true;
                break;
            }
            let _ = is_paused.load(Ordering::Relaxed); // audio and input keep their own pause clocks
            thread::sleep(Duration::from_millis(20));
        }
        if !exited {
            let _ = control.write_all(b"q\n");
            drop(control);
            let _ = wait_for_ffmpeg(&mut child);
        }
        last_diagnostics = stderr_reader.join().unwrap_or_default();
        if std::fs::metadata(&part).map(|value| value.len() > 1_024).unwrap_or(false) {
            parts.push(part);
        }
        if !is_recording.load(Ordering::Relaxed) { break; }
        part_index += 1;
        if part_index > 5 {
            return Err(format!("Desktop capture could not recover after 5 display resets: {last_diagnostics}"));
        }
        thread::sleep(Duration::from_millis(350));
    }

    crate::input_hook::mark_capture_end(0);
    finalize_capture_parts(&parts, output_path, &last_diagnostics)?;
    for part in parts { let _ = std::fs::remove_file(part); }
    Ok(())
}

fn spawn_desktop_duplication(source: &str, destination: &Path) -> std::result::Result<(Child, ChildStdin, &'static str), String> {
    let destination = destination.to_string_lossy().to_string();
    let encoders: [(&str, &[&str]); 3] = [
        ("NVENC", &["-c:v", "h264_nvenc", "-preset", "p1", "-b:v", "12M"]),
        ("AMD AMF", &["-c:v", "h264_amf", "-quality", "speed", "-b:v", "12M"]),
        ("Intel Quick Sync", &["-c:v", "h264_qsv", "-preset", "veryfast", "-b:v", "12M"]),
    ];
    for (name, codec) in encoders {
        let mut command = background_command("ffmpeg");
        command.args(["-y", "-hide_banner", "-loglevel", "error", "-filter_complex", source]);
        command.args(codec).args(["-pix_fmt", "yuv420p", &destination]);
        command.stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped());
        if let Ok(mut child) = command.spawn() {
            thread::sleep(Duration::from_millis(500));
            if matches!(child.try_wait(), Ok(None)) {
                let stdin = child.stdin.take().ok_or_else(|| "Desktop capture control pipe is unavailable".to_string())?;
                return Ok((child, stdin, name));
            }
            let _ = child.wait();
        }
    }
    Err("Desktop capture could not start with any supported hardware H.264 encoder".to_string())
}

fn finalize_capture_parts(parts: &[std::path::PathBuf], output_path: &Path, diagnostics: &str) -> std::result::Result<(), String> {
    if parts.is_empty() { return Err(format!("Desktop capture produced no usable video: {diagnostics}")); }
    let _ = std::fs::remove_file(output_path);
    if parts.len() == 1 {
        std::fs::rename(&parts[0], output_path).map_err(|error| format!("Unable to finalize desktop recording: {error}"))?;
    } else {
        let list_path = output_path.with_extension("capture-parts.txt");
        let list = parts.iter().map(|path| format!("file '{}'", path.to_string_lossy().replace('\'', "'\\''"))).collect::<Vec<_>>().join("\n");
        std::fs::write(&list_path, list).map_err(|error| format!("Unable to prepare recovered recording: {error}"))?;
        let output = background_command("ffmpeg").args(["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i"]).arg(&list_path).args(["-c", "copy"]).arg(output_path).output().map_err(|error| format!("Unable to join recovered recording: {error}"))?;
        let _ = std::fs::remove_file(&list_path);
        if !output.status.success() { return Err(format!("Unable to join recovered desktop recording: {}", String::from_utf8_lossy(&output.stderr))); }
    }
    validate_output(output_path, true, diagnostics).map_err(|error| error.to_string())
}

// ── D3D11 device ─────────────────────────────────────────────────────────────

fn create_d3d11_device() -> Result<(ID3D11Device, ID3D11DeviceContext)> {
    let mut device: Option<ID3D11Device> = None;
    let mut context: Option<ID3D11DeviceContext> = None;
    let mut feature_level = D3D_FEATURE_LEVEL::default();
    let flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;

    unsafe {
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            flags,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            Some(&mut feature_level),
            Some(&mut context),
        )?;
    }

    Ok((device.unwrap(), context.unwrap()))
}

// ── Capture item ─────────────────────────────────────────────────────────────

fn create_capture_item(target_id: &str) -> Result<GraphicsCaptureItem> {
    let class_name = HSTRING::from("Windows.Graphics.Capture.GraphicsCaptureItem");
    let interop: IGraphicsCaptureItemInterop = unsafe { RoGetActivationFactory(&class_name) }?;

    if let Some(hmonitor) = hmonitor_from_id(target_id) {
        unsafe { interop.CreateForMonitor(hmonitor) }
    } else if let Some(hwnd) = hwnd_from_id(target_id) {
        unsafe { interop.CreateForWindow(hwnd) }
    } else {
        Err(Error::from_hresult(E_INVALIDARG))
    }
}

// ── FFmpeg subprocess ────────────────────────────────────────────────────────

fn spawn_ffmpeg(output_path: &str, width: u32, height: u32) -> Result<(Child, ChildStdin, String)> {
    let size = format!("{width}x{height}");

    fn try_ffmpeg(args: &[&str]) -> std::result::Result<Child, std::io::Error> {
        background_command("ffmpeg")
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
    }

    let candidates: [(&str, Vec<&str>); 3] = [
        (
            "NVENC",
            vec!["-c:v", "h264_nvenc", "-preset", "p1", "-b:v", "12M"],
        ),
        (
            "AMD AMF",
            vec!["-c:v", "h264_amf", "-quality", "speed", "-b:v", "12M"],
        ),
        (
            "Intel Quick Sync",
            vec!["-c:v", "h264_qsv", "-preset", "veryfast", "-b:v", "12M"],
        ),
    ];
    for (name, codec_args) in candidates {
        let test_src = format!("color=black:s={size}:r=1");
        let mut probe_args = vec![
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            &test_src,
            "-frames:v",
            "1",
        ];
        probe_args.extend(codec_args.iter().copied());
        probe_args.extend(["-f", "null", "-"]);
        let probe_ok = background_command("ffmpeg")
            .args(&probe_args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        if !probe_ok {
            eprintln!("[Snap] {name} hardware probe failed; trying next GPU encoder");
            continue;
        }
        let mut args = vec![
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostats",
            "-f",
            "rawvideo",
            "-pixel_format",
            "bgra",
            "-video_size",
            &size,
            "-framerate",
            "60",
            "-i",
            "pipe:0",
        ];
        args.extend(codec_args);
        args.extend(["-pix_fmt", "yuv420p", output_path]);
        if let Ok(mut child) = try_ffmpeg(&args) {
            let stdin = child
                .stdin
                .take()
                .ok_or_else(|| Error::new(E_FAIL, "FFmpeg stdin unavailable"))?;
            return Ok((child, stdin, name.to_string()));
        }
    }
    Err(Error::new(E_FAIL, "No supported hardware H.264 encoder found. Install an FFmpeg build with NVENC, AMF, or Quick Sync support and update the GPU driver."))
}

// ── FFmpeg lifecycle ─────────────────────────────────────────────────────────

fn wait_for_ffmpeg(child: &mut Child) -> bool {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if status.success() {
                    eprintln!("[Snap] FFmpeg exited OK");
                } else {
                    eprintln!("[Snap] FFmpeg exited non-zero: {status}");
                }
                return status.success();
            }
            Ok(None) => {
                if Instant::now() > deadline {
                    eprintln!("[Snap] TIMEOUT: FFmpeg did not exit within 10s, killing");
                    let _ = child.kill();
                    let _ = child.wait();
                    return false;
                }
                thread::sleep(Duration::from_millis(100));
            }
            Err(e) => {
                eprintln!("[Snap] FFmpeg wait error: {e}");
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
    }
}

fn validate_output(path: &std::path::Path, ffmpeg_ok: bool, stderr: &str) -> Result<()> {
    let exists = path.exists();
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);

    eprintln!(
        "[Snap] Output file check: exists={exists}, size={size} bytes, ffmpeg_ok={ffmpeg_ok}"
    );

    if !exists {
        return Err(Error::new(
            E_FAIL,
            format!(
                "FFmpeg reported success but output file does not exist: {}\nFFmpeg stderr:\n{stderr}",
                path.display()
            ),
        ));
    }

    if size == 0 {
        return Err(Error::new(
            E_FAIL,
            format!(
                "Output file is empty (0 bytes): {}\nFFmpeg stderr:\n{stderr}",
                path.display()
            ),
        ));
    }

    if !ffmpeg_ok {
        return Err(Error::new(
            E_FAIL,
            format!(
                "FFmpeg exited with non-zero status. Output file exists ({size} bytes) but may be incomplete: {}\nFFmpeg stderr:\n{stderr}",
                path.display()
            ),
        ));
    }

    eprintln!(
        "[Snap] Output validated OK: {} ({size} bytes)",
        path.display()
    );
    Ok(())
}

// ── Frame processing ─────────────────────────────────────────────────────────

fn write_frame_to_ffmpeg(
    frame: &Direct3D11CaptureFrame,
    device: &ID3D11Device,
    context: &ID3D11DeviceContext,
    stdin: &Arc<Mutex<ChildStdin>>,
    staging_cache: &mut Option<(ID3D11Texture2D, u32, u32)>,
    crop: Option<CropRect>,
) -> Result<()> {
    let surface = frame.Surface()?;

    let dxgi_access: IDirect3DDxgiInterfaceAccess = surface.cast()?;
    let texture: ID3D11Texture2D = unsafe { dxgi_access.GetInterface()? };

    let mut desc = D3D11_TEXTURE2D_DESC::default();
    unsafe { texture.GetDesc(&mut desc) };

    // Reuse the staging texture if dimensions match, otherwise create a new one.
    let staging = match staging_cache {
        Some((ref cached, w, h)) if *w == desc.Width && *h == desc.Height => cached.clone(),
        _ => {
            let mut staging_desc = desc;
            staging_desc.Usage = D3D11_USAGE_STAGING;
            staging_desc.BindFlags = 0;
            staging_desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
            staging_desc.MiscFlags = 0;

            let mut new_staging: Option<ID3D11Texture2D> = None;
            unsafe { device.CreateTexture2D(&staging_desc, None, Some(&mut new_staging))? };
            let new_staging = new_staging.unwrap();
            *staging_cache = Some((new_staging.clone(), desc.Width, desc.Height));
            new_staging
        }
    };

    unsafe { context.CopyResource(&staging, &texture) };

    let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
    unsafe {
        context.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))?;
    }

    let crop = crop.unwrap_or(CropRect {
        x: 0,
        y: 0,
        w: desc.Width,
        h: desc.Height,
    });
    let height = crop.h as usize;
    let row_pitch = mapped.RowPitch as usize;
    let packed_row = (crop.w * 4) as usize;

    let mut buf = Vec::with_capacity(packed_row * height);
    unsafe {
        for row in 0..height {
            let src = (mapped.pData as *const u8)
                .add((row + crop.y as usize) * row_pitch + crop.x as usize * 4);
            let slice = std::slice::from_raw_parts(src, packed_row);
            buf.extend_from_slice(slice);
        }
    }

    unsafe { context.Unmap(&staging, 0) };

    let mut writer = stdin
        .lock()
        .map_err(|_| Error::new(E_FAIL, "FFmpeg input pipe lock was poisoned"))?;
    writer.write_all(&buf).map_err(|error| {
        Error::new(
            E_FAIL,
            format!("FFmpeg input pipe rejected a frame: {error}"),
        )
    })?;

    Ok(())
}
