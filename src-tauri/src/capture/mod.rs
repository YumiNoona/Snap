use std::collections::HashSet;
use std::ffi::c_void;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use crate::process::{background_command, recording_command, spawn_recording_child};

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

macro_rules! eprintln {
    ($($arg:tt)*) => { crate::process::recording_diagnostic(format_args!($($arg)*)) };
}

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

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingOptions {
    pub fps: u32,
    pub bitrate_mbps: u32,
    pub max_width: Option<u32>,
    pub max_height: Option<u32>,
    pub allow_software_encoder: bool,
}

impl Default for RecordingOptions {
    fn default() -> Self {
        Self {
            fps: 30,
            bitrate_mbps: 8,
            max_width: Some(1920),
            max_height: Some(1080),
            allow_software_encoder: true,
        }
    }
}

impl RecordingOptions {
    fn sanitized(self) -> Self {
        Self {
            fps: if self.fps >= 50 {
                60
            } else if self.fps <= 26 {
                24
            } else {
                30
            },
            bitrate_mbps: self.bitrate_mbps.clamp(2, 50),
            max_width: self.max_width.map(|value| value.clamp(640, 7680)),
            max_height: self.max_height.map(|value| value.clamp(360, 4320)),
            allow_software_encoder: self.allow_software_encoder,
        }
    }
}

#[derive(Clone, Copy)]
struct CropRect {
    x: u32,
    y: u32,
    w: u32,
    h: u32,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum GpuVendor {
    Nvidia,
    Amd,
    Intel,
    Other,
}

#[derive(Clone, Copy)]
struct GpuCapability {
    vendor: GpuVendor,
    dedicated_video_memory: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingRecommendation {
    pub options: RecordingOptions,
    pub encoder: String,
    pub hardware_encoding: bool,
    pub summary: String,
}

impl GpuVendor {
    fn encoder_rank(self, name: &str) -> u8 {
        let preferred = match self {
            Self::Nvidia => "NVENC",
            Self::Amd => "AMD",
            Self::Intel => "Intel",
            Self::Other => "Media Foundation",
        };
        if name.contains(preferred) {
            0
        } else if name.contains("Media Foundation") {
            1
        } else if name.contains("compatibility") {
            3
        } else {
            2
        }
    }
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
pub async fn recording_preflight(
    output_path: String,
    expected_seconds: Option<u64>,
    bitrate_mbps: Option<u64>,
) -> std::result::Result<RecordingPreflight, String> {
    tauri::async_runtime::spawn_blocking(move || {
        recording_preflight_blocking(output_path, expected_seconds, bitrate_mbps)
    })
    .await
    .map_err(|error| format!("Recording preflight worker failed: {error}"))?
}

fn recording_preflight_blocking(
    output_path: String,
    expected_seconds: Option<u64>,
    bitrate_mbps: Option<u64>,
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
    let video_bytes_per_second = bitrate_mbps.unwrap_or(8).clamp(2, 50) * 125_000;
    let audio_bytes_per_second = 288_000u64;
    // Live fragments and the editor-ready file coexist during finalization.
    let required_bytes = (seconds
        .saturating_mul(video_bytes_per_second + audio_bytes_per_second)
        .saturating_mul(2))
    .saturating_add(536_870_912)
    .max(1_073_741_824);
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
    let ffprobe_available = crate::process::background_command("ffprobe")
        .arg("-version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if !ffprobe_available {
        return Err("FFmpeg is unavailable because its ffprobe companion is missing. Reinstall the bundled FFmpeg package before recording.".to_string());
    }
    let filters = crate::process::background_command("ffmpeg")
        .args(["-hide_banner", "-filters"])
        .output()
        .map_err(|error| format!("Unable to inspect FFmpeg capture support: {error}"))?;
    let filter_text = format!(
        "{}{}",
        String::from_utf8_lossy(&filters.stdout),
        String::from_utf8_lossy(&filters.stderr)
    );
    if !filter_text.contains("gfxcapture") && !filter_text.contains("ddagrab") {
        return Err("The installed FFmpeg build has no Windows GPU capture filter. Install a current Gyan Essentials or Full build.".to_string());
    }
    let encoders = crate::process::background_command("ffmpeg")
        .args(["-hide_banner", "-encoders"])
        .output()
        .map_err(|error| format!("Unable to inspect FFmpeg encoder support: {error}"))?;
    let encoder_text = format!(
        "{}{}",
        String::from_utf8_lossy(&encoders.stdout),
        String::from_utf8_lossy(&encoders.stderr)
    );
    if !["h264_nvenc", "h264_amf", "h264_qsv", "h264_mf", "libx264"]
        .iter()
        .any(|encoder| encoder_text.contains(encoder))
    {
        return Err("The installed FFmpeg build contains no compatible H.264 encoder.".to_string());
    }
    Ok(RecordingPreflight {
        available_bytes,
        required_bytes,
        ffmpeg_available,
        writable,
    })
}

/// Select a conservative profile for the display and the encoders that can
/// actually start on this machine. The short synthetic probe is cached, so it
/// runs once per adapter class rather than before every recording.
#[tauri::command]
pub async fn recommend_recording_options(
    target_id: String,
) -> std::result::Result<RecordingRecommendation, String> {
    tauri::async_runtime::spawn_blocking(move || recommend_recording_options_blocking(&target_id))
        .await
        .map_err(|error| format!("Recording capability check failed: {error}"))?
}

fn recommend_recording_options_blocking(
    target_id: &str,
) -> std::result::Result<RecordingRecommendation, String> {
    let ffmpeg_available = background_command("ffmpeg")
        .arg("-version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if !ffmpeg_available {
        return Err("FFmpeg is unavailable for the automatic performance check".to_string());
    }
    static CACHE: OnceLock<Mutex<Vec<(GpuVendor, u64, RecordingRecommendation)>>> = OnceLock::new();

    let capability = target_gpu_capability(target_id);
    let memory_bucket = capability.dedicated_video_memory / (512 * 1024 * 1024);
    let cache = CACHE.get_or_init(|| Mutex::new(Vec::new()));
    if let Some((_, _, recommendation)) = cache
        .lock()
        .map_err(|error| error.to_string())?
        .iter()
        .find(|(vendor, memory, _)| *vendor == capability.vendor && *memory == memory_bucket)
        .cloned()
    {
        return Ok(recommendation);
    }

    let mut candidates = vec![
        ("NVIDIA NVENC", "h264_nvenc"),
        ("AMD AMF", "h264_amf"),
        ("Intel Quick Sync", "h264_qsv"),
        ("Windows Media Foundation", "h264_mf"),
    ];
    candidates.sort_by_key(|(label, _)| capability.vendor.encoder_rank(label));
    let working_hardware = candidates
        .into_iter()
        .find(|(_, encoder)| probe_h264_encoder(encoder));
    let logical_cores = std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(2);

    let (options, encoder, hardware_encoding, summary) = if let Some((label, _)) = working_hardware
    {
        let dedicated = capability.dedicated_video_memory >= 2 * 1024 * 1024 * 1024;
        let (fps, max_width, max_height, bitrate_mbps) = if dedicated {
            // Automatic means "stay out of the user's way", even on a fast
            // GPU. A 720p encode touches less than half as many pixels as
            // 1080p and leaves substantially more copy/VRAM bandwidth for
            // browsers, Unreal Engine, games, and video calls.
            (30, 1280, 720, 4)
        } else {
            (24, 1280, 720, 3)
        };
        (
            RecordingOptions {
                fps,
                bitrate_mbps,
                max_width: Some(max_width),
                max_height: Some(max_height),
                allow_software_encoder: true,
            },
            label.to_string(),
            true,
            format!(
                "{max_width}x{max_height} at {fps} FPS using {label}; low-impact capture protects other apps"
            ),
        )
    } else {
        let (fps, max_width, max_height, bitrate_mbps) = if logical_cores >= 8 {
            (30, 1280, 720, 4)
        } else if logical_cores >= 4 {
            (24, 1280, 720, 3)
        } else {
            (24, 960, 540, 2)
        };
        (
            RecordingOptions {
                fps,
                bitrate_mbps,
                max_width: Some(max_width),
                max_height: Some(max_height),
                allow_software_encoder: true,
            },
            "low-priority CPU compatibility encoder".to_string(),
            false,
            format!(
                "{max_width}x{max_height} at {fps} FPS using a bounded CPU encoder ({logical_cores} logical cores detected)"
            ),
        )
    };
    let recommendation = RecordingRecommendation {
        options,
        encoder,
        hardware_encoding,
        summary,
    };
    cache.lock().map_err(|error| error.to_string())?.push((
        capability.vendor,
        memory_bucket,
        recommendation.clone(),
    ));
    Ok(recommendation)
}

fn probe_h264_encoder(encoder: &str) -> bool {
    let mut command = background_command("ffmpeg");
    command.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=black:s=640x360:r=30:d=0.15",
        "-frames:v",
        "4",
        "-c:v",
        encoder,
    ]);
    if encoder == "h264_mf" {
        command.args(["-hw_encoding", "1"]);
    }
    command
        .args(["-f", "null", "-"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
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
    resume_ready: Arc<AtomicBool>,
    done_rx: tokio::sync::oneshot::Receiver<std::result::Result<(), String>>,
}

#[derive(Clone)]
struct CaptureRuntime {
    is_recording: Arc<AtomicBool>,
    is_paused: Arc<AtomicBool>,
    resume_ready: Arc<AtomicBool>,
    startup_tx: std::sync::mpsc::Sender<std::result::Result<(), String>>,
}

static STATE: Mutex<Option<CaptureHandle>> = Mutex::new(None);
static GFXCAPTURE_AVAILABLE: OnceLock<bool> = OnceLock::new();
const RESILIENT_MP4_MOVFLAGS: &str = "+frag_keyframe+empty_moov+default_base_moof";
const EDITOR_READY_MOVFLAGS: &str = "+faststart";

fn editor_ready_fps_filter(fps: u32) -> String {
    format!("fps=fps={}:round=near:start_time=0", fps.clamp(24, 60))
}

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

/// Resolve the owning process for an exact window capture. Display and custom
/// region captures deliberately return `None` because their pixels may contain
/// audio from more than one application.
pub(crate) fn process_id_for_target(target_id: &str) -> Option<u32> {
    let hwnd = hwnd_from_id(target_id)?;
    let mut process_id = 0u32;
    unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut process_id));
    }
    (process_id != 0).then_some(process_id)
}

fn widestr_to_string(wide: &[u16]) -> String {
    let len = wide.iter().position(|&c| c == 0).unwrap_or(wide.len());
    String::from_utf16_lossy(&wide[..len])
}

fn has_gfxcapture() -> bool {
    *GFXCAPTURE_AVAILABLE.get_or_init(|| {
        background_command("ffmpeg")
            .args(["-hide_banner", "-h", "filter=gfxcapture"])
            .stdin(Stdio::null())
            .output()
            .map(|output| {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                output.status.success()
                    && (stdout.contains("Filter gfxcapture")
                        || stderr.contains("Filter gfxcapture"))
            })
            .unwrap_or(false)
    })
}

fn constrained_size(width: u32, height: u32, options: RecordingOptions) -> (u32, u32) {
    let Some(max_width) = options.max_width else {
        return (width & !1, height & !1);
    };
    let max_height = options.max_height.unwrap_or(u32::MAX);
    if width <= max_width && height <= max_height {
        return (width & !1, height & !1);
    }
    let scale =
        (max_width as f64 / width.max(1) as f64).min(max_height as f64 / height.max(1) as f64);
    (
        ((width as f64 * scale).round() as u32).max(2) & !1,
        ((height as f64 * scale).round() as u32).max(2) & !1,
    )
}

fn gfxcapture_common(width: u32, height: u32, options: RecordingOptions) -> String {
    let (output_width, output_height) = constrained_size(width, height, options);
    format!(
        "capture_cursor=0:capture_border=0:display_border=0:max_framerate={}:width={output_width}:height={output_height}:resize_mode=scale_aspect:output_fmt=8bit",
        options.fps
    )
}

fn gfxcapture_source(
    target_id: &str,
    crop: Option<CropRect>,
    options: RecordingOptions,
) -> Option<(String, String)> {
    if let Some(hwnd) = hwnd_from_id(target_id) {
        let bounds = get_target_bounds(target_id.to_string()).unwrap_or(TargetBounds {
            x: 0,
            y: 0,
            w: 1920,
            h: 1080,
        });
        let common = gfxcapture_common(bounds.w.max(2) as u32, bounds.h.max(2) as u32, options);
        let source = format!("gfxcapture=hwnd={}:{common}", hwnd.0 as usize);
        return Some((source, "window".to_string()));
    }
    let monitor = hmonitor_from_id(target_id)?;
    let Some(crop) = crop else {
        let bounds = get_target_bounds(target_id.to_string()).unwrap_or(TargetBounds {
            x: 0,
            y: 0,
            w: 1920,
            h: 1080,
        });
        let common = gfxcapture_common(bounds.w.max(2) as u32, bounds.h.max(2) as u32, options);
        return Some((
            format!("gfxcapture=hmonitor={}:{common}", monitor.0 as usize),
            "full display".to_string(),
        ));
    };
    let bounds = get_target_bounds(target_id.to_string()).ok()?;
    let source = gfxcapture_region_source(
        monitor.0 as usize,
        crop,
        bounds.w.max(0) as u32,
        bounds.h.max(0) as u32,
        options,
    );
    Some((source, "custom region".to_string()))
}

fn gfxcapture_region_source(
    monitor: usize,
    crop: CropRect,
    monitor_width: u32,
    monitor_height: u32,
    options: RecordingOptions,
) -> String {
    let right = monitor_width.saturating_sub(crop.x.saturating_add(crop.w));
    let bottom = monitor_height.saturating_sub(crop.y.saturating_add(crop.h));
    let common = gfxcapture_common(crop.w, crop.h, options);
    format!("gfxcapture=hmonitor={monitor}:crop_left={}:crop_top={}:crop_right={right}:crop_bottom={bottom}:{common}", crop.x, crop.y)
}

fn desktop_duplication_source(output_index: u32, options: RecordingOptions) -> String {
    // Keep duplicate frames enabled. Omitting unchanged frames makes the MP4
    // end at the last visual update rather than at Stop, while independently
    // clocked WAV tracks correctly continue to the real recording end.
    format!(
        "ddagrab=output_idx={output_index}:framerate={}:draw_mouse=0:dup_frames=1:output_fmt=8bit",
        options.fps
    )
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

/// FFmpeg's `ddagrab=output_idx=` is relative to the adapter backing its D3D11
/// device. Without an explicit FFmpeg adapter selection that is adapter zero,
/// so never pass a global cross-adapter index here.
fn desktop_duplication_output_index(hmonitor: HMONITOR) -> Result<Option<u32>> {
    let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1()? };
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
                return Ok((adapter_idx == 0).then_some(output_idx));
            }
        }
    }
    Err(Error::new(
        E_FAIL,
        "Selected display is unavailable to Desktop Duplication",
    ))
}

fn target_gpu_capability(target_id: &str) -> GpuCapability {
    let monitor = hmonitor_from_id(target_id).or_else(|| {
        hwnd_from_id(target_id)
            .map(|window| unsafe { MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST) })
    });
    let Some(monitor) = monitor else {
        return GpuCapability {
            vendor: GpuVendor::Other,
            dedicated_video_memory: 0,
        };
    };
    let Ok(factory) = (unsafe { CreateDXGIFactory1::<IDXGIFactory1>() }) else {
        return GpuCapability {
            vendor: GpuVendor::Other,
            dedicated_video_memory: 0,
        };
    };
    for adapter_index in 0u32.. {
        let Ok(adapter) = (unsafe { factory.EnumAdapters1(adapter_index) }) else {
            break;
        };
        for output_index in 0u32.. {
            let Ok(output) = (unsafe { adapter.EnumOutputs(output_index) }) else {
                break;
            };
            if unsafe { output.GetDesc() }.is_ok_and(|description| description.Monitor == monitor) {
                let description = unsafe { adapter.GetDesc1() }.unwrap_or_default();
                let vendor = match description.VendorId {
                    0x10de => GpuVendor::Nvidia,
                    0x1002 | 0x1022 => GpuVendor::Amd,
                    0x8086 => GpuVendor::Intel,
                    _ => GpuVendor::Other,
                };
                return GpuCapability {
                    vendor,
                    dedicated_video_memory: description.DedicatedVideoMemory as u64,
                };
            }
        }
    }
    GpuCapability {
        vendor: GpuVendor::Other,
        dedicated_video_memory: 0,
    }
}

fn target_gpu_vendor(target_id: &str) -> GpuVendor {
    target_gpu_capability(target_id).vendor
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
    options: Option<RecordingOptions>,
) -> std::result::Result<(), String> {
    let gpu_vendor = target_gpu_vendor(&target_id);
    let options = options.unwrap_or_default().sanitized();
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
    let resume_ready = Arc::new(AtomicBool::new(true));
    let (done_tx, done_rx) = tokio::sync::oneshot::channel();
    let (startup_tx, startup_rx) = std::sync::mpsc::channel::<std::result::Result<(), String>>();
    let runtime = CaptureRuntime {
        is_recording: is_recording.clone(),
        is_paused: is_paused.clone(),
        resume_ready: resume_ready.clone(),
        startup_tx: startup_tx.clone(),
    };
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
        let result =
            run_capture_thread(&target_id, &output_path, crop, options, gpu_vendor, runtime);
        if let Err(error) = &result {
            let _ = startup_tx.send(Err(error.clone()));
        }
        let _ = done_tx.send(result);
    });

    match startup_rx.recv_timeout(Duration::from_secs(30)) {
        Ok(Ok(())) => {}
        Ok(Err(error)) => return Err(error),
        Err(_) => {
            is_recording.store(false, Ordering::SeqCst);
            return Err("Recorder failed to initialize within 30 seconds".to_string());
        }
    }

    *guard = Some(CaptureHandle {
        is_recording,
        is_paused,
        resume_ready,
        done_rx,
    });

    Ok(())
}

/// Pause (true) or resume (false) the current recording. While paused, no
/// video frames are written to FFmpeg — the paused segment is omitted from
/// the output file entirely.
#[tauri::command]
pub fn set_paused(paused: bool) -> std::result::Result<(), String> {
    let resume_ready = {
        let guard = STATE.lock().map_err(|e| e.to_string())?;
        let handle = guard
            .as_ref()
            .ok_or_else(|| "No recording is active".to_string())?;
        if paused {
            handle.resume_ready.store(false, Ordering::Release);
        }
        handle.is_paused.store(paused, Ordering::SeqCst);
        handle.resume_ready.clone()
    };
    if !paused {
        let deadline = Instant::now() + Duration::from_secs(6);
        while !resume_ready.load(Ordering::Acquire) {
            if Instant::now() >= deadline {
                return Err("Video capture did not resume within 6 seconds".to_string());
            }
            thread::sleep(Duration::from_millis(10));
        }
    }
    eprintln!("[Snap] Recording {}paused", if paused { "" } else { "un" });
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

    match handle.done_rx.await {
        Ok(result) => result,
        Err(_) => Err("Capture thread failed (no result)".to_string()),
    }
}

// ── Capture thread (runs on a dedicated OS thread via thread::spawn) ─────────

fn run_capture_thread(
    target_id: &str,
    output_path: &str,
    crop: Option<CropRect>,
    options: RecordingOptions,
    gpu_vendor: GpuVendor,
    runtime: CaptureRuntime,
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

    // Prefer Windows.Graphics.Capture for windows, regions, and full monitors.
    // Its compositor-friendly monitor path does not hold Desktop Duplication's
    // output surface continuously, which can starve Chromium video overlays on
    // some hybrid/NVIDIA laptops even when Task Manager reports modest load.
    if has_gfxcapture() {
        if let Some((source, label)) = gfxcapture_source(target_id, crop, options) {
            return run_segmented_gpu_capture(
                &source, &label, &abs_path, options, gpu_vendor, runtime,
            );
        }
    }
    // Older FFmpeg builds may not expose gfxcapture. Keep Desktop Duplication
    // as a full-display-only hardware fallback rather than silently changing a
    // monitor recording into whichever foreground window happens to be active.
    if crop.is_none() {
        if let Some(monitor) = hmonitor_from_id(target_id) {
            if let Some(output_index) =
                desktop_duplication_output_index(monitor).map_err(|error| error.to_string())?
            {
                let source = desktop_duplication_source(output_index, options);
                return run_segmented_gpu_capture(
                    &source,
                    "full display fallback",
                    &abs_path,
                    options,
                    gpu_vendor,
                    runtime,
                );
            }
            eprintln!("[Snap] Selected monitor is on a non-default adapter; using the adapter-safe Windows.Graphics.Capture fallback");
        }
    }

    let CaptureRuntime {
        is_recording,
        is_paused,
        resume_ready,
        startup_tx,
    } = runtime;
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
            spawn_ffmpeg(&abs_path_str, encode_w, encode_h, options, gpu_vendor)?;
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
        eprintln!("[Snap] Step 6/7: Capture session armed; waiting for first encoded frame");

        // ── Step 7: Poll for frames ──
        eprintln!("[Snap] Step 7/7: polling for frames (first frame 3s timeout)...");
        let mut frame_count: u64 = 0;
        let mut frames_sent: u64 = 0;
        let first_frame_deadline = Instant::now() + Duration::from_secs(3);
        let mut log_interval = Instant::now();
        let frame_interval = Duration::from_secs_f64(1.0 / options.fps as f64);
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
                resume_ready.store(true, Ordering::Release);
                continue;
            }

            let now = Instant::now();
            match frame_pool.TryGetNextFrame() {
                Ok(frame) => {
                    last_frame_at = now;
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
                            if frames_sent == 0 {
                                // Do not release audio capture until video time
                                // zero actually exists. A capture session can be
                                // armed several frames before WGC delivers data.
                                crate::input_hook::mark_capture_start();
                                let _ = startup_tx.send(Ok(()));
                                eprintln!("[Snap] Step 7/7: first encoded frame committed");
                            }
                            frames_sent += 1;
                        }
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
        crate::input_hook::mark_capture_end(frames_sent, options.fps);
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

fn run_segmented_gpu_capture(
    source: &str,
    source_label: &str,
    output_path: &Path,
    options: RecordingOptions,
    gpu_vendor: GpuVendor,
    runtime: CaptureRuntime,
) -> std::result::Result<(), String> {
    let CaptureRuntime {
        is_recording,
        is_paused,
        resume_ready,
        startup_tx,
    } = runtime;
    let stem = output_path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy();
    let parent = output_path.parent().unwrap_or_else(|| Path::new("."));
    let mut parts = Vec::new();
    let mut part_index = 0usize;
    let mut recovery_attempts = 0usize;
    let mut started = false;
    let mut last_diagnostics = String::new();
    let mut excluded_encoders = HashSet::new();
    let mut terminal_failure = None;
    let mut total_frames = 0u64;

    while is_recording.load(Ordering::Relaxed) {
        let part = parent.join(format!("{stem}.capture-part-{part_index}.mp4"));
        let _ = std::fs::remove_file(&part);
        let SpawnedCapture {
            mut child,
            mut control,
            encoder,
            encoded_timeline,
            progress,
            progress_reader,
        } = match spawn_gpu_capture(source, &part, options, gpu_vendor, &excluded_encoders) {
            Ok(value) => value,
            Err(error) if started => {
                terminal_failure = Some(format!(
                    "Capture could not restart with another encoder: {error}"
                ));
                break;
            }
            Err(error) => return Err(error),
        };
        let stderr = child.stderr.take();
        let stderr_reader = thread::spawn(move || {
            let mut diagnostics = String::new();
            if let Some(mut stream) = stderr {
                let _ = stream.read_to_string(&mut diagnostics);
            }
            diagnostics
        });
        if !started {
            // FFmpeg normalizes the first encoded frame to media time zero.
            // Anchor the shared audio/input epoch to that frame, not process
            // launch: GPU/filter initialization can take more than a second
            // on some laptops, which otherwise becomes leading WAV time and
            // makes speech visibly trail the picture.
            crate::input_hook::mark_capture_start_with_lead(encoded_timeline);
            let _ = startup_tx.send(Ok(()));
            started = true;
        } else {
            // The encoder is alive again after a coordinated pause. Audio and
            // input remain paused until set_paused(false) observes this flag.
            resume_ready.store(true, Ordering::Release);
        }
        eprintln!("[Snap] GPU {source_label} segment {part_index} started ({encoder})");
        let mut exited = false;
        let mut paused_segment = false;
        let mut segment_exit_ok = true;
        let mut segment_exit_status = String::new();
        let mut health_check = Instant::now();
        let mut last_progress_frame = progress.frame.load(Ordering::Relaxed);
        while is_recording.load(Ordering::Relaxed) {
            if let Ok(Some(status)) = child.try_wait() {
                eprintln!("[Snap] GPU capture segment ended ({status}); attempting recovery");
                segment_exit_ok = status.success();
                segment_exit_status = status.to_string();
                exited = true;
                break;
            }
            if is_paused.load(Ordering::Acquire) {
                paused_segment = true;
                break;
            }
            if health_check.elapsed() >= Duration::from_secs(5) {
                health_check = Instant::now();
                if let Ok(free) = fs2::available_space(parent) {
                    if free < 536_870_912 {
                        terminal_failure = Some(format!("Recording stopped safely because disk space fell below 512 MB ({} MB remaining)", free / 1_048_576));
                        break;
                    }
                }
                let frame = progress.frame.load(Ordering::Relaxed);
                let media_us = progress.out_time_us.load(Ordering::Relaxed);
                let size = std::fs::metadata(&part)
                    .map(|value| value.len())
                    .unwrap_or(0);
                eprintln!(
                    "[Snap] Capture health: frame={frame}, media={:.1}s, segment={:.1} MB",
                    media_us as f64 / 1_000_000.0,
                    size as f64 / 1_048_576.0
                );
                if frame == last_progress_frame {
                    eprintln!("[Snap] No new encoded frame in 5 seconds; the target may be static or temporarily unavailable");
                }
                last_progress_frame = frame;
            }
            thread::sleep(Duration::from_millis(20));
        }
        if !exited {
            let _ = control.write_all(b"q\n");
            drop(control);
            segment_exit_ok = wait_for_ffmpeg(&mut child);
            if !segment_exit_ok {
                segment_exit_status =
                    "FFmpeg crashed while finalizing the capture segment".to_string();
            }
        }
        last_diagnostics = stderr_reader.join().unwrap_or_default();
        let _ = progress_reader.join();
        total_frames = total_frames.saturating_add(progress.frame.load(Ordering::Relaxed));
        if !segment_exit_status.is_empty() {
            if !last_diagnostics.is_empty() {
                last_diagnostics.push('\n');
            }
            last_diagnostics.push_str(&segment_exit_status);
        }
        match validate_capture_segment(&part) {
            Ok(()) => {
                if !segment_exit_ok {
                    eprintln!(
                        "[Snap] Encoder exited abnormally, but its fragmented segment is recoverable"
                    );
                }
                parts.push(part);
            }
            Err(error) => {
                eprintln!("[Snap] Discarding unusable capture segment: {error}");
                let _ = std::fs::remove_file(&part);
            }
        }
        if terminal_failure.is_some() {
            break;
        }
        if !is_recording.load(Ordering::Relaxed) {
            break;
        }
        part_index += 1;
        if paused_segment {
            while is_paused.load(Ordering::Acquire) && is_recording.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(10));
            }
            if !is_recording.load(Ordering::Relaxed) {
                break;
            }
            continue;
        }
        if exited {
            excluded_encoders.insert(encoder.to_string());
        }
        recovery_attempts += 1;
        if recovery_attempts > 5 {
            terminal_failure = Some(format!(
                "Desktop capture could not recover after 5 display resets: {last_diagnostics}"
            ));
            break;
        }
        thread::sleep(Duration::from_millis(350));
    }

    crate::input_hook::mark_capture_end(total_frames, options.fps);
    finalize_capture_parts(&parts, output_path, &last_diagnostics, options)?;
    for part in parts {
        let _ = std::fs::remove_file(part);
    }
    if let Some(error) = terminal_failure {
        return Err(error);
    }
    Ok(())
}

struct CaptureProgress {
    frame: AtomicU64,
    out_time_us: AtomicU64,
}

struct SpawnedCapture {
    child: Child,
    control: ChildStdin,
    encoder: &'static str,
    encoded_timeline: Duration,
    progress: Arc<CaptureProgress>,
    progress_reader: thread::JoinHandle<()>,
}

fn spawn_gpu_capture(
    source: &str,
    destination: &Path,
    options: RecordingOptions,
    gpu_vendor: GpuVendor,
    excluded_encoders: &HashSet<String>,
) -> std::result::Result<SpawnedCapture, String> {
    let destination = destination.to_string_lossy().to_string();
    let qsv_source = format!("{source},hwmap=derive_device=qsv,format=qsv");
    let software_source = format!("{source},hwdownload,format=bgra,format=yuv420p");
    let bitrate = format!("{}M", options.bitrate_mbps);
    let maxrate = format!(
        "{}M",
        (options.bitrate_mbps * 5 / 4).max(options.bitrate_mbps + 1)
    );
    let bufsize = format!("{}M", (options.bitrate_mbps / 2).max(2));
    let gop = (options.fps * 2).to_string();
    let fps = options.fps.to_string();
    let live_software_threads = std::thread::available_parallelism()
        .map(|value| (value.get() / 2).clamp(1, 2))
        .unwrap_or(1)
        .to_string();
    let mut encoders: Vec<(&'static str, String, Vec<String>)> = vec![
        (
            "NVENC (GPU-resident)",
            source.to_string(),
            vec![
                "-c:v",
                "h264_nvenc",
                "-preset",
                "p1",
                "-tune",
                "ll",
                "-b:v",
                &bitrate,
                "-maxrate",
                &maxrate,
                "-bufsize",
                &bufsize,
                "-g",
                &gop,
                "-bf",
                "0",
                "-surfaces",
                "2",
                "-multipass",
                "disabled",
                "-delay",
                "0",
            ]
            .into_iter()
            .map(str::to_string)
            .collect(),
        ),
        (
            "AMD AMF (GPU-resident)",
            source.to_string(),
            vec![
                "-c:v",
                "h264_amf",
                "-usage",
                "lowlatency",
                "-quality",
                "speed",
                "-b:v",
                &bitrate,
                "-maxrate",
                &maxrate,
                "-bufsize",
                &bufsize,
                "-g",
                &gop,
                "-bf",
                "0",
            ]
            .into_iter()
            .map(str::to_string)
            .collect(),
        ),
        (
            "Intel Quick Sync (GPU-mapped)",
            qsv_source,
            vec![
                "-c:v",
                "h264_qsv",
                "-preset",
                "veryfast",
                "-b:v",
                &bitrate,
                "-maxrate",
                &maxrate,
                "-bufsize",
                &bufsize,
                "-g",
                &gop,
                "-bf",
                "0",
                "-async_depth",
                "1",
            ]
            .into_iter()
            .map(str::to_string)
            .collect(),
        ),
        (
            "Media Foundation hardware",
            source.to_string(),
            vec![
                "-c:v",
                "h264_mf",
                "-hw_encoding",
                "1",
                "-scenario",
                "display_remoting",
                "-b:v",
                &bitrate,
                "-g",
                &gop,
            ]
            .into_iter()
            .map(str::to_string)
            .collect(),
        ),
    ];
    if options.allow_software_encoder {
        encoders.push((
            "x264 compatibility fallback",
            software_source,
            vec![
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-tune",
                "zerolatency",
                "-b:v",
                &bitrate,
                "-maxrate",
                &maxrate,
                "-bufsize",
                &bufsize,
                "-g",
                &gop,
                "-bf",
                "0",
                "-threads",
                &live_software_threads,
            ]
            .into_iter()
            .map(str::to_string)
            .collect(),
        ));
    }
    encoders.sort_by_key(|(name, _, _)| gpu_vendor.encoder_rank(name));
    for (name, capture_filter, codec) in encoders {
        if excluded_encoders.contains(name) {
            continue;
        }
        let mut command = recording_command("ffmpeg");
        command.args([
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostats",
            "-stats_period",
            "0.05",
            "-progress",
            "pipe:1",
            "-filter_threads",
            "1",
            "-filter_complex_threads",
            "1",
            "-filter_complex",
            &capture_filter,
        ]);
        // Write independently decodable MP4 fragments as recording proceeds.
        // A normal MP4 stores its `moov` index only during clean shutdown, so
        // a driver/FFmpeg access violation at Stop turns the entire recording
        // into an unreadable file. Fragmented MP4 keeps its initialization
        // metadata at the front and limits a crash to at most the current GOP.
        command.args(&codec).args([
            "-r",
            &fps,
            "-fps_mode",
            "cfr",
            "-movflags",
            RESILIENT_MP4_MOVFLAGS,
            &destination,
        ]);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Ok(mut child) = spawn_recording_child(&mut command) {
            let Some(stdout) = child.stdout.take() else {
                let _ = child.kill();
                let _ = child.wait();
                continue;
            };
            let (first_frame_tx, first_frame_rx) = std::sync::mpsc::sync_channel(1);
            let progress = Arc::new(CaptureProgress {
                frame: AtomicU64::new(0),
                out_time_us: AtomicU64::new(0),
            });
            let reported_progress = progress.clone();
            let progress_reader = thread::spawn(move || {
                let mut frame = 0u64;
                let mut out_time_us = 0u64;
                let mut reported = false;
                for line in BufReader::new(stdout).lines().map_while(|line| line.ok()) {
                    if let Some(media_time) =
                        parse_gpu_progress_line(&line, &mut frame, &mut out_time_us)
                    {
                        reported_progress.frame.store(frame, Ordering::Relaxed);
                        reported_progress
                            .out_time_us
                            .store(out_time_us, Ordering::Relaxed);
                        if !reported {
                            let _ = first_frame_tx.send(media_time);
                            reported = true;
                        }
                    }
                }
            });

            match first_frame_rx.recv_timeout(Duration::from_secs(4)) {
                Ok(encoded_timeline) if matches!(child.try_wait(), Ok(None)) => {
                    let stdin = child
                        .stdin
                        .take()
                        .ok_or_else(|| "Desktop capture control pipe is unavailable".to_string())?;
                    return Ok(SpawnedCapture {
                        child,
                        control: stdin,
                        encoder: name,
                        encoded_timeline,
                        progress,
                        progress_reader,
                    });
                }
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = progress_reader.join();
                }
            }
        }
    }
    Err("Desktop capture could not start with NVENC, AMF, Quick Sync, Media Foundation, or the configured compatibility encoder".to_string())
}

/// Parse one `-progress pipe:1` line. A progress block is complete only when
/// its `progress=` marker arrives, so `frame` and `out_time_us` always describe
/// the same encoded point. The returned media duration lets the caller derive
/// first-frame wall time even if FFmpeg reports progress slightly later.
fn parse_gpu_progress_line(line: &str, frame: &mut u64, out_time_us: &mut u64) -> Option<Duration> {
    let (key, value) = line.trim().split_once('=')?;
    match key {
        "frame" => *frame = value.parse().unwrap_or(*frame),
        "out_time_us" | "out_time_ms" => {
            *out_time_us = value.parse::<i64>().unwrap_or(0).max(0) as u64;
        }
        "progress" if *frame > 0 => return Some(Duration::from_micros(*out_time_us)),
        _ => {}
    }
    None
}

fn validate_capture_segment(path: &Path) -> std::result::Result<(), String> {
    let size = std::fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if size <= 1_024 {
        return Err(format!(
            "{} is empty or header-only ({size} bytes)",
            path.display()
        ));
    }
    // Size alone is not evidence of a usable MP4: a non-fragmented file can
    // contain megabytes of encoded frames but no `moov` atom after a crash.
    // Ask ffprobe for the first video packet before admitting this part into
    // the recovery/remux pipeline.
    let probe = background_command("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-read_intervals",
            "%+#1",
            "-show_entries",
            "packet=pts_time",
            "-of",
            "csv=p=0",
        ])
        .arg(path)
        .output()
        .map_err(|error| format!("Unable to validate {}: {error}", path.display()))?;
    let packet = String::from_utf8_lossy(&probe.stdout);
    if !probe.status.success() || packet.trim().is_empty() {
        return Err(format!(
            "{} contains no readable video packet: {}",
            path.display(),
            String::from_utf8_lossy(&probe.stderr).trim()
        ));
    }
    Ok(())
}

fn capture_parts_are_cfr(parts: &[std::path::PathBuf], fps: u32) -> bool {
    let expected = 1.0 / fps.max(1) as f64;
    parts.iter().all(|path| {
        let Ok(output) = background_command("ffprobe")
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-read_intervals",
                "%+#120",
                "-show_entries",
                "packet=duration_time",
                "-of",
                "csv=p=0",
            ])
            .arg(path)
            .output()
        else {
            return false;
        };
        let durations = String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| line.trim().parse::<f64>().ok())
            .collect::<Vec<_>>();
        output.status.success()
            && durations.len() >= 2
            && durations
                .iter()
                .all(|duration| (*duration - expected).abs() <= 0.0025)
    })
}

fn finalize_capture_parts(
    parts: &[std::path::PathBuf],
    output_path: &Path,
    diagnostics: &str,
    options: RecordingOptions,
) -> std::result::Result<(), String> {
    if parts.is_empty() {
        return Err(format!(
            "Desktop capture produced no usable video: {diagnostics}"
        ));
    }
    let list_path = if parts.len() > 1 {
        let path = output_path.with_extension("capture-parts.txt");
        let list = parts
            .iter()
            .map(|path| format!("file '{}'", path.to_string_lossy().replace('\'', "'\\''")))
            .collect::<Vec<_>>()
            .join("\n");
        std::fs::write(&path, list)
            .map_err(|error| format!("Unable to prepare recovered recording: {error}"))?;
        Some(path)
    } else {
        None
    };

    // New recordings are paced to CFR during capture. In the normal case the
    // editor-ready file therefore needs only a fast stream copy, not a second
    // full decode/encode pass. This makes Stop nearly instant and avoids a
    // post-recording CPU/GPU spike. Older/recovered VFR fragments continue to
    // use the compatibility conversion below.
    if capture_parts_are_cfr(parts, options.fps) {
        let _ = std::fs::remove_file(output_path);
        let mut command = recording_command("ffmpeg");
        command.args(["-y", "-hide_banner", "-loglevel", "error"]);
        if let Some(path) = &list_path {
            command
                .args(["-f", "concat", "-safe", "0", "-fflags", "+genpts", "-i"])
                .arg(path);
        } else {
            command.args(["-fflags", "+genpts", "-i"]).arg(&parts[0]);
        }
        let timescale = if options.fps == 60 {
            "60000"
        } else if options.fps == 24 {
            "24000"
        } else {
            "30000"
        };
        let output = command
            .args([
                "-map",
                "0:v:0",
                "-an",
                "-c:v",
                "copy",
                "-video_track_timescale",
                timescale,
                "-avoid_negative_ts",
                "make_zero",
                "-movflags",
                EDITOR_READY_MOVFLAGS,
            ])
            .arg(output_path)
            .output();
        if let Ok(output) = output {
            if output.status.success() && validate_output(output_path, true, diagnostics).is_ok() {
                if let Some(path) = &list_path {
                    let _ = std::fs::remove_file(path);
                }
                eprintln!("[Snap] Editor-ready CFR video prepared with a zero-load stream copy");
                return Ok(());
            }
        }
    }

    // This compatibility path handles older VFR fragments and unusual driver
    // output whose packet timing was not uniform enough for the stream-copy
    // path above. Convert it to constant-frame-rate, fast-start video at the
    // requested FPS so WebView2 playback remains stable.
    let bitrate = format!("{}M", options.bitrate_mbps);
    let maxrate = format!(
        "{}M",
        (options.bitrate_mbps * 4 / 3).max(options.bitrate_mbps + 1)
    );
    let bufsize = format!("{}M", options.bitrate_mbps.max(4));
    let gop = (options.fps * 2).to_string();
    let software_threads = std::thread::available_parallelism()
        .map(|value| (value.get() / 2).clamp(1, 4))
        .unwrap_or(2)
        .to_string();
    let codecs: Vec<(&str, Vec<String>)> = vec![
        (
            "NVENC",
            vec![
                "-c:v",
                "h264_nvenc",
                "-preset",
                "p3",
                "-tune",
                "hq",
                "-b:v",
                &bitrate,
                "-maxrate",
                &maxrate,
                "-bufsize",
                &bufsize,
                "-g",
                &gop,
            ]
            .into_iter()
            .map(str::to_string)
            .collect(),
        ),
        (
            "AMD AMF",
            vec![
                "-c:v", "h264_amf", "-quality", "speed", "-b:v", &bitrate, "-maxrate", &maxrate,
                "-bufsize", &bufsize, "-g", &gop,
            ]
            .into_iter()
            .map(str::to_string)
            .collect(),
        ),
        (
            "Intel Quick Sync",
            vec![
                "-c:v", "h264_qsv", "-preset", "veryfast", "-b:v", &bitrate, "-maxrate", &maxrate,
                "-bufsize", &bufsize, "-g", &gop,
            ]
            .into_iter()
            .map(str::to_string)
            .collect(),
        ),
        (
            "Media Foundation",
            vec![
                "-c:v",
                "h264_mf",
                "-hw_encoding",
                "1",
                "-b:v",
                &bitrate,
                "-g",
                &gop,
            ]
            .into_iter()
            .map(str::to_string)
            .collect(),
        ),
        (
            "software fallback",
            vec![
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-b:v",
                &bitrate,
                "-maxrate",
                &maxrate,
                "-bufsize",
                &bufsize,
                "-threads",
                &software_threads,
                "-g",
                &gop,
            ]
            .into_iter()
            .map(str::to_string)
            .collect(),
        ),
    ];
    let mut attempts = Vec::new();
    for (label, codec) in codecs {
        let _ = std::fs::remove_file(output_path);
        // Finalization can still be substantial on long recordings. Keep it
        // below normal priority so browsers, games, and the editor remain
        // responsive while the resilient fragments are converted to CFR.
        let mut command = recording_command("ffmpeg");
        command.args(["-y", "-hide_banner", "-loglevel", "error"]);
        if let Some(path) = &list_path {
            command
                .args(["-f", "concat", "-safe", "0", "-fflags", "+genpts", "-i"])
                .arg(path);
        } else {
            command.args(["-fflags", "+genpts", "-i"]).arg(&parts[0]);
        }
        let fps_filter = editor_ready_fps_filter(options.fps);
        command
            .args(["-map", "0:v:0", "-an", "-vf", &fps_filter])
            .args(&codec)
            .args([
                "-pix_fmt",
                "yuv420p",
                "-fps_mode",
                "cfr",
                "-video_track_timescale",
                if options.fps == 60 {
                    "60000"
                } else if options.fps == 24 {
                    "24000"
                } else {
                    "30000"
                },
                "-avoid_negative_ts",
                "make_zero",
                "-movflags",
                EDITOR_READY_MOVFLAGS,
            ])
            .arg(output_path);
        match command.output() {
            Ok(output) if output.status.success() => {
                match validate_output(output_path, true, diagnostics) {
                    Ok(()) => {
                        if let Some(path) = &list_path {
                            let _ = std::fs::remove_file(path);
                        }
                        eprintln!("[Snap] Editor-ready CFR video prepared with {label}");
                        return Ok(());
                    }
                    Err(error) => attempts.push(format!("{label}: {error}")),
                }
            }
            Ok(output) => attempts.push(format!(
                "{label}: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )),
            Err(error) => attempts.push(format!("{label}: {error}")),
        }
    }
    if let Some(path) = &list_path {
        let _ = std::fs::remove_file(path);
    }
    Err(format!(
        "Unable to prepare smooth editor playback: {}",
        attempts.join("; ")
    ))
}

/// Assemble fragmented MP4 parts left by a process crash or power loss. The
/// fragments are intentionally written beside the final MP4 so recovery does
/// not depend on the hidden project-data folder remaining intact.
pub(crate) fn recover_capture_parts(output_path: &Path) -> std::result::Result<bool, String> {
    let parent = output_path.parent().unwrap_or_else(|| Path::new("."));
    let stem = output_path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy();
    let prefix = format!("{stem}.capture-part-");
    let mut parts = std::fs::read_dir(parent)
        .map_err(|error| format!("Unable to scan capture fragments: {error}"))?
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            let index = name
                .strip_prefix(&prefix)?
                .strip_suffix(".mp4")?
                .parse::<usize>()
                .ok()?;
            Some((index, entry.path()))
        })
        .collect::<Vec<_>>();
    parts.sort_by_key(|(index, _)| *index);
    let usable = parts
        .into_iter()
        .filter_map(|(_, path)| validate_capture_segment(&path).ok().map(|_| path))
        .collect::<Vec<_>>();
    if usable.is_empty() {
        return Ok(false);
    }
    let recovered_fps = background_command("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=avg_frame_rate",
            "-of",
            "default=nw=1:nk=1",
        ])
        .arg(&usable[0])
        .output()
        .ok()
        .and_then(|output| {
            let value = String::from_utf8_lossy(&output.stdout);
            let (numerator, denominator) = value.trim().split_once('/')?;
            let fps = numerator.parse::<f64>().ok()? / denominator.parse::<f64>().ok()?.max(1.0);
            Some(if fps >= 45.0 { 60 } else { 30 })
        })
        .unwrap_or(30);
    let recovery_options = RecordingOptions {
        fps: recovered_fps,
        ..RecordingOptions::default()
    };
    finalize_capture_parts(
        &usable,
        output_path,
        "Recovered after an interrupted Snap session",
        recovery_options,
    )?;
    for part in usable {
        let _ = std::fs::remove_file(part);
    }
    Ok(true)
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

fn spawn_ffmpeg(
    output_path: &str,
    width: u32,
    height: u32,
    options: RecordingOptions,
    gpu_vendor: GpuVendor,
) -> Result<(Child, ChildStdin, String)> {
    let size = format!("{width}x{height}");

    fn try_ffmpeg(args: &[String]) -> std::result::Result<Child, std::io::Error> {
        let mut command = recording_command("ffmpeg");
        command
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        spawn_recording_child(&mut command)
    }

    let bitrate = format!("{}M", options.bitrate_mbps);
    let mut candidates: Vec<(&str, Vec<String>)> = vec![
        (
            "NVENC",
            vec!["-c:v", "h264_nvenc", "-preset", "p1", "-b:v", &bitrate]
                .into_iter()
                .map(str::to_string)
                .collect(),
        ),
        (
            "AMD AMF",
            vec!["-c:v", "h264_amf", "-quality", "speed", "-b:v", &bitrate]
                .into_iter()
                .map(str::to_string)
                .collect(),
        ),
        (
            "Intel Quick Sync",
            vec!["-c:v", "h264_qsv", "-preset", "veryfast", "-b:v", &bitrate]
                .into_iter()
                .map(str::to_string)
                .collect(),
        ),
        (
            "Media Foundation",
            vec!["-c:v", "h264_mf", "-hw_encoding", "1", "-b:v", &bitrate]
                .into_iter()
                .map(str::to_string)
                .collect(),
        ),
    ];
    if options.allow_software_encoder {
        candidates.push((
            "x264 compatibility fallback",
            vec![
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-tune",
                "zerolatency",
                "-b:v",
                &bitrate,
            ]
            .into_iter()
            .map(str::to_string)
            .collect(),
        ));
    }
    candidates.sort_by_key(|(name, _)| gpu_vendor.encoder_rank(name));
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
        ]
        .into_iter()
        .map(str::to_string)
        .collect::<Vec<_>>();
        probe_args.extend(codec_args.iter().cloned());
        probe_args.extend(["-f", "null", "-"].into_iter().map(str::to_string));
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
        let fps = options.fps.to_string();
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
            &fps,
            "-i",
            "pipe:0",
        ]
        .into_iter()
        .map(str::to_string)
        .collect::<Vec<_>>();
        args.extend(codec_args);
        args.extend(
            ["-pix_fmt", "yuv420p", output_path]
                .into_iter()
                .map(str::to_string),
        );
        if let Ok(mut child) = try_ffmpeg(&args) {
            let stdin = child
                .stdin
                .take()
                .ok_or_else(|| Error::new(E_FAIL, "FFmpeg stdin unavailable"))?;
            return Ok((child, stdin, name.to_string()));
        }
    }
    Err(Error::new(E_FAIL, "No compatible H.264 encoder could start. Update the display driver or enable Snap's compatibility encoder fallback."))
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

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{
        constrained_size, desktop_duplication_source, editor_ready_fps_filter,
        gfxcapture_region_source, gfxcapture_source, parse_gpu_progress_line,
        validate_capture_segment, CropRect, RecordingOptions, EDITOR_READY_MOVFLAGS,
        RESILIENT_MP4_MOVFLAGS,
    };

    fn quality_options() -> RecordingOptions {
        RecordingOptions {
            fps: 60,
            bitrate_mbps: 12,
            max_width: None,
            max_height: None,
            allow_software_encoder: true,
        }
    }

    #[test]
    fn window_gpu_source_targets_the_exact_hwnd_without_cursor_or_border() {
        let (source, label) = gfxcapture_source("window:12345", None, quality_options()).unwrap();
        assert_eq!(label, "window");
        assert!(source.starts_with("gfxcapture=hwnd=12345:"));
        assert!(source.contains("capture_cursor=0"));
        assert!(source.contains("display_border=0"));
        assert!(source.contains("width=1920:height=1080"));
    }

    #[test]
    fn region_gpu_source_converts_the_rectangle_to_edge_crops() {
        let source = gfxcapture_region_source(
            88,
            CropRect {
                x: 100,
                y: 50,
                w: 1280,
                h: 720,
            },
            1920,
            1080,
            quality_options(),
        );
        assert!(source.contains("hmonitor=88"));
        assert!(source.contains("crop_left=100"));
        assert!(source.contains("crop_top=50"));
        assert!(source.contains("crop_right=540"));
        assert!(source.contains("crop_bottom=310"));
    }

    #[test]
    fn full_display_prefers_the_compositor_friendly_monitor_source() {
        let (source, label) = gfxcapture_source("monitor:88", None, quality_options()).unwrap();
        assert_eq!(label, "full display");
        assert!(source.starts_with("gfxcapture=hmonitor=88:"));
        assert!(source.contains("max_framerate=60"));
        assert!(source.contains("capture_cursor=0"));
    }

    #[test]
    fn full_display_fallback_keeps_a_continuous_audio_aligned_timeline() {
        let source = desktop_duplication_source(2, quality_options());
        assert!(source.contains("output_idx=2"));
        assert!(source.contains("framerate=60"));
        assert!(source.contains("dup_frames=1"));
    }

    #[test]
    fn gpu_segments_publish_recoverable_fragment_metadata_up_front() {
        assert!(RESILIENT_MP4_MOVFLAGS.contains("frag_keyframe"));
        assert!(RESILIENT_MP4_MOVFLAGS.contains("empty_moov"));
        assert!(RESILIENT_MP4_MOVFLAGS.contains("default_base_moof"));
    }

    #[test]
    fn editor_ready_video_uses_constant_frame_rate_and_fast_start() {
        let filter = editor_ready_fps_filter(60);
        assert!(filter.contains("fps=60"));
        assert!(filter.contains("start_time=0"));
        assert_eq!(EDITOR_READY_MOVFLAGS, "+faststart");
    }

    #[test]
    fn balanced_profile_scales_4k_to_1080p_without_changing_aspect() {
        let options = RecordingOptions::default();
        assert_eq!(constrained_size(3840, 2160, options), (1920, 1080));
        assert_eq!(
            editor_ready_fps_filter(options.fps),
            "fps=fps=30:round=near:start_time=0"
        );
    }

    #[test]
    fn gpu_progress_anchors_start_to_encoded_media_time() {
        let mut frame = 0;
        let mut out_time_us = 0;
        assert_eq!(
            parse_gpu_progress_line("frame=37", &mut frame, &mut out_time_us),
            None
        );
        assert_eq!(
            parse_gpu_progress_line("out_time_us=616667", &mut frame, &mut out_time_us),
            None
        );
        let lead = parse_gpu_progress_line("progress=continue", &mut frame, &mut out_time_us)
            .expect("complete progress block");
        assert_eq!(lead, Duration::from_micros(616_667));
    }

    #[test]
    fn capture_segment_validation_rejects_header_only_files() {
        let path = std::env::temp_dir().join(format!(
            "snap-empty-segment-test-{}-{}.mp4",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(&path, [0u8; 128]).unwrap();
        let error = validate_capture_segment(&path).unwrap_err();
        assert!(error.contains("empty or header-only"));
        std::fs::remove_file(path).unwrap();
    }
}
