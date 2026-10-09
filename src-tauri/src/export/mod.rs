use serde::Deserialize;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::process::Stdio;
use std::sync::{Mutex as StdMutex, OnceLock};
use tauri::Manager;

use crate::process::{background_command, spawn_recording_child};

fn run_ffmpeg(args: &[String]) -> std::result::Result<std::process::Output, String> {
    // Large edited sequences can exceed Windows' command-line limit. Keep
    // filter graphs in unique temporary files and remove them on every exit.
    struct FilterScript(std::path::PathBuf);
    impl Drop for FilterScript {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
    let mut prepared = args.to_vec();
    let mut scripts = Vec::new();
    for index in 0..args.len().saturating_sub(1) {
        if args[index] == "-filter_complex" && args[index + 1].len() > 8192 {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|error| error.to_string())?
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "snap_export_filter_{}_{nonce}.txt",
                std::process::id()
            ));
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map_err(|error| format!("Could not prepare export filter: {error}"))?;
            scripts.push(FilterScript(path.clone()));
            file.write_all(args[index + 1].as_bytes())
                .map_err(|error| format!("Could not write export filter: {error}"))?;
            prepared[index] = "-filter_complex_script".into();
            prepared[index + 1] = path.to_string_lossy().to_string();
        }
    }
    let mut command = background_command("ffmpeg");
    command
        .args(&prepared)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    spawn_recording_child(&mut command)
        .map_err(|error| format!("Failed to start FFmpeg: {error}"))?
        .wait_with_output()
        .map_err(|error| format!("Failed while waiting for FFmpeg: {error}"))
}

fn delivery_paths(output: &std::path::Path) -> [std::path::PathBuf; 3] {
    [
        output.with_extension("transcript.txt"),
        output.with_extension("chapters.json"),
        output.with_extension("thumbnail.png"),
    ]
}

/// Derive exact companion paths from the user-selected export; never grant its
/// parent directory or let the frontend supply arbitrary companion filenames.
#[tauri::command]
pub async fn write_delivery_package(
    app: tauri::AppHandle,
    output_path: String,
    transcript: String,
    chapters: String,
    thumbnail_time_seconds: f64,
) -> Result<(), String> {
    let output = std::path::PathBuf::from(output_path);
    crate::access::require(&app, &output)?;
    if !output.is_file()
        || transcript.len() > 4 * 1024 * 1024
        || chapters.len() > 4 * 1024 * 1024
        || !thumbnail_time_seconds.is_finite()
        || !(0.0..=86400.0).contains(&thumbnail_time_seconds)
    {
        return Err("Invalid delivery package or missing exported video".into());
    }
    let chapter_data: serde_json::Value =
        serde_json::from_str(&chapters).map_err(|_| "Invalid chapter document".to_string())?;
    if !chapter_data
        .as_array()
        .is_some_and(|items| items.len() <= 10_000)
    {
        return Err("Invalid chapter document".into());
    }
    let paths = delivery_paths(&output);
    for path in &paths {
        app.asset_protocol_scope()
            .allow_file(path)
            .map_err(|error| error.to_string())?;
    }
    tauri::async_runtime::spawn_blocking(move || {
        crate::persist_text_atomic(paths[0].to_string_lossy().into_owned(), transcript)?;
        crate::persist_text_atomic(paths[1].to_string_lossy().into_owned(), chapters)?;
        let args = vec![
            "-y".into(),
            "-ss".into(),
            format!("{thumbnail_time_seconds:.3}"),
            "-i".into(),
            output.to_string_lossy().into_owned(),
            "-frames:v".into(),
            "1".into(),
            "-update".into(),
            "1".into(),
            paths[2].to_string_lossy().into_owned(),
        ];
        let result = run_ffmpeg(&args)?;
        if !result.status.success() || !paths[2].is_file() {
            return Err("Video saved, but its thumbnail could not be created".into());
        }
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn extract_video_frame(
    app: tauri::AppHandle,
    input_path: String,
    output_path: String,
    time_seconds: f64,
) -> std::result::Result<String, String> {
    crate::access::require(&app, std::path::Path::new(&input_path))?;
    crate::access::require(&app, std::path::Path::new(&output_path))?;
    if !time_seconds.is_finite() || time_seconds < 0.0 {
        return Err("Invalid frame time".into());
    }
    if let Some(parent) = std::path::Path::new(&output_path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create frame folder: {error}"))?;
    }
    let args = vec![
        "-y".into(),
        "-ss".into(),
        format!("{time_seconds:.3}"),
        "-i".into(),
        input_path,
        "-frames:v".into(),
        "1".into(),
        "-update".into(),
        "1".into(),
        output_path.clone(),
    ];
    let output = tauri::async_runtime::spawn_blocking(move || run_ffmpeg(&args))
        .await
        .map_err(|error| error.to_string())??;
    if !output.status.success() || !std::path::Path::new(&output_path).is_file() {
        return Err(format!(
            "Could not extract frame: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(output_path)
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
    #[serde(rename = "loop", default)]
    pub loop_output: bool,
}

fn default_audio_mode() -> String {
    "mixed".to_string()
}

// ── Canvas export pipeline ───────────────────────────────────────────────
//
// The editor renders every frame of the export the exact same way the
// canvas preview does (background, cover-cropped pan/zoom, custom cursor
// overlay, click ripples, mask layers), then sends those frames through
// WebCodecs into an IVF staging stream. The resulting bytes are streamed
// to disk here in chunks (there's no bundled `fs` plugin, so this direct
// sink avoids adding one), then muxed with the original audio and
// transcoded to the user's chosen format by `finalize_canvas_export`.

struct ExportSink {
    writer: BufWriter<File>,
    owner: String,
    path: std::path::PathBuf,
}

static EXPORT_SINK: OnceLock<StdMutex<Option<ExportSink>>> = OnceLock::new();

fn export_sink() -> &'static StdMutex<Option<ExportSink>> {
    EXPORT_SINK.get_or_init(|| StdMutex::new(None))
}

fn validated_export_staging_path(
    staging_path: &std::path::Path,
    output_path: &std::path::Path,
) -> std::result::Result<std::path::PathBuf, String> {
    let allowed = [
        output_path.with_extension("snapexport.ivf"),
        output_path.with_extension("snapexport.h264"),
        output_path.with_extension("snapexport.mjpeg"),
        output_path.with_extension("snapexport.webm"),
    ];
    allowed
        .into_iter()
        .find(|candidate| candidate == staging_path)
        .ok_or_else(|| "Invalid export staging path".to_string())
}

/// Open (create/truncate) the temp file that encoded canvas chunks are
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
    let staging = validated_export_staging_path(std::path::Path::new(&path), output)?;
    for allowed in [
        staging,
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
    request: tauri::ipc::Request<'_>,
) -> std::result::Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Export frames require binary IPC".into());
    };
    if bytes.len() > 256 * 1024 {
        return Err("Export frame chunk exceeds the IPC limit".into());
    }
    let mut guard = export_sink().lock().map_err(|e| e.to_string())?;
    match guard.as_mut() {
        Some(sink) if sink.owner == window.label() => sink
            .writer
            .write_all(bytes)
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
    let staging = validated_export_staging_path(
        std::path::Path::new(&temp_webm_path),
        std::path::Path::new(&output_path),
    )?;
    discard_export_sink_for_window(window.label());
    for path in [
        staging.clone(),
        std::path::PathBuf::from(format!("{}.clicks.wav", staging.display())),
        std::path::PathBuf::from(format!("{}.captions.srt", staging.display())),
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
    #[serde(rename = "sourceSegments", default)]
    pub source_segments: Vec<SourceSegment>,
}

#[derive(Deserialize, Clone, Default)]
pub struct SourceSegment {
    pub start: f64,
    pub end: f64,
    #[serde(default)]
    pub gap: bool,
    pub speed: Option<f64>,
}

fn source_audio_filter(
    idx: usize,
    volume: f64,
    normalize: &str,
    speed: &str,
    label: &str,
    segments: &[SourceSegment],
) -> String {
    if segments.is_empty() {
        return format!("[{idx}:a]volume={volume:.3}{normalize}{speed},apad[{label}]");
    }
    let mut filter = format!("[{idx}:a]apad,asplit={}", segments.len());
    for i in 0..segments.len() {
        filter.push_str(&format!("[{label}_src{idx}_{i}]"));
    }
    filter.push(';');
    for (i, segment) in segments.iter().enumerate() {
        let mut tempo = String::new();
        let mut rate = segment.speed.unwrap_or(1.0).clamp(0.25,4.0);
        while rate < 0.5 { tempo.push_str(",atempo=0.5"); rate /= 0.5; }
        while rate > 2.0 { tempo.push_str(",atempo=2.0"); rate /= 2.0; }
        if (rate-1.0).abs()>0.000001 { tempo.push_str(&format!(",atempo={rate:.6}")); }
        let silence=if segment.gap {",volume=0"} else {""};
        let length=(segment.end-segment.start)/segment.speed.unwrap_or(1.0).clamp(0.25,4.0);
        filter.push_str(&format!("[{label}_src{idx}_{i}]atrim=start={:.6}:end={:.6},asetpts=PTS-STARTPTS{silence}{tempo},apad,atrim=duration={length:.6}[{label}_cut{idx}_{i}];", segment.start, segment.end));
    }
    for i in 0..segments.len() {
        filter.push_str(&format!("[{label}_cut{idx}_{i}]"));
    }
    filter.push_str(&format!(
        "concat=n={}:v=0:a=1,volume={volume:.3}{normalize}{speed},apad[{label}]",
        segments.len()
    ));
    filter
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CanvasAudioTrack {
    pub path: String,
    pub label: String,
    pub kind: String,
    pub muted: bool,
    pub volume: f64,
    pub linked: Option<bool>,
    pub clips: Option<Vec<CanvasAudioClip>>,
    pub preserve_pitch: Option<bool>,
    pub start: Option<f64>,
    pub source_start: Option<f64>,
    pub source_end: Option<f64>,
    pub fade_in: Option<f64>,
    pub fade_out: Option<f64>,
    pub noise_reduction: Option<bool>,
    pub ducking: Option<f64>,
    #[serde(default)]
    pub volume_keys: Vec<AudioVolumeKey>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all="camelCase")]
pub struct CanvasAudioClip {
    pub source_start: f64,
    pub source_end: f64,
    pub start: f64,
    pub speed: Option<f64>,
    pub volume: Option<f64>,
    pub fade_in: Option<f64>,
    pub fade_out: Option<f64>,
}

fn clip_audio_filter(idx:usize,volume:f64,normalize:&str,speed:&str,label:&str,clips:&[CanvasAudioClip],edits:(f64,bool))->String {
    let (duration,preserve_pitch)=edits;
    if clips.is_empty(){return format!("[{idx}:a]volume=0,atrim=duration={duration:.6},apad[{label}]");}
    let global=speed.trim_start_matches(",atempo=").parse::<f64>().unwrap_or(1.0).clamp(0.5,2.0);
    let mut filter=format!("[{idx}:a]asplit={}",clips.len());
    for i in 0..clips.len(){filter.push_str(&format!("[{label}_split{i}]"));}filter.push(';');
    for (i,clip) in clips.iter().enumerate(){
        let combined=clip.speed.unwrap_or(1.0)*global;
        let mut rate=combined;
        let mut tempo=String::new();
        while rate<0.5{tempo.push_str(",atempo=0.5");rate/=0.5;}
        while rate>2.0{tempo.push_str(",atempo=2.0");rate/=2.0;}
        tempo.push_str(&format!(",atempo={rate:.6}"));
        if !preserve_pitch { tempo=format!(",aresample=48000,asetrate={:.3},aresample=48000",48000.0*combined); }
        let length=clip.source_end-clip.source_start;
        let output_length=length/combined;
        let fade_in=clip.fade_in.unwrap_or(0.0).clamp(0.0,length);
        let fade_out=clip.fade_out.unwrap_or(0.0).clamp(0.0,length);
        let mut fades=String::new();
        if fade_in>0.0{fades.push_str(&format!(",afade=t=in:st=0:d={fade_in:.6}"));}
        if fade_out>0.0{fades.push_str(&format!(",afade=t=out:st={:.6}:d={fade_out:.6}",length-fade_out));}
        filter.push_str(&format!("[{label}_split{i}]atrim=start={:.6}:end={:.6},asetpts=PTS-STARTPTS{fades},volume={:.6}{tempo},apad,atrim=duration={output_length:.6},aresample=48000,adelay={}S:all=1,apad,atrim=duration={duration:.6}[{label}_clip{i}];",clip.source_start,clip.source_end,clip.volume.unwrap_or(1.0).clamp(0.0,2.0),(clip.start/global*48000.0).round() as u64));
    }
    for i in 0..clips.len(){filter.push_str(&format!("[{label}_clip{i}]"));}
    filter.push_str(&format!("amix=inputs={}:normalize=0:duration=longest,volume={volume:.6}{normalize}[{label}]",clips.len()));filter
}

#[derive(Deserialize, Clone)]
pub struct AudioVolumeKey {
    pub time: f64,
    pub volume: f64,
}

struct AudioFilterEdits<'a> {
    track: Option<&'a CanvasAudioTrack>,
    microphone: Option<usize>,
    duration: f64,
}

fn edited_audio_filter(
    idx: usize,
    volume: f64,
    normalize: &str,
    speed: &str,
    label: &str,
    segments: &[SourceSegment],
    edits: AudioFilterEdits<'_>,
) -> String {
    let AudioFilterEdits { track, microphone, duration } = edits;
    let Some(track) = track else {
        return source_audio_filter(idx, volume, normalize, speed, label, segments);
    };
    let finite =
        |v: Option<f64>, fallback: f64| v.filter(|v| v.is_finite()).unwrap_or(fallback).max(0.0);
    let start = finite(track.source_start, 0.0);
    let end = finite(track.source_end, 86400.0).max(start + 0.01);
    let linked = track.linked.unwrap_or(true);
    let mut effects = format!("atrim=start={start:.6}:end={end:.6},asetpts=PTS-STARTPTS");
    if track.noise_reduction.unwrap_or(false) {
        effects.push_str(",afftdn=nf=-25");
    }
    let fade_in = finite(track.fade_in, 0.0).min(end - start);
    let fade_out = finite(track.fade_out, 0.0).min(end - start);
    if fade_in > 0.0 {
        effects.push_str(&format!(",afade=t=in:st=0:d={fade_in:.6}"));
    }
    if fade_out > 0.0 {
        // Source-end is explicit for an exact outgoing fade; otherwise use the
        // source interval covered by this export rather than an arbitrary end.
        let effective_end = if track.source_end.is_some() {
            end - start
        } else if linked {
            segments.iter().map(|s| s.end).fold(duration, f64::max) - start
        } else {
            duration - finite(track.start, 0.0)
        };
        effects.push_str(&format!(
            ",afade=t=out:st={:.6}:d={fade_out:.6}",
            (effective_end - fade_out).max(0.0)
        ));
    }
    let mut keys = track
        .volume_keys
        .iter()
        .filter(|k| k.time.is_finite() && k.volume.is_finite())
        .collect::<Vec<_>>();
    keys.sort_by(|a, b| a.time.total_cmp(&b.time));
    keys.truncate(500);
    if let Some(last) = keys.last() {
        let mut expression = format!("{:.6}", last.volume.clamp(0.0, 2.0));
        for pair in keys.windows(2).rev() {
            let a = pair[0];
            let b = pair[1];
            expression = format!(
                "if(lt(t,{:.6}),{:.6}+({:.6})*(t-{:.6})/{:.6},{expression})",
                b.time.max(0.0),
                a.volume.clamp(0.0, 2.0),
                b.volume.clamp(0.0, 2.0) - a.volume.clamp(0.0, 2.0),
                a.time.max(0.0),
                (b.time - a.time).max(0.001)
            );
        }
        let first = keys[0];
        expression = format!(
            "if(lt(t,{:.6}),{:.6},{expression})",
            first.time.max(0.0),
            first.volume.clamp(0.0, 2.0)
        );
        // source_audio_filter applies the static track volume; normalize the
        // envelope here so keyed volume replaces rather than multiplies it.
        effects.push_str(&format!(",volume='{expression}':eval=frame"));
    }
    let input_label = format!("edit{idx}");
    let mut filter = format!("[{idx}:a]{effects},apad[{input_label}];");
    let raw_label = format!("raw{label}");
    let mut base = if let Some(clips)=&track.clips {
        clip_audio_filter(idx,volume,normalize,speed,&raw_label,clips,(duration,track.preserve_pitch.unwrap_or(true)))
    } else { source_audio_filter(idx,volume,normalize,speed,&raw_label,if linked { segments } else { &[] }) };
    base = base.replace(&format!("[{idx}:a]"), &format!("[{input_label}]"));
    // Linked source ranges use original timestamps, so preserve their offset
    // after trimming. Unlinked audio is positioned in sequence time.
    if (linked || track.clips.is_some()) && start > 0.0 {
        filter = filter.replace(
            &format!(",apad[{input_label}]"),
            &format!(
                ",adelay={}:all=1,apad[{input_label}]",
                (start * 1000.0).round() as u64
            ),
        );
    }
    filter.push_str(&base);
    filter.push(';');
    let duck = finite(track.ducking, 0.0).min(100.0);
    let shifted = format!("shift{label}");
    if linked || track.clips.is_some() {
        filter.push_str(&format!("[{raw_label}]anull[{shifted}];"));
    } else {
        filter.push_str(&format!(
            "[{raw_label}]adelay={}:all=1[{shifted}];",
            (finite(track.start, 0.0) * 1000.0
                / speed
                    .trim_start_matches(",atempo=")
                    .parse::<f64>()
                    .unwrap_or(1.0)
                    .max(0.5))
            .round() as u64
        ));
    }
    if let Some(mic) = microphone.filter(|mic| *mic != idx && duck > 0.0) {
        let reference = format!("duck{idx}");
        filter.push_str(&source_audio_filter(
            mic, 1.0, "", speed, &reference, segments,
        ));
        filter.push(';');
        filter.push_str(&format!("[{shifted}][{reference}]sidechaincompress=threshold=0.02:ratio={:.3}:attack=20:release=300:makeup=1,apad[{label}]",1.0+duck*0.19));
    } else {
        filter.push_str(&format!("[{shifted}]anull[{label}]"));
    }
    filter
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
    if !["mp4", "webm", "gif"].contains(&settings.format.as_str())
        || !(1..=60).contains(&settings.fps)
        || !(2..=7680).contains(&settings.width)
        || !(2..=4320).contains(&settings.height)
        || !request.export_duration_seconds.is_finite()
        || !(0.0..=86400.0).contains(&request.export_duration_seconds)
    {
        return Err("Invalid export dimensions, frame rate or duration".into());
    }
    for track in &request.audio_tracks {
        if let Some(clips)=&track.clips {
            if clips.len()>1000 || clips.iter().any(|clip| !clip.source_start.is_finite()||!clip.source_end.is_finite()||!clip.start.is_finite()||clip.source_start<0.0||clip.source_end<=clip.source_start||clip.source_end>86400.0||!(0.0..=86400.0).contains(&clip.start)||clip.speed.is_some_and(|rate|!rate.is_finite()||!(0.25..=4.0).contains(&rate))||[clip.volume,clip.fade_in,clip.fade_out].iter().flatten().any(|value|!value.is_finite()||*value<0.0)) { return Err("Invalid audio clip".into()); }
        }
        crate::access::require(&app, std::path::Path::new(&track.path))?;
    }
    let playback_rate = request.playback_rate.clamp(0.5, 2.0);
    if request.source_segments.len() > 1000 || !request.playback_rate.is_finite() {
        return Err("Invalid source segments or playback rate".into());
    }
    let mut source_duration = 0.0;
    for segment in &request.source_segments {
        if !segment.start.is_finite()
            || !segment.end.is_finite()
            || segment.start < 0.0
            || segment.end <= segment.start
            || segment.end > 86400.0
        {
            return Err("Invalid source segment range".into());
        }
        let rate=segment.speed.unwrap_or(1.0);
        if !rate.is_finite() || !(0.25..=4.0).contains(&rate) { return Err("Invalid clip speed".into()); }
        source_duration += (segment.end - segment.start) / rate;
    }
    if !request.source_segments.is_empty()
        && (source_duration / playback_rate - request.export_duration_seconds).abs() > 0.05
    {
        return Err("Source segments do not match the export duration".into());
    }
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

    let mut args: Vec<String> = vec!["-y".into()];
    if std::path::Path::new(&request.temp_webm_path)
        .extension()
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("h264") || extension.eq_ignore_ascii_case("mjpeg")
        })
    {
        args.push("-r".into());
        args.push(settings.fps.to_string());
    }
    args.push("-i".into());
    args.push(request.temp_webm_path.clone());

    if settings.format == "gif" {
        // GIF export: no audio track. Downsample fps for reasonable file size.
        args.push("-vf".into());
        args.push("fps=15,scale=iw:-1:flags=lanczos".into());
        args.push("-f".into());
        args.push("gif".into());
        if settings.loop_output {
            args.push("-loop".into());
            args.push("0".into());
        }
    } else {
        let audio_codec = if settings.format == "webm" {
            "libopus"
        } else {
            "aac"
        };
        // The canvas WebM has already been recorded at the selected clip
        // speed. Source WAVs still use original recording time, so retime only
        // those tracks; generated click audio is already placed in output time.
        let mut audio_sources: Vec<(usize, f64, String, bool)> = Vec::new();
        let mut input_index = 1usize;
        let mut track_edits = std::collections::HashMap::new();
        let mut microphone_index = None;
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
                let mut edit = track.clone();
                if edit.source_end.is_none() {
                    if let Ok(output) = background_command("ffprobe")
                        .args([
                            "-v",
                            "error",
                            "-show_entries",
                            "format=duration",
                            "-of",
                            "default=noprint_wrappers=1:nokey=1",
                        ])
                        .arg(&track.path)
                        .output()
                    {
                        edit.source_end = String::from_utf8_lossy(&output.stdout)
                            .trim()
                            .parse::<f64>()
                            .ok()
                            .filter(|d| d.is_finite() && *d > 0.0);
                    }
                }
                track_edits.insert(input_index, edit);
                if track.kind == "microphone" {
                    microphone_index = Some(input_index);
                }
                if request.source_segments.is_empty() && request.trim_start_seconds > 0.0 {
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
                    channel_volume
                        * if track.volume_keys.is_empty() {
                            track.volume.clamp(0.0, 2.0)
                        } else {
                            1.0
                        },
                    track.label.clone(),
                    true,
                ));
                input_index += 1;
            }
        } else {
            if has_sys && !request.audio_mix.system_muted {
                if request.source_segments.is_empty() && request.trim_start_seconds > 0.0 {
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
                if request.source_segments.is_empty() && request.trim_start_seconds > 0.0 {
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
                filter.push_str(&edited_audio_filter(
                    *idx,
                    *volume,
                    normalize,
                    &speed,
                    &format!("a{slot}"),
                    if *retime {
                        &request.source_segments
                    } else {
                        &[]
                    },
                    AudioFilterEdits { track: track_edits.get(idx), microphone: microphone_index, duration: source_duration },
                ));
                filter.push(';');
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
            args.push(audio_codec.into());
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
                filter.push_str(&edited_audio_filter(
                    *idx,
                    *volume,
                    "",
                    &speed,
                    &format!("a{slot}"),
                    if *retime {
                        &request.source_segments
                    } else {
                        &[]
                    },
                    AudioFilterEdits { track: track_edits.get(idx), microphone: microphone_index, duration: source_duration },
                ));
                filter.push(';');
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
            args.push(audio_codec.into());
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
            args.push(edited_audio_filter(
                *idx,
                *volume,
                normalize,
                &speed,
                "a",
                if *retime {
                    &request.source_segments
                } else {
                    &[]
                },
                AudioFilterEdits { track: track_edits.get(idx), microphone: microphone_index, duration: source_duration },
            ));
            args.push("-map".into());
            args.push("0:v".into());
            args.push("-map".into());
            args.push("[a]".into());
            args.push("-c:a".into());
            args.push(audio_codec.into());
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
            args.push(if settings.format == "webm" {
                "webvtt".into()
            } else {
                "mov_text".into()
            });
            args.push("-metadata:s:s:0".into());
            args.push("language=und".into());
        }

        if settings.format == "webm" {
            args.extend_from_slice(&[
                "-c:v".into(),
                "libvpx-vp9".into(),
                "-crf".into(),
                crf.into(),
                "-b:v".into(),
                "0".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
                "-shortest".into(),
            ]);
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
                "-shortest".into(),
            ]);
        }
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
    #[ignore = "Requires FFmpeg on PATH; validates edited audio and ducking"]
    fn edited_audio_filters_render_reordered_linked_and_independent_tracks() {
        let segments = vec![
            SourceSegment {
                start: 2.0,
                end: 3.0,
                ..Default::default()
            },
            SourceSegment {
                start: 0.0,
                end: 1.0,
                ..Default::default()
            },
            SourceSegment {
                start: 2.0,
                end: 3.0,
                ..Default::default()
            },
        ];
        let mut track:CanvasAudioTrack=serde_json::from_value(serde_json::json!({"path":"music.wav","label":"Music","kind":"imported","muted":false,"volume":1,"linked":true,"sourceStart":0.2,"sourceEnd":3.0,"fadeIn":0.1,"fadeOut":0.2,"noiseReduction":true,"ducking":75,"volumeKeys":[{"time":0,"volume":1},{"time":2,"volume":0.5}]})).unwrap();
        for linked in [true, false] {
            track.linked = Some(linked);
            track.start = Some(0.5);
            let a = edited_audio_filter(
                0,
                1.0,
                "",
                ",atempo=1.000000",
                "music",
                &segments,
                AudioFilterEdits { track: Some(&track), microphone: Some(1), duration: 3.0 },
            );
            let b = edited_audio_filter(
                1,
                1.0,
                "",
                ",atempo=1.000000",
                "voice",
                &segments,
                AudioFilterEdits { track: None, microphone: None, duration: 3.0 },
            );
            let filter = format!("{a};{b};[music][voice]amix=inputs=2[a]");
            let args = vec![
                "-v".into(),
                "error".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "sine=frequency=220:sample_rate=48000:duration=3".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "sine=frequency=440:sample_rate=48000:duration=3".into(),
                "-filter_complex".into(),
                filter,
                "-map".into(),
                "[a]".into(),
                "-t".into(),
                "3".into(),
                "-f".into(),
                "null".into(),
                "-".into(),
            ];
            let result = run_ffmpeg(&args).unwrap();
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stderr)
            );
        }
    }

    #[test]
    #[ignore = "Requires FFmpeg on PATH; validates gaps, speed and independent audio clips"]
    fn gaps_speed_and_audio_clip_filters_render() {
        let segments=vec![SourceSegment{start:0.0,end:0.2,gap:true,speed:None},SourceSegment{start:0.0,end:1.0,gap:false,speed:Some(2.0)},SourceSegment{start:0.0,end:0.3,gap:true,speed:None}];
        let linked=source_audio_filter(0,1.0,"","","a",&segments);
        let track:CanvasAudioTrack=serde_json::from_value(serde_json::json!({"path":"audio.wav","label":"Audio","kind":"imported","muted":false,"volume":1,"linked":false,"clips":[{"sourceStart":0.2,"sourceEnd":0.8,"start":0.1,"speed":2,"volume":0.8,"fadeIn":0.1,"fadeOut":0.1},{"sourceStart":1,"sourceEnd":1.5,"start":0.5,"speed":0.5}]})).unwrap();
        for filter in [linked,edited_audio_filter(0,1.0,"","","a",&segments,AudioFilterEdits{track:Some(&track),microphone:None,duration:1.5})] {
            let args=vec!["-v".into(),"error".into(),"-f".into(),"lavfi".into(),"-i".into(),"sine=frequency=440:sample_rate=48000:duration=3".into(),"-filter_complex".into(),filter,"-map".into(),"[a]".into(),"-t".into(),"1.5".into(),"-f".into(),"null".into(),"-".into()];
            let result=run_ffmpeg(&args).unwrap();assert!(result.status.success(),"{}",String::from_utf8_lossy(&result.stderr));
        }

        let filter=source_audio_filter(0,1.0,"","","a",&segments);
        let path=std::env::temp_dir().join(format!("snap_gap_pcm_{}.raw",std::process::id()));
        let args=vec!["-y".into(),"-v".into(),"error".into(),"-f".into(),"lavfi".into(),"-i".into(),"sine=frequency=440:sample_rate=48000:duration=3".into(),"-filter_complex".into(),filter,"-map".into(),"[a]".into(),"-t".into(),"1".into(),"-ac".into(),"1".into(),"-f".into(),"s16le".into(),path.to_string_lossy().into_owned()];
        let result=run_ffmpeg(&args).unwrap();assert!(result.status.success());
        let bytes=std::fs::read(&path).unwrap();let _=std::fs::remove_file(path);
        let samples:Vec<f32>=bytes.chunks_exact(2).map(|bytes|i16::from_le_bytes(bytes.try_into().unwrap()) as f32/32768.0).collect();
        assert_eq!(samples.len(),48000);
        assert!(samples[..9000].iter().all(|sample|sample.abs()<0.00001),"Leading gap contains audio");
        assert!(samples[34560..].iter().all(|sample|sample.abs()<0.00001),"Trailing gap contains audio");
        assert!(samples[14400..28800].iter().any(|sample|sample.abs()>0.05),"Sped-up audio missing");
    }

    #[test]
    #[ignore = "Requires FFmpeg on PATH; run explicitly when validating footage edits"]
    fn footage_audio_removes_deleted_samples_and_preserves_both_retained_ranges() {
        let path =
            std::env::temp_dir().join(format!("snap_footage_audio_{}.wav", std::process::id()));
        let segments = vec![
            SourceSegment {
                start: 0.0,
                end: 1.0,
                ..Default::default()
            },
            SourceSegment {
                start: 2.0,
                end: 3.0,
                ..Default::default()
            },
        ];
        for rate in [0.5, 1.0, 2.0] {
            let filter =
                source_audio_filter(0, 1.0, "", &format!(",atempo={rate:.6}"), "a", &segments);
            let filter = if rate == 1.0 {
                format!("{filter}{}", " ".repeat(9000))
            } else {
                filter
            };
            let args = vec![
                "-y".into(),
                "-v".into(),
                "error".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "aevalsrc=if(lt(t\\,1)\\,0.1\\,if(lt(t\\,2)\\,0.7\\,0.3)):s=48000:d=3".into(),
                "-filter_complex".into(),
                filter,
                "-map".into(),
                "[a]".into(),
                "-t".into(),
                format!("{}", 2.0 / rate),
                "-c:a".into(),
                "pcm_s16le".into(),
                path.to_string_lossy().to_string(),
            ];
            let result = run_ffmpeg(&args).expect("launch FFmpeg");
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stderr)
            );
            let bytes = std::fs::read(&path).expect("read audio");
            let mut offset = 12;
            let mut samples = Vec::new();
            while offset + 8 <= bytes.len() {
                let length =
                    u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
                if &bytes[offset..offset + 4] == b"data" {
                    samples = bytes[offset + 8..offset + 8 + length]
                        .chunks_exact(2)
                        .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]) as f64 / 32768.0)
                        .collect();
                    break;
                }
                offset += 8 + length + length % 2;
            }
            assert!(!samples.is_empty());
            assert!((samples.len() as f64 / 48000.0 - 2.0 / rate).abs() < 0.01);
            assert!((samples[samples.len() / 4] - 0.1).abs() < 0.03);
            assert!((samples[samples.len() * 3 / 4] - 0.3).abs() < 0.03);
            assert!(
                samples.iter().all(|sample| sample.abs() < 0.5),
                "Deleted middle audio leaked into output"
            );
        }
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn delivery_companions_are_exact_siblings_of_the_selected_video() {
        let output = std::path::Path::new(r"D:\Exports\demo.final.mp4");
        let paths = delivery_paths(output);
        assert_eq!(
            paths[0],
            std::path::PathBuf::from(r"D:\Exports\demo.final.transcript.txt")
        );
        assert_eq!(
            paths[1],
            std::path::PathBuf::from(r"D:\Exports\demo.final.chapters.json")
        );
        assert_eq!(
            paths[2],
            std::path::PathBuf::from(r"D:\Exports\demo.final.thumbnail.png")
        );
        assert!(paths.iter().all(|path| path.parent() == output.parent()));
    }

    #[test]
    fn staging_path_accepts_webcodecs_ivf_and_rejects_unscoped_files() {
        let output = std::path::Path::new(r"C:\Videos\Snap\clip.mp4");
        assert!(validated_export_staging_path(
            std::path::Path::new(r"C:\Videos\Snap\clip.snapexport.ivf"),
            output,
        )
        .is_ok());
        assert!(validated_export_staging_path(
            std::path::Path::new(r"C:\Videos\Snap\clip.snapexport.h264"),
            output,
        )
        .is_ok());
        assert!(validated_export_staging_path(
            std::path::Path::new(r"C:\Videos\Snap\clip.snapexport.mjpeg"),
            output,
        )
        .is_ok());
        assert!(validated_export_staging_path(
            std::path::Path::new(r"C:\Videos\Snap\other.snapexport.ivf"),
            output,
        )
        .is_err());
    }

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
