use crate::process::background_command;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ExitStatus, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileDevice {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub state: String,
    pub transport: String,
    pub os_version: Option<String>,
    pub api_level: Option<u32>,
    pub audio_supported: bool,
    pub detail: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileCaptureSource {
    pub id: String,
    pub name: String,
    pub kind: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileEnvironment {
    pub adb_available: bool,
    pub scrcpy_available: bool,
    pub ffmpeg_available: bool,
    pub winget_available: bool,
    pub android_direct_ready: bool,
    pub ios_direct_usb_supported: bool,
    pub android_detail: String,
    pub ios_detail: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileRecordingStatus {
    pub state: String,
    pub message: String,
    pub platform: Option<String>,
    pub device_id: Option<String>,
    pub output_path: Option<String>,
    pub recovery_path: Option<String>,
    pub started_at_ms: Option<u64>,
    pub audio_enabled: bool,
}

impl Default for MobileRecordingStatus {
    fn default() -> Self {
        Self {
            state: "idle".into(),
            message: "Ready to record a mobile device.".into(),
            platform: None,
            device_id: None,
            output_path: None,
            recovery_path: None,
            started_at_ms: None,
            audio_enabled: false,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartMobileRecordingRequest {
    pub platform: String,
    pub transport: String,
    pub device_id: Option<String>,
    pub device_name: Option<String>,
    pub video_source: Option<String>,
    pub audio_source: Option<String>,
    pub include_audio: bool,
    pub output_path: String,
    pub show_support_files: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryManifest {
    version: u32,
    platform: String,
    transport: String,
    device_id: Option<String>,
    output_path: String,
    partial_path: String,
    state: String,
    started_at_ms: u64,
    updated_at_ms: u64,
    audio_enabled: bool,
    message: String,
}

enum WorkerCommand {
    Stop,
}

struct MobileManager {
    status: MobileRecordingStatus,
    control: Option<Sender<WorkerCommand>>,
}

struct MobileWorkerContext {
    manifest_path: PathBuf,
    partial_path: PathBuf,
    output_path: PathBuf,
    transport: String,
}

static MOBILE_MANAGER: OnceLock<Mutex<MobileManager>> = OnceLock::new();

fn manager() -> &'static Mutex<MobileManager> {
    MOBILE_MANAGER.get_or_init(|| {
        Mutex::new(MobileManager {
            status: MobileRecordingStatus::default(),
            control: None,
        })
    })
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn set_status(update: impl FnOnce(&mut MobileRecordingStatus)) {
    if let Ok(mut guard) = manager().lock() {
        update(&mut guard.status);
    }
}

fn resolve_tool(name: &str) -> Option<PathBuf> {
    let exe_name = if name.to_ascii_lowercase().ends_with(".exe") {
        name.to_string()
    } else {
        format!("{name}.exe")
    };
    let mut candidates = Vec::new();

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidates.push(parent.join("tools").join(&exe_name));
            candidates.push(parent.join(&exe_name));
        }
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let local = PathBuf::from(local);
        candidates.push(local.join("Microsoft/WinGet/Links").join(&exe_name));
        if name.eq_ignore_ascii_case("adb") {
            candidates.push(local.join("Android/Sdk/platform-tools/adb.exe"));
        }
    }
    if let Some(android_home) = std::env::var_os("ANDROID_HOME") {
        candidates.push(PathBuf::from(android_home).join("platform-tools/adb.exe"));
    }
    if let Some(android_sdk) = std::env::var_os("ANDROID_SDK_ROOT") {
        candidates.push(PathBuf::from(android_sdk).join("platform-tools/adb.exe"));
    }
    if let Some(path) = candidates.into_iter().find(|path| path.is_file()) {
        return Some(path);
    }

    let output = background_command("where.exe")
        .arg(&exe_name)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(PathBuf::from)
        .find(|path| path.is_file())
}

fn command_text(program: &Path, args: &[&str]) -> Result<String, String> {
    let output = background_command(program)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("Unable to run {}: {error}", program.display()))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
pub fn mobile_environment() -> MobileEnvironment {
    let adb = resolve_tool("adb").is_some();
    let scrcpy = resolve_tool("scrcpy").is_some();
    let ffmpeg = resolve_tool("ffmpeg").is_some();
    let winget = resolve_tool("winget").is_some();
    MobileEnvironment {
        adb_available: adb,
        scrcpy_available: scrcpy,
        ffmpeg_available: ffmpeg,
        winget_available: winget,
        android_direct_ready: adb && scrcpy && ffmpeg,
        ios_direct_usb_supported: false,
        android_detail: if adb && scrcpy {
            "Android USB capture is ready. Device audio is available on Android 11 and newer.".into()
        } else {
            "Android USB capture needs the official scrcpy package (ADB is included).".into()
        },
        ios_detail: "Apple does not expose direct iPhone screen mirroring to Windows over USB. Use an HDMI/USB UVC capture adapter, which preserves both video and its audio input.".into(),
    }
}

#[tauri::command]
pub async fn install_android_capture_support() -> Result<(), String> {
    let winget = resolve_tool("winget").ok_or_else(|| {
        "Windows Package Manager is unavailable. Install scrcpy from its official Genymobile release.".to_string()
    })?;
    tauri::async_runtime::spawn_blocking(move || {
        let status = background_command(winget)
            .args([
                "install",
                "--id",
                "Genymobile.scrcpy",
                "--exact",
                "--silent",
                "--accept-package-agreements",
                "--accept-source-agreements",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|error| format!("Unable to start scrcpy installation: {error}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("scrcpy installation exited with {status}"))
        }
    })
    .await
    .map_err(|error| format!("scrcpy installation task failed: {error}"))?
}

fn parse_adb_devices(text: &str) -> Vec<(String, String, String)> {
    text.lines()
        .skip_while(|line| !line.starts_with("List of devices"))
        .skip(1)
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with('*') {
                return None;
            }
            let mut fields = line.split_whitespace();
            let id = fields.next()?.to_string();
            let state = fields.next().unwrap_or("unknown").to_string();
            let model = fields
                .find_map(|field| field.strip_prefix("model:"))
                .unwrap_or("Android device")
                .replace('_', " ");
            Some((id, state, model))
        })
        .collect()
}

#[tauri::command]
pub fn enumerate_mobile_devices() -> Result<Vec<MobileDevice>, String> {
    let adb = match resolve_tool("adb") {
        Some(path) => path,
        None => return Ok(Vec::new()),
    };
    let output = command_text(&adb, &["devices", "-l"])?;
    let mut devices = Vec::new();
    for (id, state, fallback_name) in parse_adb_devices(&output) {
        let connected = state == "device";
        let name = if connected {
            command_text(&adb, &["-s", &id, "shell", "getprop", "ro.product.model"])
                .ok()
                .filter(|value| !value.is_empty())
                .unwrap_or(fallback_name)
        } else {
            fallback_name
        };
        let os_version = connected.then(|| {
            command_text(
                &adb,
                &["-s", &id, "shell", "getprop", "ro.build.version.release"],
            )
            .unwrap_or_default()
        });
        let api_level = connected
            .then(|| {
                command_text(
                    &adb,
                    &["-s", &id, "shell", "getprop", "ro.build.version.sdk"],
                )
                .ok()
                .and_then(|value| value.parse::<u32>().ok())
            })
            .flatten();
        let audio_supported = api_level.map(|api| api >= 30).unwrap_or(false);
        let detail = match state.as_str() {
            "device" if audio_supported => "USB authorized · video and device audio ready".into(),
            "device" => {
                "USB authorized · video ready · Android 11+ required for device audio".into()
            }
            "unauthorized" => "Unlock the phone and allow USB debugging for this computer".into(),
            "offline" => "Device is offline; reconnect the USB cable".into(),
            _ => format!("ADB state: {state}"),
        };
        devices.push(MobileDevice {
            id,
            name,
            platform: "android".into(),
            state,
            transport: "usb".into(),
            os_version,
            api_level,
            audio_supported,
            detail,
        });
    }
    Ok(devices)
}

fn parse_dshow_sources(stderr: &str) -> Vec<MobileCaptureSource> {
    let mut result = Vec::new();
    for line in stderr.lines() {
        let kind = if line.contains("(video)") || line.contains("(none)") {
            // FFmpeg 8.x reports DirectShow video inputs as `(none)` while
            // audio inputs remain explicitly tagged `(audio)`.
            "video"
        } else if line.contains("(audio)") {
            "audio"
        } else {
            continue;
        };
        let Some(first_quote) = line.find('"') else {
            continue;
        };
        let rest = &line[first_quote + 1..];
        let Some(second_quote) = rest.find('"') else {
            continue;
        };
        let name = rest[..second_quote].trim();
        if name.is_empty()
            || result
                .iter()
                .any(|entry: &MobileCaptureSource| entry.kind == kind && entry.name == name)
        {
            continue;
        }
        result.push(MobileCaptureSource {
            id: format!("{kind}:{name}"),
            name: name.into(),
            kind: kind.into(),
        });
    }
    result
}

#[tauri::command]
pub fn enumerate_mobile_capture_sources() -> Result<Vec<MobileCaptureSource>, String> {
    let ffmpeg = resolve_tool("ffmpeg")
        .ok_or_else(|| "FFmpeg is unavailable; capture inputs cannot be enumerated.".to_string())?;
    let output = background_command(ffmpeg)
        .args([
            "-hide_banner",
            "-list_devices",
            "true",
            "-f",
            "dshow",
            "-i",
            "dummy",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("Unable to enumerate capture inputs: {error}"))?;
    Ok(parse_dshow_sources(&String::from_utf8_lossy(
        &output.stderr,
    )))
}

fn probe_encoder(ffmpeg: &Path) -> Option<&'static str> {
    let candidates = ["h264_nvenc", "h264_amf", "h264_qsv"];
    candidates.into_iter().find(|encoder| {
        background_command(ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=black:s=640x360:r=1",
                "-frames:v",
                "1",
                "-c:v",
                encoder,
                "-f",
                "null",
                "-",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    })
}

fn recording_paths(output_path: &Path) -> Result<(PathBuf, PathBuf, PathBuf, PathBuf), String> {
    let parent = output_path
        .parent()
        .ok_or_else(|| "Recording output has no parent folder.".to_string())?;
    let stem = output_path
        .file_stem()
        .ok_or_else(|| "Recording output has no filename.".to_string())?
        .to_string_lossy();
    let support_dir = parent.join(stem.as_ref());
    fs::create_dir_all(&support_dir)
        .map_err(|error| format!("Unable to create recording recovery folder: {error}"))?;
    Ok((
        support_dir.join("mobile-capture.partial.mkv"),
        support_dir.join("mobile-recording.json"),
        support_dir.join("mobile-capture.log"),
        support_dir.join("events.json"),
    ))
}

fn write_manifest(path: &Path, manifest: &RecoveryManifest) -> Result<(), String> {
    let temp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(manifest)
        .map_err(|error| format!("Unable to serialize recovery journal: {error}"))?;
    let mut file = File::create(&temp)
        .map_err(|error| format!("Unable to create recovery journal: {error}"))?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("Unable to write recovery journal: {error}"))?;
    let _ = fs::remove_file(path);
    fs::rename(&temp, path).map_err(|error| format!("Unable to publish recovery journal: {error}"))
}

fn set_support_visibility(path: &Path, show: bool) {
    let flag = if show { "-H" } else { "+H" };
    let _ = background_command("attrib.exe")
        .arg(flag)
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn spawn_log_reader(child: &mut Child, log_path: PathBuf) {
    let Some(stderr) = child.stderr.take() else {
        return;
    };
    thread::spawn(move || {
        let Ok(mut log) = File::create(log_path) else {
            return;
        };
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let _ = writeln!(log, "{line}");
            let _ = log.flush();
        }
    });
}

#[derive(Clone, Copy)]
struct TouchAxis {
    min: i64,
    max: i64,
}

#[derive(Clone)]
struct AndroidTouchCapabilities {
    device_path: String,
    x: TouchAxis,
    y: TouchAxis,
    width: u32,
    height: u32,
    orientation: u32,
}

fn parse_axis_range(line: &str) -> Option<TouchAxis> {
    fn number_after(line: &str, marker: &str) -> Option<i64> {
        let tail = line.split(marker).nth(1)?.trim_start();
        let value = tail
            .split(|character: char| character == ',' || character.is_whitespace())
            .next()?;
        value.parse().ok()
    }
    let min = number_after(line, "min ")?;
    let max = number_after(line, "max ")?;
    (max > min).then_some(TouchAxis { min, max })
}

fn parse_android_touch_capabilities(
    text: &str,
    mut width: u32,
    mut height: u32,
    orientation: u32,
) -> Option<AndroidTouchCapabilities> {
    let mut device_path = None;
    let mut current_device = None;
    let mut x = None;
    let mut y = None;
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(path) = trimmed
            .strip_prefix("add device ")
            .and_then(|_| trimmed.split(':').nth(1))
        {
            current_device = Some(path.trim().to_string());
            x = None;
            y = None;
            continue;
        }
        if trimmed.contains("ABS_MT_POSITION_X") {
            x = parse_axis_range(trimmed);
        } else if trimmed.contains("ABS_MT_POSITION_Y") {
            y = parse_axis_range(trimmed);
        }
        if x.is_some() && y.is_some() && current_device.is_some() {
            device_path = current_device.clone();
            break;
        }
    }
    let x = x?;
    let y = y?;
    if width == 0 || height == 0 {
        width = (x.max - x.min + 1) as u32;
        height = (y.max - y.min + 1) as u32;
    }
    Some(AndroidTouchCapabilities {
        device_path: device_path?,
        x,
        y,
        width,
        height,
        orientation,
    })
}

fn android_display_geometry(adb: &Path, serial: &str) -> (u32, u32, u32) {
    let output = command_text(adb, &["-s", serial, "shell", "wm", "size"]).unwrap_or_default();
    let mut size = output
        .lines()
        .rev()
        .find_map(|line| {
            line.split_whitespace().find_map(|token| {
                let (width, height) = token.split_once('x')?;
                Some((width.parse().ok()?, height.parse().ok()?))
            })
        })
        .unwrap_or((0, 0));
    let orientation = command_text(adb, &["-s", serial, "shell", "dumpsys", "input"])
        .ok()
        .and_then(|text| {
            text.lines().find_map(|line| {
                line.split("SurfaceOrientation:")
                    .nth(1)?
                    .trim()
                    .parse::<u32>()
                    .ok()
            })
        })
        .unwrap_or(0);
    if orientation % 2 == 1 {
        size = (size.1, size.0);
    }
    (size.0, size.1, orientation)
}

fn write_mobile_meta(
    path: &Path,
    platform: &str,
    started_at_ms: u64,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let mut file =
        File::create(path).map_err(|error| format!("Unable to create editor sidecar: {error}"))?;
    writeln!(
        file,
        "{}",
        serde_json::json!({
            "type": "meta",
            "captureStartMs": started_at_ms,
            "x": 0,
            "y": 0,
            "w": width,
            "h": height,
            "source": "mobile",
            "platform": platform,
        })
    )
    .and_then(|_| file.flush())
    .map_err(|error| format!("Unable to initialize editor sidecar: {error}"))
}

fn parse_event_hex(line: &str) -> Option<i64> {
    let token = line.split_whitespace().last()?;
    i64::from_str_radix(token.trim_start_matches("0x"), 16).ok()
}

fn scale_touch(value: i64, axis: TouchAxis, output: u32) -> i32 {
    let normalized = ((value - axis.min) as f64 / (axis.max - axis.min) as f64).clamp(0.0, 1.0);
    (normalized * output.saturating_sub(1) as f64).round() as i32
}

fn map_touch_point(raw_x: i64, raw_y: i64, capabilities: &AndroidTouchCapabilities) -> (i32, i32) {
    let natural_width = if capabilities.orientation % 2 == 1 {
        capabilities.height
    } else {
        capabilities.width
    };
    let natural_height = if capabilities.orientation % 2 == 1 {
        capabilities.width
    } else {
        capabilities.height
    };
    let x = scale_touch(raw_x, capabilities.x, natural_width);
    let y = scale_touch(raw_y, capabilities.y, natural_height);
    match capabilities.orientation % 4 {
        1 => (natural_height as i32 - 1 - y, x),
        2 => (natural_width as i32 - 1 - x, natural_height as i32 - 1 - y),
        3 => (y, natural_width as i32 - 1 - x),
        _ => (x, y),
    }
}

fn spawn_android_touch_logger(
    adb: &Path,
    serial: &str,
    events_path: PathBuf,
    capabilities: AndroidTouchCapabilities,
) -> Result<Child, String> {
    let mut child = background_command(adb)
        .args([
            "-s",
            serial,
            "shell",
            "getevent",
            "-lt",
            &capabilities.device_path,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Unable to start Android touch telemetry: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Android touch telemetry did not expose a stream.".to_string())?;
    thread::spawn(move || {
        let Ok(mut file) = fs::OpenOptions::new().append(true).open(events_path) else {
            return;
        };
        let mut touch_x = None;
        let mut touch_y = None;
        let mut active = false;
        let mut pending_down = false;
        let mut pending_up = false;
        let mut current_slot = 0i64;
        let mut contacts = HashSet::new();
        let mut last_point = None;
        let mut last_move = Instant::now() - Duration::from_millis(20);

        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if line.contains("ABS_MT_POSITION_X") {
                touch_x = parse_event_hex(&line);
            } else if line.contains("ABS_MT_POSITION_Y") {
                touch_y = parse_event_hex(&line);
            } else if line.contains("ABS_MT_SLOT") {
                current_slot = parse_event_hex(&line).unwrap_or(0);
            } else if line.contains("ABS_MT_TRACKING_ID") {
                let value = line.split_whitespace().last().unwrap_or_default();
                if value.eq_ignore_ascii_case("ffffffff") {
                    contacts.remove(&current_slot);
                    if contacts.is_empty() {
                        pending_up = true;
                    }
                } else {
                    let was_empty = contacts.is_empty();
                    contacts.insert(current_slot);
                    if was_empty {
                        pending_down = true;
                    }
                }
            } else if line.contains("BTN_TOUCH") {
                let value = line.split_whitespace().last().unwrap_or_default();
                if value.eq_ignore_ascii_case("DOWN") || value.ends_with('1') {
                    contacts.insert(0);
                    if !active {
                        pending_down = true;
                    }
                } else if value.eq_ignore_ascii_case("UP") || value.ends_with('0') {
                    contacts.clear();
                    pending_up = true;
                }
            }
            if !line.contains("SYN_REPORT") {
                continue;
            }
            let Some(raw_x) = touch_x else { continue };
            let Some(raw_y) = touch_y else { continue };
            let point = map_touch_point(raw_x, raw_y, &capabilities);
            let timestamp = now_ms();
            let event_type = if pending_down && !active {
                active = true;
                pending_down = false;
                Some("mousedown")
            } else if pending_up && active {
                active = false;
                pending_down = false;
                pending_up = false;
                Some("mouseup")
            } else if active
                && last_point != Some(point)
                && last_move.elapsed() >= Duration::from_millis(16)
            {
                last_move = Instant::now();
                Some("mousemove")
            } else {
                None
            };
            if let Some(event_type) = event_type {
                let _ = writeln!(
                    file,
                    "{}",
                    serde_json::json!({
                        "ts": timestamp,
                        "type": event_type,
                        "x": point.0,
                        "y": point.1,
                        "key": null,
                        "button": if event_type == "mousedown" || event_type == "mouseup" { Some("left") } else { None::<&str> },
                    })
                );
                let _ = file.flush();
            }
            last_point = Some(point);
        }
    });
    Ok(child)
}

#[cfg(target_os = "windows")]
fn request_graceful_window_close(process_id: u32) -> bool {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowThreadProcessId, IsWindowVisible, PostMessageW, WM_CLOSE,
    };

    unsafe extern "system" fn callback(hwnd: HWND, parameter: LPARAM) -> BOOL {
        let target = parameter.0 as u32;
        let mut owner = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut owner)) };
        if owner == target && unsafe { IsWindowVisible(hwnd) }.as_bool() {
            let _ = unsafe { PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0)) };
        }
        BOOL(1)
    }

    unsafe { EnumWindows(Some(callback), LPARAM(process_id as isize)) }.is_ok()
}

#[cfg(not(target_os = "windows"))]
fn request_graceful_window_close(_process_id: u32) -> bool {
    false
}

fn finalize_partial(partial: &Path, output: &Path) -> Result<(), String> {
    let size = fs::metadata(partial).map(|meta| meta.len()).unwrap_or(0);
    if size < 1024 {
        return Err("No recoverable mobile video data was received.".into());
    }
    let ffmpeg = resolve_tool("ffmpeg").ok_or_else(|| {
        format!(
            "FFmpeg is unavailable. The recoverable recording remains at {}",
            partial.display()
        )
    })?;
    let status = background_command(ffmpeg)
        .args(["-y", "-fflags", "+genpts", "-i"])
        .arg(partial)
        .args(["-map", "0", "-c", "copy", "-movflags", "+faststart"])
        .arg(output)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .status()
        .map_err(|error| format!("Unable to finalize mobile recording: {error}"))?;
    let output_size = fs::metadata(output).map(|meta| meta.len()).unwrap_or(0);
    if !status.success() || output_size < 1024 {
        let _ = fs::remove_file(output);
        return Err(format!(
            "The MP4 could not be finalized, but the recoverable MKV remains at {}",
            partial.display()
        ));
    }
    fs::remove_file(partial).map_err(|error| {
        format!("Recording saved, but the recovery file could not be removed: {error}")
    })?;
    Ok(())
}

fn extract_device_audio(output: &Path, support_dir: &Path) -> Result<bool, String> {
    let ffmpeg = resolve_tool("ffmpeg").ok_or_else(|| {
        "FFmpeg is unavailable; the separate device-audio track was not created.".to_string()
    })?;
    let audio_path = support_dir.join("device_audio.wav");
    let _ = fs::remove_file(&audio_path);
    let status = background_command(ffmpeg)
        .args(["-y", "-hide_banner", "-loglevel", "error", "-i"])
        .arg(output)
        .args([
            "-map",
            "0:a:0",
            "-vn",
            "-c:a",
            "pcm_s16le",
            "-ar",
            "48000",
            "-ac",
            "2",
        ])
        .arg(&audio_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| format!("Unable to extract the device-audio track: {error}"))?;
    let usable = status.success()
        && fs::metadata(&audio_path)
            .map(|metadata| metadata.len() > 44)
            .unwrap_or(false);
    if !usable {
        let _ = fs::remove_file(&audio_path);
    }
    Ok(usable)
}

fn worker_loop(
    mut child: Child,
    mut touch_child: Option<Child>,
    commands: Receiver<WorkerCommand>,
    mut manifest: RecoveryManifest,
    context: MobileWorkerContext,
) {
    let mut stop_requested = false;
    let mut stop_deadline = None;
    let exit_status: ExitStatus = loop {
        if commands.try_recv().is_ok() && !stop_requested {
            stop_requested = true;
            set_status(|status| {
                status.state = "stopping".into();
                status.message = "Stopping safely and closing the recording container…".into();
            });
            if context.transport == "android_usb" {
                let _ = request_graceful_window_close(child.id());
            } else if let Some(stdin) = child.stdin.as_mut() {
                let _ = stdin.write_all(b"q\n");
                let _ = stdin.flush();
            }
            stop_deadline = Some(std::time::Instant::now() + Duration::from_secs(10));
        }

        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if stop_deadline.is_some_and(|deadline| std::time::Instant::now() >= deadline) {
                    let _ = child.kill();
                    break child.wait().unwrap_or_else(|_| failure_exit_status());
                }
            }
            Err(_) => break failure_exit_status(),
        }
        thread::sleep(Duration::from_millis(120));
    };

    let disconnected = !stop_requested && !exit_status.success();
    if let Some(logger) = touch_child.as_mut() {
        let _ = logger.kill();
        let _ = logger.wait();
    }
    set_status(|status| {
        status.state = "finalizing".into();
        status.message = if disconnected {
            "The device disconnected. Saving everything received before the disconnect…".into()
        } else {
            "Finalizing the mobile recording…".into()
        };
    });
    manifest.state = "finalizing".into();
    manifest.updated_at_ms = now_ms();
    manifest.message = if disconnected {
        "Device disconnected; finalizing captured data.".into()
    } else {
        "Recording stopped; finalizing captured data.".into()
    };
    let _ = write_manifest(&context.manifest_path, &manifest);

    let support_dir = context
        .partial_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf();
    match finalize_partial(&context.partial_path, &context.output_path) {
        Ok(()) => {
            let separate_audio = if manifest.audio_enabled {
                extract_device_audio(&context.output_path, &support_dir).unwrap_or(false)
            } else {
                false
            };
            manifest.state = "saved".into();
            manifest.message = if disconnected {
                "Device disconnected; recording saved through the last received packet.".into()
            } else if separate_audio {
                "Recording saved with a separate editable device-audio track.".into()
            } else if manifest.audio_enabled {
                "Recording saved, but the source did not provide an extractable audio stream."
                    .into()
            } else {
                "Recording saved successfully.".into()
            };
            manifest.updated_at_ms = now_ms();
            let _ = write_manifest(&context.manifest_path, &manifest);
            set_status(|status| {
                status.state = "saved".into();
                status.message = manifest.message.clone();
                status.output_path = Some(context.output_path.to_string_lossy().into_owned());
                status.recovery_path = None;
            });
        }
        Err(error) => {
            manifest.state = "recoverable".into();
            manifest.message = error.clone();
            manifest.updated_at_ms = now_ms();
            let _ = write_manifest(&context.manifest_path, &manifest);
            set_status(|status| {
                status.state = "recoverable".into();
                status.message = error;
                status.recovery_path = Some(context.partial_path.to_string_lossy().into_owned());
            });
        }
    }
    if let Ok(mut guard) = manager().lock() {
        guard.control = None;
    }
}

#[cfg(target_os = "windows")]
fn failure_exit_status() -> ExitStatus {
    use std::os::windows::process::ExitStatusExt;
    ExitStatus::from_raw(1)
}

#[cfg(not(target_os = "windows"))]
fn failure_exit_status() -> ExitStatus {
    use std::os::unix::process::ExitStatusExt;
    ExitStatus::from_raw(1)
}

#[tauri::command]
pub fn start_mobile_recording(
    request: StartMobileRecordingRequest,
) -> Result<MobileRecordingStatus, String> {
    {
        let guard = manager().lock().map_err(|error| error.to_string())?;
        if guard.control.is_some() {
            return Err("A mobile recording is already active.".into());
        }
    }

    let output_path = PathBuf::from(&request.output_path);
    if output_path.exists() {
        return Err("The target recording already exists.".into());
    }
    let (partial_path, manifest_path, log_path, events_path) = recording_paths(&output_path)?;
    let support_dir = partial_path.parent().unwrap_or_else(|| Path::new("."));
    set_support_visibility(support_dir, request.show_support_files);
    let _ = fs::remove_file(&partial_path);
    let _ = fs::remove_file(&log_path);

    let started_at_ms = now_ms();
    let mut touch_setup = None;
    if request.transport == "android_usb" {
        if let (Some(adb), Some(serial)) = (
            resolve_tool("adb"),
            request
                .device_id
                .as_deref()
                .filter(|value| !value.is_empty()),
        ) {
            let display = android_display_geometry(&adb, serial);
            let capabilities = command_text(&adb, &["-s", serial, "shell", "getevent", "-pl"])
                .ok()
                .and_then(|text| {
                    parse_android_touch_capabilities(&text, display.0, display.1, display.2)
                });
            let dimensions = capabilities
                .as_ref()
                .map(|value| (value.width, value.height))
                .unwrap_or((display.0, display.1));
            write_mobile_meta(
                &events_path,
                &request.platform,
                started_at_ms,
                dimensions.0,
                dimensions.1,
            )?;
            if let Some(capabilities) = capabilities {
                touch_setup = Some((adb, serial.to_string(), capabilities));
            }
        } else {
            write_mobile_meta(&events_path, &request.platform, started_at_ms, 0, 0)?;
        }
    } else {
        // UVC exposes the iPhone/iPad media stream, but Windows does not expose
        // the device's touch stream. The editor recognizes this marker and uses
        // visual-activity analysis for Auto Zoom instead.
        write_mobile_meta(&events_path, &request.platform, started_at_ms, 0, 0)?;
    }

    let mut manifest = RecoveryManifest {
        version: 1,
        platform: request.platform.clone(),
        transport: request.transport.clone(),
        device_id: request.device_id.clone(),
        output_path: output_path.to_string_lossy().into_owned(),
        partial_path: partial_path.to_string_lossy().into_owned(),
        state: "starting".into(),
        started_at_ms,
        updated_at_ms: started_at_ms,
        audio_enabled: request.include_audio,
        message: "Starting mobile capture.".into(),
    };
    write_manifest(&manifest_path, &manifest)?;

    let mut child = if request.transport == "android_usb" {
        let scrcpy = resolve_tool("scrcpy").ok_or_else(|| {
            "scrcpy is not installed. Use “Install Android capture support” first.".to_string()
        })?;
        let serial = request
            .device_id
            .as_deref()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "Select an authorized Android device.".to_string())?;
        let mut command = background_command(scrcpy);
        command
            .args(["--serial", serial, "--record"])
            .arg(&partial_path)
            .args([
                "--record-format=mkv",
                "--video-codec=h264",
                "--video-bit-rate=12M",
                "--max-fps=60",
                "--stay-awake",
                "--no-audio-playback",
                "--window-title",
            ])
            .arg(format!(
                "Snap · {}",
                request.device_name.as_deref().unwrap_or("Android")
            ));
        if request.include_audio {
            command.args(["--audio-codec=aac", "--require-audio"]);
        } else {
            command.arg("--no-audio");
        }
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Unable to start Android capture: {error}"))?
    } else if request.transport == "capture_input" {
        let ffmpeg = resolve_tool("ffmpeg")
            .ok_or_else(|| "FFmpeg is required for capture-input recording.".to_string())?;
        let video = request
            .video_source
            .as_deref()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "Select a UVC video capture input.".to_string())?;
        let encoder = probe_encoder(&ffmpeg).ok_or_else(|| {
            "No supported GPU H.264 encoder was found (NVENC, AMD AMF, or Intel Quick Sync)."
                .to_string()
        })?;
        let input = if request.include_audio {
            let audio = request
                .audio_source
                .as_deref()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    "Select the capture adapter audio input or turn audio off.".to_string()
                })?;
            format!("video={video}:audio={audio}")
        } else {
            format!("video={video}")
        };
        let mut command = background_command(ffmpeg);
        command.args([
            "-hide_banner",
            "-loglevel",
            "warning",
            "-y",
            "-fflags",
            "+genpts",
            "-f",
            "dshow",
            "-rtbufsize",
            "512M",
            "-i",
            &input,
            "-c:v",
            encoder,
        ]);
        match encoder {
            "h264_nvenc" => {
                command.args(["-preset", "p2", "-b:v", "12M"]);
            }
            "h264_amf" => {
                command.args(["-quality", "speed", "-b:v", "12M"]);
            }
            _ => {
                command.args(["-preset", "veryfast", "-b:v", "12M"]);
            }
        }
        if request.include_audio {
            command.args(["-c:a", "aac", "-b:a", "192k"]);
        } else {
            command.arg("-an");
        }
        command
            .args(["-f", "matroska"])
            .arg(&partial_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Unable to start capture-input recording: {error}"))?
    } else {
        return Err("Unsupported mobile capture transport.".into());
    };

    let mut touch_child = touch_setup.and_then(|(adb, serial, capabilities)| {
        spawn_android_touch_logger(&adb, &serial, events_path.clone(), capabilities).ok()
    });
    spawn_log_reader(&mut child, log_path);
    manifest.state = "recording".into();
    manifest.message =
        "Mobile recording is active. Recovery data is being written continuously.".into();
    manifest.updated_at_ms = now_ms();
    if let Err(error) = write_manifest(&manifest_path, &manifest) {
        let _ = child.kill();
        let _ = child.wait();
        if let Some(logger) = touch_child.as_mut() {
            let _ = logger.kill();
            let _ = logger.wait();
        }
        return Err(error);
    }

    let status = MobileRecordingStatus {
        state: "recording".into(),
        message: manifest.message.clone(),
        platform: Some(request.platform.clone()),
        device_id: request.device_id.clone(),
        output_path: Some(request.output_path.clone()),
        recovery_path: Some(partial_path.to_string_lossy().into_owned()),
        started_at_ms: Some(started_at_ms),
        audio_enabled: request.include_audio,
    };
    let (sender, receiver) = mpsc::channel();
    {
        let mut guard = manager().lock().map_err(|error| error.to_string())?;
        guard.status = status.clone();
        guard.control = Some(sender);
    }
    let context = MobileWorkerContext {
        manifest_path,
        partial_path,
        output_path,
        transport: request.transport,
    };
    thread::spawn(move || worker_loop(child, touch_child, receiver, manifest, context));
    Ok(status)
}

#[tauri::command]
pub fn mobile_recording_status() -> MobileRecordingStatus {
    manager()
        .lock()
        .map(|guard| guard.status.clone())
        .unwrap_or_else(|_| MobileRecordingStatus {
            state: "error".into(),
            message: "Mobile recorder state is unavailable.".into(),
            ..Default::default()
        })
}

#[tauri::command]
pub async fn stop_mobile_recording() -> Result<MobileRecordingStatus, String> {
    let sender = manager()
        .lock()
        .map_err(|error| error.to_string())?
        .control
        .clone()
        .ok_or_else(|| "No mobile recording is active.".to_string())?;
    sender
        .send(WorkerCommand::Stop)
        .map_err(|_| "The mobile recording worker has already stopped.".to_string())?;
    for _ in 0..160 {
        let status = mobile_recording_status();
        if matches!(status.state.as_str(), "saved" | "recoverable" | "error") {
            return Ok(status);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Ok(mobile_recording_status())
}

#[tauri::command]
pub async fn recover_mobile_recordings() -> Result<Vec<String>, String> {
    let videos_dir = PathBuf::from(crate::capture::get_videos_dir()?);
    tauri::async_runtime::spawn_blocking(move || {
        let mut recovered = Vec::new();
        let entries = fs::read_dir(&videos_dir)
            .map_err(|error| format!("Unable to scan mobile recording recovery data: {error}"))?;
        for entry in entries.flatten() {
            let support_dir = entry.path();
            if !support_dir.is_dir() {
                continue;
            }
            let partial = support_dir.join("mobile-capture.partial.mkv");
            let manifest_path = support_dir.join("mobile-recording.json");
            if !partial.is_file()
                || fs::metadata(&partial).map(|meta| meta.len()).unwrap_or(0) < 1024
            {
                continue;
            }
            let output = manifest_path
                .is_file()
                .then(|| fs::read_to_string(&manifest_path).ok())
                .flatten()
                .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
                .and_then(|value| {
                    value
                        .get("outputPath")
                        .and_then(|path| path.as_str())
                        .map(PathBuf::from)
                })
                .unwrap_or_else(|| {
                    videos_dir.join(format!(
                        "{}.mp4",
                        support_dir
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                    ))
                });
            let audio_enabled = fs::read_to_string(&manifest_path)
                .ok()
                .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
                .and_then(|value| value.get("audioEnabled").and_then(|flag| flag.as_bool()))
                .unwrap_or(false);
            if fs::metadata(&output)
                .map(|meta| meta.len() >= 1024)
                .unwrap_or(false)
            {
                continue;
            }
            let _ = fs::remove_file(&output);
            if finalize_partial(&partial, &output).is_ok() {
                if audio_enabled {
                    let _ = extract_device_audio(&output, &support_dir);
                }
                recovered.push(output.to_string_lossy().into_owned());
            }
        }
        Ok(recovered)
    })
    .await
    .map_err(|error| format!("Mobile recovery task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_adb_authorization_states_and_models() {
        let rows = parse_adb_devices(
            "List of devices attached\nABC123 device product:x model:Pixel_9 device:x transport_id:1\nXYZ unauthorized usb:1-2\n",
        );
        assert_eq!(
            rows[0],
            ("ABC123".into(), "device".into(), "Pixel 9".into())
        );
        assert_eq!(rows[1].1, "unauthorized");
    }

    #[test]
    fn parses_directshow_video_and_audio_sources() {
        let text = "[dshow @ 000] \"USB Video\" (none)\n[dshow @ 000] \"Digital Audio Interface\" (audio)\n";
        let sources = parse_dshow_sources(text);
        assert_eq!(sources.len(), 2);
        assert_eq!(sources[0].kind, "video");
        assert_eq!(sources[1].name, "Digital Audio Interface");
    }

    #[test]
    fn parses_android_multitouch_device_and_ranges() {
        let text = "add device 1: /dev/input/event2\n  name: \"keys\"\nadd device 2: /dev/input/event5\n  name: \"touchscreen\"\n    ABS_MT_POSITION_X : value 0, min 0, max 1079, fuzz 0\n    ABS_MT_POSITION_Y : value 0, min 0, max 2399, fuzz 0\n";
        let capabilities =
            parse_android_touch_capabilities(text, 1080, 2400, 0).expect("touchscreen");
        assert_eq!(capabilities.device_path, "/dev/input/event5");
        assert_eq!(capabilities.x.max, 1079);
        assert_eq!(capabilities.height, 2400);
        assert_eq!(scale_touch(540, capabilities.x, capabilities.width), 540);
    }
}
