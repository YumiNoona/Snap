use serde::Deserialize;
use std::fs::File;
use std::io::Read;
use std::io::{BufWriter, Write};
use std::process::Stdio;
use std::sync::{Mutex as StdMutex, OnceLock};

use crate::process::background_command;

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
pub async fn export_video(request: ExportRequest) -> std::result::Result<String, String> {
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

    let mut child = background_command("ffmpeg")
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start FFmpeg: {e}"))?;

    let status = child
        .wait()
        .map_err(|e| format!("FFmpeg wait error: {e}"))?;

    let mut stderr = String::new();
    if let Some(mut s) = child.stderr {
        let _ = s.read_to_string(&mut stderr);
    }

    if !status.success() {
        eprintln!("[Snap Export] FFmpeg stderr:\n{stderr}");
        return Err(format!("FFmpeg exited with error: {status}\n{stderr}"));
    }

    let output = request.export_settings.output_path.clone();
    let meta = std::fs::metadata(&output).map_err(|e| format!("Output not found: {e}"))?;

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

static EXPORT_SINK: OnceLock<StdMutex<Option<BufWriter<File>>>> = OnceLock::new();

fn export_sink() -> &'static StdMutex<Option<BufWriter<File>>> {
    EXPORT_SINK.get_or_init(|| StdMutex::new(None))
}

/// Open (create/truncate) the temp file that streamed WebM chunks are
/// written into. Must be called before any `write_export_chunk` calls.
#[tauri::command]
pub fn open_export_sink(path: String) -> std::result::Result<(), String> {
    let file = File::create(&path).map_err(|e| format!("Cannot create export temp file: {e}"))?;
    let mut guard = export_sink().lock().map_err(|e| e.to_string())?;
    *guard = Some(BufWriter::new(file));
    Ok(())
}

/// Append one chunk of the recorded canvas stream to the open sink.
/// Callers must await each call before sending the next chunk — chunks
/// are written in the order they arrive with no reordering.
#[tauri::command]
pub fn write_export_chunk(bytes: Vec<u8>) -> std::result::Result<(), String> {
    let mut guard = export_sink().lock().map_err(|e| e.to_string())?;
    match guard.as_mut() {
        Some(w) => w
            .write_all(&bytes)
            .map_err(|e| format!("Export write failed: {e}")),
        None => Err("Export sink not open".to_string()),
    }
}

/// Flush and close the sink once recording has finished.
#[tauri::command]
pub fn close_export_sink() -> std::result::Result<(), String> {
    let mut guard = export_sink().lock().map_err(|e| e.to_string())?;
    if let Some(mut w) = guard.take() {
        w.flush().map_err(|e| format!("Export flush failed: {e}"))?;
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
    #[serde(rename = "trimStartSeconds", default)]
    pub trim_start_seconds: f64,
    #[serde(rename = "exportDurationSeconds", default)]
    pub export_duration_seconds: f64,
    #[serde(rename = "captionSrt", default)]
    pub caption_srt: Option<String>,
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

fn write_click_track(
    path: &std::path::Path,
    click_times_ms: &[f64],
    duration_seconds: f64,
) -> std::result::Result<(), String> {
    const RATE: u32 = 44_100;
    let end_ms = (duration_seconds * 1000.0)
        .max(click_times_ms.iter().copied().fold(0.0_f64, f64::max) + 180.0);
    let samples = ((end_ms / 1000.0) * RATE as f64).ceil() as usize;
    let mut pcm = vec![0i16; samples.max(1)];
    for (click_index, click_ms) in click_times_ms.iter().enumerate() {
        let start = ((*click_ms / 1000.0) * RATE as f64).round() as usize;
        let click_len = (RATE as f64 * 0.095) as usize;
        for i in 0..click_len {
            let dst = start + i;
            if dst >= pcm.len() {
                break;
            }
            let t = i as f64 / RATE as f64;
            let envelope = (-48.0 * t).exp();
            let tone = (std::f64::consts::TAU * (1050.0 - 4200.0 * t) * t).sin();
            let noise_seed = ((i as u64 * 1_103_515_245 + click_index as u64 * 12_345) & 0xffff)
                as f64
                / 32768.0
                - 1.0;
            let value = ((tone * 0.8 + noise_seed * 0.2) * envelope * 7000.0) as i32;
            pcm[dst] = (pcm[dst] as i32 + value).clamp(i16::MIN as i32, i16::MAX as i32) as i16;
        }
    }
    let data_size = (pcm.len() * 2) as u32;
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
    for sample in pcm {
        out.write_all(&sample.to_le_bytes())
            .map_err(|e| e.to_string())?;
    }
    out.flush().map_err(|e| e.to_string())
}

/// Mux the recorded-canvas WebM (already has every visual baked in —
/// cursor, background, pan/zoom, styling) with the original system/mic
/// audio and transcode to the user's chosen output format.
#[tauri::command]
pub async fn finalize_canvas_export(
    request: CanvasExportRequest,
) -> std::result::Result<String, String> {
    let settings = &request.export_settings;

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
    }
    let has_clicks = !request.click_times_ms.is_empty();
    if has_clicks {
        write_click_track(
            &click_wav,
            &request.click_times_ms,
            request.export_duration_seconds,
        )?;
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
        let mut audio_sources: Vec<(usize, f64, &str)> = Vec::new();
        let mut input_index = 1usize;
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
                "Desktop audio",
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
                "Microphone",
            ));
            input_index += 1;
        }
        if has_clicks {
            args.push("-i".into());
            args.push(click_wav.to_string_lossy().to_string());
            audio_sources.push((input_index, 1.0, "Click effects"));
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
            for (slot, (idx, volume, _)) in audio_sources.iter().enumerate() {
                let normalize = if settings.normalize_audio {
                    ",loudnorm=I=-16:LRA=11:TP=-1.5"
                } else {
                    ""
                };
                filter.push_str(&format!(
                    "[{idx}:a]volume={volume:.3}{normalize},apad[a{slot}];"
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
            for (slot, (_, _, label)) in audio_sources.iter().enumerate() {
                args.push(format!("-metadata:s:a:{slot}"));
                args.push(format!("title={label}"));
            }
        } else if audio_sources.len() > 1 {
            let mut filter = String::new();
            for (slot, (idx, volume, _)) in audio_sources.iter().enumerate() {
                filter.push_str(&format!("[{idx}:a]volume={volume:.3}[a{slot}];"));
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
        } else if let Some((idx, volume, _)) = audio_sources.first() {
            args.push("-filter_complex".into());
            let normalize = if settings.normalize_audio {
                ",loudnorm=I=-16:LRA=11:TP=-1.5"
            } else {
                ""
            };
            args.push(format!("[{idx}:a]volume={volume:.3}{normalize},apad[a]"));
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

    args.push(settings.output_path.clone());

    eprintln!(
        "[Snap Export] Finalize FFmpeg command: ffmpeg {}",
        args.join(" ")
    );

    let mut child = background_command("ffmpeg")
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start FFmpeg: {e}"))?;

    let status = child
        .wait()
        .map_err(|e| format!("FFmpeg wait error: {e}"))?;

    let mut stderr = String::new();
    if let Some(mut s) = child.stderr {
        let _ = s.read_to_string(&mut stderr);
    }

    if !status.success() {
        eprintln!("[Snap Export] FFmpeg stderr:\n{stderr}");
        return Err(format!("FFmpeg exited with error: {status}\n{stderr}"));
    }

    // Clean up the intermediate WebM now that the final file is encoded.
    let _ = std::fs::remove_file(&request.temp_webm_path);
    if has_clicks {
        let _ = std::fs::remove_file(&click_wav);
    }
    if has_embedded_captions {
        let _ = std::fs::remove_file(&caption_srt);
    }

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
}
