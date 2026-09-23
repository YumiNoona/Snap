use serde::Deserialize;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::process::Stdio;
use std::sync::{Mutex as StdMutex, OnceLock};
use tauri::Manager;

use crate::process::{background_command, spawn_recording_child};

fn run_ffmpeg(args: &[String]) -> std::result::Result<std::process::Output, String> {
    let mut command = background_command("ffmpeg");
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    spawn_recording_child(&mut command)
        .map_err(|error| format!("Failed to start FFmpeg: {error}"))?
        .wait_with_output()
        .map_err(|error| format!("Failed while waiting for FFmpeg: {error}"))
}

#[derive(Debug, Clone, Copy)]
struct VideoProbeMetrics {
    duration_seconds: f64,
    packets: u64,
    bytes: u64,
}

fn probe_video_metrics(path: &std::path::Path) -> std::result::Result<VideoProbeMetrics, String> {
    let output = background_command("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-count_packets",
            "-show_entries",
            "stream=duration,nb_read_packets:format=duration",
            "-of",
            "json",
        ])
        .arg(path)
        .stdin(Stdio::null())
        .stderr(Stdio::piped())
        .stdout(Stdio::piped())
        .output()
        .map_err(|error| format!("Unable to inspect exported video: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "The exported video container is invalid: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let value: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Unable to read exported video metadata: {error}"))?;
    let stream = value
        .get("streams")
        .and_then(|streams| streams.as_array())
        .and_then(|streams| streams.first())
        .ok_or_else(|| "The exported file does not contain a video stream".to_string())?;
    let parse_number = |value: Option<&serde_json::Value>| {
        value
            .and_then(|value| value.as_str())
            .and_then(|value| value.parse::<f64>().ok())
    };
    let stream_duration = parse_number(stream.get("duration"));
    let format_duration = parse_number(
        value
            .get("format")
            .and_then(|format| format.get("duration")),
    );
    let duration_seconds = stream_duration.or(format_duration).unwrap_or(0.0);
    let packets = stream
        .get("nb_read_packets")
        .and_then(|value| value.as_str())
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    let bytes = std::fs::metadata(path)
        .map_err(|error| format!("Unable to inspect exported video size: {error}"))?
        .len();
    Ok(VideoProbeMetrics {
        duration_seconds,
        packets,
        bytes,
    })
}

fn validate_video_metrics(
    metrics: VideoProbeMetrics,
    expected_duration_seconds: f64,
    fps: u32,
    require_duration: bool,
) -> std::result::Result<(), String> {
    let expected_duration_seconds = expected_duration_seconds.max(0.01);
    let minimum_duration = if expected_duration_seconds < 0.5 {
        expected_duration_seconds * 0.5
    } else {
        expected_duration_seconds * 0.75
    };
    let minimum_packets = (expected_duration_seconds * f64::from(fps.min(10)) * 0.5)
        .ceil()
        .max(1.0) as u64;
    if metrics.bytes < 4_096
        || (require_duration
            && (!metrics.duration_seconds.is_finite()
                || metrics.duration_seconds < minimum_duration))
        || metrics.packets < minimum_packets
    {
        return Err(format!(
            "Export validation failed: expected about {:.2}s of video, but received {:.2}s across {} frames ({} bytes). The incomplete file was not saved.",
            expected_duration_seconds, metrics.duration_seconds, metrics.packets, metrics.bytes
        ));
    }
    Ok(())
}

fn replace_export_output(
    staged: &std::path::Path,
    destination: &std::path::Path,
) -> std::result::Result<(), String> {
    let file_name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("export");
    let backup = destination.with_file_name(format!(".{file_name}.snap-backup"));
    let _ = std::fs::remove_file(&backup);
    let had_previous = destination.exists();
    if had_previous {
        std::fs::rename(destination, &backup)
            .map_err(|error| format!("Unable to preserve the previous export: {error}"))?;
    }
    match std::fs::rename(staged, destination) {
        Ok(()) => {
            if had_previous {
                let _ = std::fs::remove_file(backup);
            }
            Ok(())
        }
        Err(error) => {
            if had_previous {
                let _ = std::fs::rename(&backup, destination);
            }
            Err(format!("Unable to install the completed export: {error}"))
        }
    }
}

#[derive(Deserialize, Clone)]
#[allow(dead_code)]
pub struct ExportKeyframe {
    pub time: f64,
    pub x: f64,
    pub y: f64,
    pub scale: f64,
    pub duration: f64,
}

#[derive(Deserialize)]
#[allow(dead_code)]
pub struct ExportConfig {
    pub background_color: String,
    pub padding: u32,
    pub border_radius: u32,
    pub zoom_enabled: bool,
    pub show_cursor: bool,
    pub keyframes: Vec<ExportKeyframe>,
}

#[derive(Deserialize)]
pub struct ExportSettings {
    pub format: String,
    pub fps: u32,
    pub width: u32,
    pub height: u32,
    pub quality: String,
    #[serde(rename = "outputPath")]
    pub output_path: String,
    #[serde(rename = "audioMode", default = "default_audio_mode")]
    pub audio_mode: String,
    #[serde(rename = "normalizeAudio", default)]
    pub normalize_audio: bool,
}

fn default_audio_mode() -> String {
    "mixed".to_string()
}

#[derive(Deserialize)]
pub struct ExportRequest {
    #[serde(rename = "inputVideo")]
    pub input_video: String,
    pub config: ExportConfig,
    #[serde(rename = "exportSettings")]
    pub export_settings: ExportSettings,
}

/// Legacy export path: re-renders pan/zoom via FFmpeg's `zoompan` filter
/// directly on the raw recording. Kept for reference / as a fast fallback,
/// but it can never fully match the editor: FFmpeg has no equivalent for
/// the custom cursor overlay, click effects, gradient/color backgrounds,
/// padding, shadow, or rounded corners drawn in the canvas preview.
/// The editor now uses `finalize_canvas_export` (below) instead, which
/// encodes the exact frames the canvas preview draws — true WYSIWYG.
#[tauri::command]
pub async fn export_video(
    app: tauri::AppHandle,
    request: ExportRequest,
) -> std::result::Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || export_video_blocking(app, request))
        .await
        .map_err(|error| format!("Export worker failed: {error}"))?
}

fn export_video_blocking(
    app: tauri::AppHandle,
    request: ExportRequest,
) -> std::result::Result<String, String> {
    crate::access::require(&app, std::path::Path::new(&request.input_video))?;
    crate::access::require(
        &app,
        std::path::Path::new(&request.export_settings.output_path),
    )?;
    if request
        .input_video
        .eq_ignore_ascii_case(&request.export_settings.output_path)
    {
        return Err("Export cannot overwrite the original recording".into());
    }
    eprintln!("[Snap Export] Starting export...");
    eprintln!("[Snap Export] Input: {}", request.input_video);
    eprintln!(
        "[Snap Export] Output: {}",
        request.export_settings.output_path
    );

    let settings = &request.export_settings;
    let cfg = &request.config;

    // Parse background hex to FFmpeg color string
    let bg = cfg.background_color.trim_start_matches('#');
    let bg_ffmpeg = format!("0x{bg}");

    let pad = cfg.padding;
    let inner_w = settings.width.saturating_sub(pad * 2);
    let inner_h = settings.height.saturating_sub(pad * 2);

    // Base args for all formats
    let crf = match settings.quality.as_str() {
        "high" => "18",
        "medium" => "23",
        _ => "28",
    };

    let mut args: Vec<String> = vec!["-y".into(), "-i".into(), request.input_video.clone()];

    // Detect sidecar audio files
    let input_path = std::path::Path::new(&request.input_video);
    let stem = input_path.file_stem().unwrap_or_default().to_string_lossy();
    let parent = input_path
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."));
    let audio_dir = parent.join(stem.as_ref());

    let device_wav = audio_dir.join("device_audio.wav");
    let sys_wav = if device_wav.exists() {
        device_wav
    } else {
        audio_dir.join("system_audio.wav")
    };
    let mic_wav = audio_dir.join("mic_audio.wav");
    let has_sys = sys_wav.exists()
        && std::fs::metadata(&sys_wav)
            .map(|m| m.len() > 44)
            .unwrap_or(false);
    let has_mic = mic_wav.exists()
        && std::fs::metadata(&mic_wav)
            .map(|m| m.len() > 44)
            .unwrap_or(false);

    let mut audio_inputs = 0;
    if has_sys {
        args.push("-i".into());
        args.push(sys_wav.to_string_lossy().to_string());
        audio_inputs += 1;
    }
    if has_mic {
        args.push("-i".into());
        args.push(mic_wav.to_string_lossy().to_string());
        audio_inputs += 1;
    }

    args.push("-r".into());
    args.push(settings.fps.to_string());

    let w = settings.width;
    let h = settings.height;

    // Build video filter
    let vf = if cfg.zoom_enabled && !cfg.keyframes.is_empty() {
        let zoom_expr = build_zoompan_expr(&cfg.keyframes, settings.fps, inner_w, inner_h);
        format!("pad=w={w}:h={h}:x={pad}:y={pad}:color={bg_ffmpeg},{zoom_expr}")
    } else {
        format!("scale={inner_w}:{inner_h}:force_original_aspect_ratio=decrease,pad=w={w}:h={h}:x={pad}:y={pad}:color={bg_ffmpeg}")
    };

    if audio_inputs > 0 {
        if audio_inputs == 2 {
            args.push("-filter_complex".into());
            args.push(format!(
                "[0:v]{vf}[v];[1:a][2:a]amix=inputs=2:duration=first[a]"
            ));
            args.push("-map".into());
            args.push("[v]".into());
            args.push("-map".into());
            args.push("[a]".into());
        } else {
            args.push("-filter_complex".into());
            args.push(format!("[0:v]{vf}[v]"));
            args.push("-map".into());
            args.push("[v]".into());
            args.push("-map".into());
            args.push("1:a".into());
        }
        args.push("-c:a".into());
        args.push("aac".into());
        args.push("-b:a".into());
        args.push("192k".into());
    } else {
        args.push("-vf".into());
        args.push(vf);
    }

    // Format-specific args
    if settings.format == "gif" {
        args.push("-f".into());
        args.push("gif".into());
    } else {
        args.extend_from_slice(&[
            "-c:v".into(),
            "libx264".into(),
            "-preset".into(),
            "medium".into(),
            "-crf".into(),
            crf.into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
        ]);
    }

    args.push(settings.output_path.clone());

    eprintln!("[Snap Export] FFmpeg command: ffmpeg {}", args.join(" "));

    let mut incomplete_output = IncompleteExportOutput {
        path: std::path::PathBuf::from(&settings.output_path),
        armed: !std::path::Path::new(&settings.output_path).exists(),
    };
    let output = run_ffmpeg(&args)?;
    let status = output.status;
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !status.success() {
        eprintln!("[Snap Export] FFmpeg stderr:\n{stderr}");
        return Err(format!("FFmpeg exited with error: {status}\n{stderr}"));
    }

    let output = request.export_settings.output_path.clone();
    let meta = std::fs::metadata(&output).map_err(|e| format!("Output not found: {e}"))?;
    incomplete_output.armed = false;

    eprintln!(
        "[Snap Export] Done — {} bytes written to {}",
        meta.len(),
        output
    );

    Ok(format!(
        "Exported: {} ({:.1} MB)",
        output,
        meta.len() as f64 / 1_048_576.0
    ))
}

/// Build a nested if/else FFmpeg expression that piecewise-linearly
/// interpolates `value_of(kf)` across every keyframe over time, evaluated
/// at T = on/fps (on = zoompan's per-output-frame counter). Falls back to
/// the last keyframe's value past the final keyframe, and holds the first
/// keyframe's value before it starts (the clamped `max(0,min(1,...))` frac
/// handles that automatically).
fn build_piecewise(
    kfs: &[ExportKeyframe],
    fps: u32,
    value_of: impl Fn(&ExportKeyframe) -> f64,
) -> String {
    if kfs.len() == 1 {
        return format!("{:.5}", value_of(&kfs[0]));
    }
    // Start from the tail value and wrap backwards so evaluation short-
    // circuits into the correct segment for T.
    let mut expr = format!("{:.5}", value_of(&kfs[kfs.len() - 1]));
    for i in (0..kfs.len() - 1).rev() {
        let t0 = kfs[i].time / 1000.0;
        let t1 = kfs[i + 1].time / 1000.0;
        let v0 = value_of(&kfs[i]);
        let v1 = value_of(&kfs[i + 1]);
        let span = (t1 - t0).max(1.0 / fps as f64); // avoid div-by-zero on duplicate timestamps
        expr = format!(
            "if(lte(on/{fps},{t1:.5}),({v0:.5})+(({v1:.5})-({v0:.5}))*max(0,min(1,(on/{fps}-{t0:.5})/{span:.5})),{expr})",
            fps = fps, t1 = t1, v0 = v0, v1 = v1, t0 = t0, span = span, expr = expr
        );
    }
    expr
}

/// Build a zoompan FFmpeg filter expression from keyframes. Follows every
/// keyframe's real scale and pan target (x, y as fractions of the frame),
/// linearly interpolated across the full timeline — not just a jump
/// between two points with a hardcoded center pan.
fn build_zoompan_expr(keyframes: &[ExportKeyframe], fps: u32, w: u32, h: u32) -> String {
    if keyframes.is_empty() {
        return format!("zoompan=z=1:x=0:y=0:d=1:s={}x{}:fps={}", w, h, fps);
    }

    // Sort keyframes by time
    let mut kfs = keyframes.to_vec();
    kfs.sort_by(|a, b| a.time.partial_cmp(&b.time).unwrap());

    let z_expr = build_piecewise(&kfs, fps, |k| k.scale.max(1.0));
    let x_frac_expr = build_piecewise(&kfs, fps, |k| k.x);
    let y_frac_expr = build_piecewise(&kfs, fps, |k| k.y);

    // x/y are the top-left corner of the crop window in *input* pixels.
    // `zoom` in these expressions refers to this frame's already-resolved
    // z value. Clamp so the crop window never leaves the source frame.
    let x_expr = format!("max(0,min(iw-iw/zoom,({x_frac_expr})*iw-(iw/zoom)/2))");
    let y_expr = format!("max(0,min(ih-ih/zoom,({y_frac_expr})*ih-(ih/zoom)/2))");

    format!(
        "zoompan=z='{z}':x='{x}':y='{y}':d=1:s={w}x{h}:fps={fps}",
        z = z_expr,
        x = x_expr,
        y = y_expr,
        w = w,
        h = h,
        fps = fps
    )
}

// ── Canvas export pipeline ───────────────────────────────────────────────
//
// The editor renders every frame of the export the exact same way the
// canvas preview does (background, cover-cropped pan/zoom, custom cursor
// overlay, click ripples, mask layers) by playing the recording in real
// time and capturing the on-screen canvas via `canvas.captureStream()` +
// `MediaRecorder`. The resulting WebM bytes are streamed to disk here in
// chunks (there's no bundled `fs` plugin, so this direct sink avoids
// adding one), then muxed with the original audio and transcoded to the
// user's chosen format by `finalize_canvas_export`.

struct ExportSink {
    writer: BufWriter<File>,
    owner: String,
    path: std::path::PathBuf,
}

static EXPORT_SINK: OnceLock<StdMutex<Option<ExportSink>>> = OnceLock::new();

fn export_sink() -> &'static StdMutex<Option<ExportSink>> {
    EXPORT_SINK.get_or_init(|| StdMutex::new(None))
}

/// Open (create/truncate) the temp file that streamed WebM chunks are
/// written into. Must be called before any `write_export_chunk` calls.
#[tauri::command]
pub fn open_export_sink(
    app: tauri::AppHandle,
    window: tauri::Window,
    path: String,
    output_path: String,
) -> std::result::Result<(), String> {
    let output = std::path::Path::new(&output_path);
    crate::access::require(&app, output)?;
    let expected = output.with_extension("snapexport.webm");
    if std::path::Path::new(&path) != expected {
        return Err("Invalid export staging path".into());
    }
    for allowed in [
        expected,
        output.with_extension("srt"),
        output.with_extension("vtt"),
    ] {
        app.asset_protocol_scope()
            .allow_file(allowed)
            .map_err(|e| e.to_string())?;
    }
    let mut guard = export_sink().lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Err("Another export is already running".into());
    }
    let file = File::create(&path).map_err(|e| format!("Cannot create export temp file: {e}"))?;
    *guard = Some(ExportSink {
        writer: BufWriter::new(file),
        owner: window.label().to_string(),
        path: std::path::PathBuf::from(path),
    });
    Ok(())
}

/// Append one chunk of the recorded canvas stream to the open sink.
/// Callers must await each call before sending the next chunk — chunks
/// are written in the order they arrive with no reordering.
#[tauri::command]
pub fn write_export_chunk(
    window: tauri::Window,
    bytes: Vec<u8>,
) -> std::result::Result<(), String> {
    let mut guard = export_sink().lock().map_err(|e| e.to_string())?;
    match guard.as_mut() {
        Some(sink) if sink.owner == window.label() => sink
            .writer
            .write_all(&bytes)
            .map_err(|e| format!("Export write failed: {e}")),
        Some(_) => Err("Export sink belongs to another window".to_string()),
        None => Err("Export sink not open".to_string()),
    }
}

/// Flush and close the sink once recording has finished.
#[tauri::command]
pub fn close_export_sink(window: tauri::Window) -> std::result::Result<(), String> {
    let mut guard = export_sink().lock().map_err(|e| e.to_string())?;
    if guard
        .as_ref()
        .is_some_and(|sink| sink.owner != window.label())
    {
        return Err("Export sink belongs to another window".into());
    }
    if let Some(mut sink) = guard.take() {
        sink.writer
            .flush()
            .map_err(|e| format!("Export flush failed: {e}"))?;
    }
    Ok(())
}

pub(crate) fn discard_export_sink_for_window(owner: &str) {
    let Ok(mut guard) = export_sink().lock() else {
        return;
    };
    if guard.as_ref().is_none_or(|sink| sink.owner != owner) {
        return;
    }
    if let Some(mut sink) = guard.take() {
        let _ = sink.writer.flush();
        drop(sink.writer);
        let _ = std::fs::remove_file(sink.path);
    }
}

#[tauri::command]
pub fn discard_canvas_export(
    app: tauri::AppHandle,
    window: tauri::Window,
    temp_webm_path: String,
    output_path: String,
) -> std::result::Result<(), String> {
    crate::access::require(&app, std::path::Path::new(&output_path))?;
    let expected = std::path::Path::new(&output_path).with_extension("snapexport.webm");
    if std::path::Path::new(&temp_webm_path) != expected {
        return Err("Invalid export staging path".into());
    }
    discard_export_sink_for_window(window.label());
    for path in [
        expected.clone(),
        std::path::PathBuf::from(format!("{}.clicks.wav", expected.display())),
        std::path::PathBuf::from(format!("{}.captions.srt", expected.display())),
    ] {
        match std::fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Could not remove export staging file: {error}")),
        }
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct CanvasExportRequest {
    #[serde(rename = "tempWebmPath")]
    pub temp_webm_path: String,
    /// Original recorded video — used only to locate the sidecar audio
    /// files (same directory convention as the legacy export path).
    #[serde(rename = "inputVideo")]
    pub input_video: String,
    #[serde(rename = "exportSettings")]
    pub export_settings: ExportSettings,
    #[serde(rename = "clickTimesMs", default)]
    pub click_times_ms: Vec<f64>,
    #[serde(rename = "audioMix", default)]
    pub audio_mix: CanvasAudioMix,
    #[serde(rename = "audioTracks", default)]
    pub audio_tracks: Vec<CanvasAudioTrack>,
    #[serde(rename = "trimStartSeconds", default)]
    pub trim_start_seconds: f64,
    #[serde(rename = "exportDurationSeconds", default)]
    pub export_duration_seconds: f64,
    #[serde(rename = "playbackRate", default = "default_playback_rate")]
    pub playback_rate: f64,
    #[serde(rename = "captionSrt", default)]
    pub caption_srt: Option<String>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CanvasAudioTrack {
    pub path: String,
    pub label: String,
    pub kind: String,
    pub muted: bool,
    pub volume: f64,
}

fn default_playback_rate() -> f64 {
    1.0
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct CanvasAudioMix {
    pub system_volume: f64,
    pub mic_volume: f64,
    pub system_muted: bool,
    pub mic_muted: bool,
}

impl Default for CanvasAudioMix {
    fn default() -> Self {
        Self {
            system_volume: 100.0,
            mic_volume: 100.0,
            system_muted: false,
            mic_muted: false,
        }
    }
}

struct ExportTempFiles(Vec<std::path::PathBuf>);

impl Drop for ExportTempFiles {
    fn drop(&mut self) {
        for path in &self.0 {
            let _ = std::fs::remove_file(path);
        }
    }
}

struct IncompleteExportOutput {
    path: std::path::PathBuf,
    armed: bool,
}

impl Drop for IncompleteExportOutput {
    fn drop(&mut self) {
        if self.armed {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

fn write_click_track(
    path: &std::path::Path,
    click_times_ms: &[f64],
    duration_seconds: f64,
) -> std::result::Result<(), String> {
    const RATE: u32 = 44_100;
    const CLICK_SAMPLES: usize = (RATE as usize * 95) / 1000;
    const CHUNK_SAMPLES: usize = 4096;
    if !duration_seconds.is_finite() || !(0.0..=43_200.0).contains(&duration_seconds) {
        return Err("Invalid click-track duration".into());
    }
    let duration_ms = duration_seconds * 1000.0;
    if click_times_ms
        .iter()
        .any(|time| !time.is_finite() || *time < 0.0 || *time > duration_ms)
    {
        return Err("Click timestamp falls outside the exported duration".into());
    }
    let mut clicks = click_times_ms
        .iter()
        .copied()
        .enumerate()
        .map(|(index, time)| (((time / 1000.0) * RATE as f64).round() as usize, index))
        .collect::<Vec<_>>();
    clicks.sort_unstable_by_key(|(start, _)| *start);
    let samples = ((duration_seconds * RATE as f64).ceil() as usize).max(1);
    let data_size = u32::try_from(samples.saturating_mul(2))
        .map_err(|_| "Click track is too long for PCM WAV".to_string())?;
    let mut out =
        BufWriter::new(File::create(path).map_err(|e| format!("Cannot create click track: {e}"))?);
    out.write_all(b"RIFF").map_err(|e| e.to_string())?;
    out.write_all(&(36 + data_size).to_le_bytes())
        .map_err(|e| e.to_string())?;
    out.write_all(b"WAVEfmt ").map_err(|e| e.to_string())?;
    out.write_all(&16u32.to_le_bytes())
        .map_err(|e| e.to_string())?;
    out.write_all(&1u16.to_le_bytes())
        .map_err(|e| e.to_string())?;
    out.write_all(&1u16.to_le_bytes())
        .map_err(|e| e.to_string())?;
    out.write_all(&RATE.to_le_bytes())
        .map_err(|e| e.to_string())?;
    out.write_all(&(RATE * 2).to_le_bytes())
        .map_err(|e| e.to_string())?;
    out.write_all(&2u16.to_le_bytes())
        .map_err(|e| e.to_string())?;
    out.write_all(&16u16.to_le_bytes())
        .map_err(|e| e.to_string())?;
    out.write_all(b"data").map_err(|e| e.to_string())?;
    out.write_all(&data_size.to_le_bytes())
        .map_err(|e| e.to_string())?;
    let mut chunk_start = 0usize;
    let mut first_possible = 0usize;
    while chunk_start < samples {
        let chunk_len = CHUNK_SAMPLES.min(samples - chunk_start);
        let chunk_end = chunk_start + chunk_len;
        let mut pcm = vec![0i16; chunk_len];
        while first_possible < clicks.len()
            && clicks[first_possible].0.saturating_add(CLICK_SAMPLES) <= chunk_start
        {
            first_possible += 1;
        }
        for &(start, click_index) in &clicks[first_possible..] {
            if start >= chunk_end {
                break;
            }
            let overlap_start = start.max(chunk_start);
            let overlap_end = start.saturating_add(CLICK_SAMPLES).min(chunk_end);
            for dst in overlap_start..overlap_end {
                let i = dst - start;
                let t = i as f64 / RATE as f64;
                let envelope = (-48.0 * t).exp();
                let tone = (std::f64::consts::TAU * (1050.0 - 4200.0 * t) * t).sin();
                let noise_seed = ((i as u64 * 1_103_515_245 + click_index as u64 * 12_345) & 0xffff)
                    as f64
                    / 32768.0
                    - 1.0;
                let value = ((tone * 0.8 + noise_seed * 0.2) * envelope * 7000.0) as i32;
                let slot = &mut pcm[dst - chunk_start];
                *slot = (*slot as i32 + value).clamp(i16::MIN as i32, i16::MAX as i32) as i16;
            }
        }
        for sample in pcm {
            out.write_all(&sample.to_le_bytes())
                .map_err(|e| e.to_string())?;
        }
        chunk_start = chunk_end;
    }
    out.flush().map_err(|e| e.to_string())
}

/// Mux the recorded-canvas WebM (already has every visual baked in —
/// cursor, background, pan/zoom, styling) with the original system/mic
/// audio and transcode to the user's chosen output format.
#[tauri::command]
pub async fn finalize_canvas_export(
    app: tauri::AppHandle,
    request: CanvasExportRequest,
) -> std::result::Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || finalize_canvas_export_blocking(app, request))
        .await
        .map_err(|error| format!("Export worker failed: {error}"))?
}

fn finalize_canvas_export_blocking(
    app: tauri::AppHandle,
    request: CanvasExportRequest,
) -> std::result::Result<String, String> {
    let settings = &request.export_settings;
    crate::access::require(&app, std::path::Path::new(&settings.output_path))?;
    crate::access::require(&app, std::path::Path::new(&request.input_video))?;
    crate::access::require(&app, std::path::Path::new(&request.temp_webm_path))?;
    if settings
        .output_path
        .eq_ignore_ascii_case(&request.input_video)
    {
        return Err("Export cannot overwrite the original recording".into());
    }
    if !["mp4", "gif"].contains(&settings.format.as_str())
        || !(1..=60).contains(&settings.fps)
        || !(2..=7680).contains(&settings.width)
        || !(2..=4320).contains(&settings.height)
        || !request.export_duration_seconds.is_finite()
        || !(0.0..=86400.0).contains(&request.export_duration_seconds)
    {
        return Err("Invalid export dimensions, frame rate or duration".into());
    }
    for track in &request.audio_tracks {
        crate::access::require(&app, std::path::Path::new(&track.path))?;
    }
    let playback_rate = request.playback_rate.clamp(0.5, 2.0);
    let captured_metrics = probe_video_metrics(std::path::Path::new(&request.temp_webm_path))?;
    validate_video_metrics(
        captured_metrics,
        request.export_duration_seconds,
        settings.fps,
        false,
    )?;

    eprintln!(
        "[Snap Export] Finalizing canvas export -> {}",
        settings.output_path
    );

    let input_path = std::path::Path::new(&request.input_video);
    let stem = input_path.file_stem().unwrap_or_default().to_string_lossy();
    let parent = input_path
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."));
    let audio_dir = parent.join(stem.as_ref());
    let device_wav = audio_dir.join("device_audio.wav");
    let sys_wav = if device_wav.exists() {
        device_wav
    } else {
        audio_dir.join("system_audio.wav")
    };
    let mic_wav = audio_dir.join("mic_audio.wav");
    let has_sys = sys_wav.exists()
        && std::fs::metadata(&sys_wav)
            .map(|m| m.len() > 44)
            .unwrap_or(false);
    let has_mic = mic_wav.exists()
        && std::fs::metadata(&mic_wav)
            .map(|m| m.len() > 44)
            .unwrap_or(false);
    let click_wav = std::path::PathBuf::from(format!("{}.clicks.wav", request.temp_webm_path));
    let caption_srt = std::path::PathBuf::from(format!("{}.captions.srt", request.temp_webm_path));
    let destination = std::path::PathBuf::from(&settings.output_path);
    let output_parent = destination
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."));
    let output_stem = destination
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("export");
    let output_extension = destination
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or(settings.format.as_str());
    let final_staging = output_parent.join(format!(
        ".{output_stem}.snapexport.final.{output_extension}"
    ));
    let _ = std::fs::remove_file(&final_staging);
    let mut temporary_files = ExportTempFiles(vec![
        std::path::PathBuf::from(&request.temp_webm_path),
        final_staging.clone(),
    ]);
    let has_embedded_captions = request
        .caption_srt
        .as_ref()
        .is_some_and(|contents| !contents.trim().is_empty());
    if let Some(contents) = request
        .caption_srt
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        std::fs::write(&caption_srt, contents)
            .map_err(|error| format!("Unable to prepare embedded captions: {error}"))?;
        temporary_files.0.push(caption_srt.clone());
    }
    let has_clicks = !request.click_times_ms.is_empty();
    if has_clicks {
        write_click_track(
            &click_wav,
            &request.click_times_ms,
            request.export_duration_seconds,
        )?;
        temporary_files.0.push(click_wav.clone());
    }

    let crf = match settings.quality.as_str() {
        "high" => "18",
        "medium" => "23",
        _ => "28",
    };

    let mut args: Vec<String> = vec!["-y".into(), "-i".into(), request.temp_webm_path.clone()];

    if settings.format == "gif" {
        // GIF export: no audio track. Downsample fps for reasonable file size.
        args.push("-vf".into());
        args.push("fps=15,scale=iw:-1:flags=lanczos".into());
        args.push("-f".into());
        args.push("gif".into());
    } else {
        // The canvas WebM has already been recorded at the selected clip
        // speed. Source WAVs still use original recording time, so retime only
        // those tracks; generated click audio is already placed in output time.
        let mut audio_sources: Vec<(usize, f64, String, bool)> = Vec::new();
        let mut input_index = 1usize;
        let requested_audio = request
            .audio_tracks
            .iter()
            .filter(|track| {
                !track.muted
                    && std::fs::metadata(&track.path)
                        .map(|metadata| metadata.len() > 0)
                        .unwrap_or(false)
                    && if track.kind == "microphone" {
                        !request.audio_mix.mic_muted
                    } else if track.kind == "system" || track.kind == "device" {
                        !request.audio_mix.system_muted
                    } else {
                        true
                    }
            })
            .collect::<Vec<_>>();

        if !request.audio_tracks.is_empty() {
            for track in requested_audio {
                if request.trim_start_seconds > 0.0 {
                    args.push("-ss".into());
                    args.push(format!("{:.6}", request.trim_start_seconds));
                }
                args.push("-i".into());
                args.push(track.path.clone());
                let channel_volume = if track.kind == "microphone" {
                    request.audio_mix.mic_volume / 100.0
                } else if track.kind == "system" || track.kind == "device" {
                    request.audio_mix.system_volume / 100.0
                } else {
                    1.0
                };
                audio_sources.push((
                    input_index,
                    channel_volume * track.volume.clamp(0.0, 2.0),
                    track.label.clone(),
                    true,
                ));
                input_index += 1;
            }
        } else {
            if has_sys && !request.audio_mix.system_muted {
                if request.trim_start_seconds > 0.0 {
                    args.push("-ss".into());
                    args.push(format!("{:.6}", request.trim_start_seconds));
                }
                args.push("-i".into());
                args.push(sys_wav.to_string_lossy().to_string());
                audio_sources.push((
                    input_index,
                    request.audio_mix.system_volume / 100.0,
                    "Desktop audio".into(),
                    true,
                ));
                input_index += 1;
            }
            if has_mic && !request.audio_mix.mic_muted {
                if request.trim_start_seconds > 0.0 {
                    args.push("-ss".into());
                    args.push(format!("{:.6}", request.trim_start_seconds));
                }
                args.push("-i".into());
                args.push(mic_wav.to_string_lossy().to_string());
                audio_sources.push((
                    input_index,
                    request.audio_mix.mic_volume / 100.0,
                    "Microphone".into(),
                    true,
                ));
                input_index += 1;
            }
        }
        if has_clicks {
            args.push("-i".into());
            args.push(click_wav.to_string_lossy().to_string());
            audio_sources.push((input_index, 1.0, "Click effects".into(), false));
            input_index += 1;
        }

        let subtitle_index = if has_embedded_captions {
            args.push("-i".into());
            args.push(caption_srt.to_string_lossy().to_string());
            Some(input_index)
        } else {
            None
        };

        if request.export_settings.audio_mode == "separate" && !audio_sources.is_empty() {
            let mut filter = String::new();
            for (slot, (idx, volume, _, retime)) in audio_sources.iter().enumerate() {
                let normalize = if settings.normalize_audio {
                    ",loudnorm=I=-16:LRA=11:TP=-1.5"
                } else {
                    ""
                };
                let speed = if *retime {
                    format!(",atempo={playback_rate:.6}")
                } else {
                    String::new()
                };
                filter.push_str(&format!(
                    "[{idx}:a]volume={volume:.3}{normalize}{speed},apad[a{slot}];"
                ));
            }
            args.push("-filter_complex".into());
            args.push(filter.trim_end_matches(';').to_string());
            args.push("-map".into());
            args.push("0:v".into());
            for slot in 0..audio_sources.len() {
                args.push("-map".into());
                args.push(format!("[a{slot}]"));
            }
            args.push("-c:a".into());
            args.push("aac".into());
            args.push("-b:a".into());
            args.push("192k".into());
            for (slot, (_, _, label, _)) in audio_sources.iter().enumerate() {
                args.push(format!("-metadata:s:a:{slot}"));
                args.push(format!("title={label}"));
            }
        } else if audio_sources.len() > 1 {
            let mut filter = String::new();
            for (slot, (idx, volume, _, retime)) in audio_sources.iter().enumerate() {
                let speed = if *retime {
                    format!(",atempo={playback_rate:.6}")
                } else {
                    String::new()
                };
                filter.push_str(&format!("[{idx}:a]volume={volume:.3}{speed}[a{slot}];"));
            }
            for slot in 0..audio_sources.len() {
                filter.push_str(&format!("[a{slot}]"));
            }
            let normalize = if settings.normalize_audio {
                ",loudnorm=I=-16:LRA=11:TP=-1.5"
            } else {
                ""
            };
            filter.push_str(&format!(
                "amix=inputs={}:duration=longest{normalize},apad[a]",
                audio_sources.len()
            ));
            args.push("-filter_complex".into());
            args.push(filter);
            args.push("-map".into());
            args.push("0:v".into());
            args.push("-map".into());
            args.push("[a]".into());
            args.push("-c:a".into());
            args.push("aac".into());
            args.push("-b:a".into());
            args.push("192k".into());
        } else if let Some((idx, volume, _, retime)) = audio_sources.first() {
            args.push("-filter_complex".into());
            let normalize = if settings.normalize_audio {
                ",loudnorm=I=-16:LRA=11:TP=-1.5"
            } else {
                ""
            };
            let speed = if *retime {
                format!(",atempo={playback_rate:.6}")
            } else {
                String::new()
            };
            args.push(format!(
                "[{idx}:a]volume={volume:.3}{normalize}{speed},apad[a]"
            ));
            args.push("-map".into());
            args.push("0:v".into());
            args.push("-map".into());
            args.push("[a]".into());
            args.push("-c:a".into());
            args.push("aac".into());
            args.push("-b:a".into());
            args.push("192k".into());
        } else {
            args.push("-map".into());
            args.push("0:v".into());
            args.push("-an".into());
        }

        if let Some(index) = subtitle_index {
            args.push("-map".into());
            args.push(format!("{index}:s:0"));
            args.push("-c:s".into());
            args.push("mov_text".into());
            args.push("-metadata:s:s:0".into());
            args.push("language=und".into());
        }

        args.extend_from_slice(&[
            "-c:v".into(),
            "libx264".into(),
            "-preset".into(),
            "medium".into(),
            "-crf".into(),
            crf.into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
            "-shortest".into(),
        ]);
    }

    args.push(final_staging.to_string_lossy().to_string());

    eprintln!(
        "[Snap Export] Finalize FFmpeg command: ffmpeg {}",
        args.join(" ")
    );

    let output = run_ffmpeg(&args)?;
    let status = output.status;
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !status.success() {
        eprintln!("[Snap Export] FFmpeg stderr:\n{stderr}");
        return Err(format!("FFmpeg exited with error: {status}\n{stderr}"));
    }

    let finalized_metrics = probe_video_metrics(&final_staging)?;
    validate_video_metrics(
        finalized_metrics,
        request.export_duration_seconds,
        settings.fps,
        true,
    )?;
    replace_export_output(&final_staging, &destination)?;
    let output = request.export_settings.output_path.clone();
    let meta = std::fs::metadata(&output).map_err(|e| format!("Output not found: {e}"))?;

    eprintln!(
        "[Snap Export] Canvas export done — {} bytes written to {}",
        meta.len(),
        output
    );

    Ok(format!(
        "Exported: {} ({:.1} MB)",
        output,
        meta.len() as f64 / 1_048_576.0
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn click_track_is_valid_pcm_wav_with_requested_duration() {
        let path = std::env::temp_dir().join(format!("snap_click_test_{}.wav", std::process::id()));
        write_click_track(&path, &[100.0, 450.0], 1.0).expect("click track");
        let bytes = std::fs::read(&path).expect("read wav");
        let _ = std::fs::remove_file(&path);
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        assert!(bytes.len() >= 44 + 44_100 * 2);
        assert!(bytes[44..].iter().any(|byte| *byte != 0));
    }

    #[test]
    fn click_track_rejects_invalid_timestamps() {
        let path = std::env::temp_dir().join(format!(
            "snap_click_invalid_test_{}.wav",
            std::process::id()
        ));
        assert!(write_click_track(&path, &[f64::NAN], 1.0).is_err());
        assert!(write_click_track(&path, &[1_001.0], 1.0).is_err());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn export_validation_rejects_header_only_video() {
        let result = validate_video_metrics(
            VideoProbeMetrics {
                duration_seconds: 0.016,
                packets: 2,
                bytes: 7_308,
            },
            20.0,
            60,
            true,
        );
        assert!(result.is_err());
    }

    #[test]
    fn export_validation_accepts_complete_video() {
        validate_video_metrics(
            VideoProbeMetrics {
                duration_seconds: 19.98,
                packets: 1_199,
                bytes: 42_000_000,
            },
            20.0,
            60,
            true,
        )
        .expect("complete export");
    }

    #[test]
    fn capture_validation_accepts_stream_without_container_duration() {
        validate_video_metrics(
            VideoProbeMetrics {
                duration_seconds: 0.0,
                packets: 1_199,
                bytes: 42_000_000,
            },
            20.0,
            60,
            false,
        )
        .expect("complete streaming capture");
    }

    #[test]
    fn zoom_expression_contains_each_segment() {
        let keyframes = vec![
            ExportKeyframe {
                time: 0.0,
                x: 0.5,
                y: 0.5,
                scale: 1.0,
                duration: 0.0,
            },
            ExportKeyframe {
                time: 1000.0,
                x: 0.25,
                y: 0.75,
                scale: 2.0,
                duration: 400.0,
            },
        ];
        let filter = build_zoompan_expr(&keyframes, 60, 1280, 720);
        assert!(filter.contains("zoompan"));
        assert!(filter.contains("2.00000"));
        assert!(filter.contains("fps=60"));
    }

    #[test]
    fn canvas_export_accepts_project_audio_tracks() {
        let request: CanvasExportRequest = serde_json::from_value(serde_json::json!({
            "tempWebmPath": "temp.webm",
            "inputVideo": "recording.mp4",
            "exportSettings": {
                "format": "mp4", "fps": 30, "width": 1280, "height": 720,
                "quality": "medium", "outputPath": "output.mp4"
            },
            "audioTracks": [{
                "path": "music.wav", "label": "Music", "kind": "imported",
                "muted": false, "volume": 0.65
            }]
        }))
        .expect("canvas export request");
        assert_eq!(request.audio_tracks.len(), 1);
        assert_eq!(request.audio_tracks[0].kind, "imported");
        assert_eq!(request.audio_tracks[0].volume, 0.65);
    }
}
