use std::ffi::c_void;
use std::io::{Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
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

// ── Utility: get user's Videos directory path ────────────────────────────────

#[tauri::command]
pub fn get_videos_dir() -> std::result::Result<String, String> {
    let userprofile = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".to_string());
    let videos = std::path::PathBuf::from(&userprofile).join("Videos");
    Ok(videos.to_string_lossy().to_string())
}

// ── Capture handle (held by the Tauri command thread) ────────────────────────

struct CaptureHandle {
    is_recording: Arc<AtomicBool>,
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
        let _ = EnumWindows(Some(callback), LPARAM(&raw mut ctx as *mut Ctx as isize));
    }
}

// ── Start recording (async — never blocks the UI thread) ─────────────────────

#[tauri::command]
pub async fn start_recording(
    target_id: String,
    output_path: String,
) -> std::result::Result<(), String> {
    let mut guard = STATE.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Err("Recording already in progress".to_string());
    }

    let is_recording = Arc::new(AtomicBool::new(true));
    let (done_tx, done_rx) = tokio::sync::oneshot::channel();
    let is_rec_clone = is_recording.clone();

    // Use std::thread::spawn instead of tokio::task::spawn_blocking to guarantee
    // a fresh thread with no prior COM initialization (avoids RPC_E_CHANGED_MODE).
    thread::spawn(move || {
        let result = run_capture_thread(&target_id, &output_path, is_rec_clone);
        let _ = done_tx.send(result);
    });

    *guard = Some(CaptureHandle {
        is_recording,
        done_rx,
    });

    Ok(())
}

// ── Stop recording (async — never blocks the UI thread) ──────────────────────

#[tauri::command]
pub async fn stop_recording() -> std::result::Result<(), String> {
    let handle = {
        let mut guard = STATE.lock().map_err(|e| e.to_string())?;
        guard.take().ok_or_else(|| "No recording in progress".to_string())?
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
    is_recording: Arc<AtomicBool>,
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
        eprintln!("[Snap] Step 3/7: Capture item created OK ({width}x{height})");

        // ── Step 4: FFmpeg subprocess ──
        let abs_path_str = abs_path.to_string_lossy().to_string();
        let (mut ffmpeg_child, ffmpeg_stdin, used_nvenc) =
            spawn_ffmpeg(&abs_path_str, width, height)?;
        if used_nvenc {
            eprintln!("[Snap] Step 4/7: FFmpeg spawned OK (NVENC hardware encoder)");
        } else {
            eprintln!(
                "[Snap] Step 4/7: FFmpeg spawned OK (WARNING: libx264 software fallback)"
            );
        }

        // ── Step 5: Frame pool + capture session ──
        eprintln!("[Snap] Step 5/7: Creating Direct3D11 frame pool...");
        let frame_pool = Direct3D11CaptureFramePool::Create(
            &d3d_device,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            2,
            size,
        )?;
        let session = frame_pool.CreateCaptureSession(&item)?;
        eprintln!("[Snap] Step 5/7: Frame pool and capture session created OK");

        // ── Step 6: Start capture (polling — no DispatcherQueue needed) ──
        eprintln!("[Snap] Step 6/7: Starting capture session (polling mode)...");
        let stdin = Arc::new(Mutex::new(ffmpeg_stdin));
        session.StartCapture()?;
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

        while is_recording.load(Ordering::Relaxed) {
            let now = Instant::now();
            match frame_pool.TryGetNextFrame() {
                Ok(frame) => {
                    frame_count += 1;

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
                        ) {
                            eprintln!("[Snap] frame write error: {e}");
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
                }
            }
            thread::sleep(Duration::from_millis(2));
        }

        eprintln!("[Snap] Polled {frame_count} frames, sent {frames_sent} to FFmpeg");
        drop(stdin);

        // ── Cleanup ──
        session.Close()?;
        frame_pool.Close()?;
        eprintln!("[Snap] Session & frame pool closed — finalizing FFmpeg...");

        // Wait for FFmpeg with timeout, then read its stderr
        let ffmpeg_status = wait_for_ffmpeg(&mut ffmpeg_child);
        let stderr_text = read_ffmpeg_stderr(&mut ffmpeg_child);

        eprintln!("[Snap] FFmpeg stderr:\n{stderr_text}");

        unsafe { CoUninitialize() };
        eprintln!("[Snap] COM uninitialized");

        // ── File verification ──
        validate_output(&abs_path, ffmpeg_status, &stderr_text)?;

        Ok(())
    })();

    result.map_err(|e| format!("{e}"))
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
    let interop: IGraphicsCaptureItemInterop =
        unsafe { RoGetActivationFactory(&class_name) }?;

    if let Some(hmonitor) = hmonitor_from_id(target_id) {
        unsafe { interop.CreateForMonitor(hmonitor) }
    } else if let Some(hwnd) = hwnd_from_id(target_id) {
        unsafe { interop.CreateForWindow(hwnd) }
    } else {
        Err(Error::from_hresult(E_INVALIDARG))
    }
}

// ── FFmpeg subprocess ────────────────────────────────────────────────────────

fn spawn_ffmpeg(
    output_path: &str,
    width: u32,
    height: u32,
) -> Result<(Child, ChildStdin, bool)> {
    let size = format!("{width}x{height}");

    let nvenc_args = [
        "-y", "-f", "rawvideo", "-pixel_format", "bgra",
        "-video_size", &size, "-framerate", "60", "-i", "pipe:0",
        "-c:v", "h264_nvenc", "-preset", "p1", "-b:v", "12M",
        "-pix_fmt", "yuv420p", output_path,
    ];

    let x264_args = [
        "-y", "-f", "rawvideo", "-pixel_format", "bgra",
        "-video_size", &size, "-framerate", "60", "-i", "pipe:0",
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-pix_fmt", "yuv420p", output_path,
    ];

    fn try_ffmpeg(args: &[&str]) -> std::result::Result<Child, std::io::Error> {
        Command::new("ffmpeg")
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
    }

    // Try NVENC first. Spawn succeeded doesn't mean the encoder works —
    // FFmpeg may exit immediately if h264_nvenc isn't available. Wait briefly
    // and check whether the process is still alive before committing to it.
    if let Ok(mut child) = try_ffmpeg(&nvenc_args) {
        thread::sleep(Duration::from_millis(500));
        match child.try_wait() {
            Ok(Some(status)) => {
                // FFmpeg exited within 500ms — NVENC likely unavailable
                eprintln!(
                    "[Snap] NVENC probe: FFmpeg exited immediately (status={status}), \
                     falling back to libx264"
                );
            }
            Ok(None) => {
                // Still running — NVENC is working
                let stdin = child.stdin.take().unwrap();
                return Ok((child, stdin, true));
            }
            Err(e) => {
                eprintln!("[Snap] NVENC probe: try_wait error ({e}), falling back to libx264");
            }
        }
    }

    match try_ffmpeg(&x264_args) {
        Ok(mut child) => {
            let stdin = child.stdin.take().unwrap();
            Ok((child, stdin, false))
        }
        Err(e) => Err(Error::new(E_FAIL, format!("FFmpeg failed to start: {e}"))),
    }
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

fn read_ffmpeg_stderr(child: &mut Child) -> String {
    let mut stderr = match child.stderr.take() {
        Some(s) => s,
        None => return "(no stderr captured)".to_string(),
    };
    let mut buf = String::new();
    let _ = stderr.read_to_string(&mut buf);
    if buf.is_empty() {
        "(stderr empty)".to_string()
    } else {
        buf
    }
}

fn validate_output(
    path: &std::path::Path,
    ffmpeg_ok: bool,
    stderr: &str,
) -> Result<()> {
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

    eprintln!("[Snap] Output validated OK: {} ({size} bytes)", path.display());
    Ok(())
}

// ── Frame processing ─────────────────────────────────────────────────────────

fn write_frame_to_ffmpeg(
    frame: &Direct3D11CaptureFrame,
    device: &ID3D11Device,
    context: &ID3D11DeviceContext,
    stdin: &Arc<Mutex<ChildStdin>>,
    staging_cache: &mut Option<(ID3D11Texture2D, u32, u32)>,
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

    let height = desc.Height as usize;
    let row_pitch = mapped.RowPitch as usize;
    let packed_row = (desc.Width * 4) as usize;

    let mut buf = Vec::with_capacity(packed_row * height);
    unsafe {
        for row in 0..height {
            let src = (mapped.pData as *const u8).add(row * row_pitch);
            let slice = std::slice::from_raw_parts(src, packed_row);
            buf.extend_from_slice(slice);
        }
    }

    unsafe { context.Unmap(&staging, 0) };

    if let Ok(mut writer) = stdin.lock() {
        let _ = writer.write_all(&buf);
    }

    Ok(())
}
