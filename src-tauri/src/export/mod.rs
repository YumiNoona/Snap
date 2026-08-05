use std::process::{Command, Stdio};
use std::io::Read;
use serde::Deserialize;

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
}

#[derive(Deserialize)]
pub struct ExportRequest {
    #[serde(rename = "inputVideo")]
    pub input_video: String,
    pub config: ExportConfig,
    #[serde(rename = "exportSettings")]
    pub export_settings: ExportSettings,
}

#[tauri::command]
pub async fn export_video(request: ExportRequest) -> std::result::Result<String, String> {
    eprintln!("[Snap Export] Starting export...");
    eprintln!("[Snap Export] Input: {}", request.input_video);
    eprintln!("[Snap Export] Output: {}", request.export_settings.output_path);

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

    let mut args: Vec<String> = vec![
        "-y".into(),
        "-i".into(), request.input_video.clone(),
    ];

    // Detect sidecar audio files
    let input_path = std::path::Path::new(&request.input_video);
    let stem = input_path.file_stem().unwrap_or_default().to_string_lossy();
    let parent = input_path.parent().unwrap_or_else(|| std::path::Path::new("."));
    let audio_dir = parent.join(stem.as_ref());

    let sys_wav = audio_dir.join("system_audio.wav");
    let mic_wav = audio_dir.join("mic_audio.wav");
    let has_sys = sys_wav.exists() && std::fs::metadata(&sys_wav).map(|m| m.len() > 0).unwrap_or(false);
    let has_mic = mic_wav.exists() && std::fs::metadata(&mic_wav).map(|m| m.len() > 0).unwrap_or(false);

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
            args.push(format!("[0:v]{vf}[v];[1:a][2:a]amix=inputs=2:duration=first[a]"));
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
            "-c:v".into(), "libx264".into(),
            "-preset".into(), "medium".into(),
            "-crf".into(), crf.into(),
            "-pix_fmt".into(), "yuv420p".into(),
        ]);
    }

    args.push(settings.output_path.clone());

    eprintln!("[Snap Export] FFmpeg command: ffmpeg {}", args.join(" "));

    let mut child = Command::new("ffmpeg")
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

    Ok(format!("Exported: {} ({:.1} MB)", output, meta.len() as f64 / 1_048_576.0))
}

/// Build a zoompan FFmpeg filter expression from keyframes.
/// Uses a basic approach: at each keyframe time, set zoom position/scale,
/// with linear interpolation between.
fn build_zoompan_expr(keyframes: &[ExportKeyframe], fps: u32, w: u32, h: u32) -> String {
    if keyframes.is_empty() {
        return format!("zoompan=z=1:x=0:y=0:d=1:s={}x{}", w, h);
    }

    // Sort keyframes by time
    let mut kfs = keyframes.to_vec();
    kfs.sort_by(|a, b| a.time.partial_cmp(&b.time).unwrap());

    // Build piecewise zoom expression
    // For simplicity, use a single zoompan with the last keyframe's settings
    // A proper implementation would use keyframed zoompan, but FFmpeg's zoompan
    // is complex. This version applies the largest zoom for the whole video
    // as a proof of concept.

    let max_scale = kfs.iter().map(|k| k.scale).fold(1.0f64, f64::max);
    let last_kf = &kfs[kfs.len() - 1];
    let mid_kf = &kfs[kfs.len() / 2];

    format!(
        "zoompan=z='if(gte(in,{}),{:.3},if(gte(in,{}),{:.3},1))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={}x{},fps={}",
        (mid_kf.time / 1000.0 * fps as f64) as u32,
        max_scale,
        (last_kf.time / 1000.0 * fps as f64) as u32,
        max_scale,
        w, h, fps
    )
}
