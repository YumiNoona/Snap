//! Bounded, cached measurements followed by ASR for shortlisted moments only.
use crate::{
    access,
    auto_clips::{self, check, progress, root, run, Job, Progress, Rect},
    process, transcription,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::Manager;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub has_audio: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub path: String,
    pub audio_path: Option<String>,
    pub range_start: Option<f64>,
    pub range_end: Option<f64>,
    #[serde(default)]
    pub detailed: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub range_start: f64,
    pub range_end: f64,
    pub energy: Vec<f64>,
    pub motion: Vec<f64>,
    pub transcript: Value,
    pub facecam: Option<Rect>,
    pub warnings: Vec<String>,
}

pub(crate) fn probe(path: &Path) -> Result<SourceInfo, String> {
    let bytes=run(process::background_command("ffprobe").args(["-v","error","-show_entries","format=duration:stream=codec_type,width,height,duration:stream_tags=rotate:stream_side_data=rotation","-of","json"]).arg(path),Duration::from_secs(25),1024*1024)?;
    let value: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let streams = value["streams"]
        .as_array()
        .ok_or("No media streams found")?;
    let video = streams
        .iter()
        .find(|s| s["codec_type"] == "video")
        .ok_or("This file contains no video")?;
    let duration = value["format"]["duration"]
        .as_str()
        .or_else(|| video["duration"].as_str())
        .and_then(|v| v.parse::<f64>().ok())
        .filter(|v| v.is_finite() && *v > 0.0 && *v <= 14400.0)
        .ok_or("Choose a video up to four hours long with a valid duration")?;
    let (width, height) = auto_clips::oriented_dimensions(video);
    if width == 0 || height == 0 {
        return Err("Video dimensions are unavailable".into());
    }
    Ok(SourceInfo {
        duration,
        width,
        height,
        has_audio: streams.iter().any(|s| s["codec_type"] == "audio"),
    })
}
fn fingerprint(path: &Path) -> Result<String, String> {
    let m = fs::metadata(path).map_err(|e| e.to_string())?;
    Ok(format!("{}:{}:{:?}", path.display(), m.len(), m.modified()))
}
fn cache_dir(app: &tauri::AppHandle, key: &str) -> Result<PathBuf, String> {
    let dir = root(app)?
        .join("cache-v2")
        .join(format!("{:x}", Sha256::digest(key.as_bytes())));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}
pub(crate) fn bounds(
    duration: f64,
    start: Option<f64>,
    end: Option<f64>,
) -> Result<(f64, f64), String> {
    let start = start.unwrap_or(0.0);
    let end = end.unwrap_or(duration);
    if !start.is_finite()
        || !end.is_finite()
        || start < 0.0
        || end > duration + 0.05
        || end <= start
    {
        return Err("Select a valid analysis range inside the video".into());
    }
    Ok((start, end.min(duration)))
}
#[tauri::command]
pub async fn inspect_auto_clips_source(
    window: tauri::WebviewWindow,
    path: String,
) -> Result<SourceInfo, String> {
    let job = Job::begin(&window)?;
    access::require(window.app_handle(), Path::new(&path))?;
    tauri::async_runtime::spawn_blocking(move || {
        let _job = job;
        probe(Path::new(&path))
    })
    .await
    .map_err(|e| e.to_string())?
}
pub(crate) fn measurements(
    path: &Path,
    audio: &Path,
    info: &SourceInfo,
    start: f64,
    end: f64,
    detailed: bool,
    updates: &tauri::ipc::Channel<Progress>,
) -> Result<Analysis, String> {
    let length = end - start;
    let mut warnings = vec![];
    progress(updates, "Scanning audio activity", 12);
    let raw = run(
        process::background_command("ffmpeg")
            .args(["-v", "error", "-nostdin", "-threads", "2", "-ss"])
            .arg(start.to_string())
            .arg("-i")
            .arg(audio)
            .arg("-t")
            .arg(length.to_string())
            .args(["-vn", "-ar", "16000", "-ac", "1", "-f", "s16le", "pipe:1"]),
        Duration::from_secs(600),
        (length.ceil() as usize + 2) * 32000,
    );
    let energy = match raw {
        Ok(raw) => auto_clips::energy_bins(&raw),
        Err(_) => {
            check()?;
            warnings.push(
                "No usable audio stream was found. Suggestions will use screen activity.".into(),
            );
            vec![]
        }
    };
    progress(
        updates,
        if detailed {
            "Scanning video frames"
        } else {
            "Scanning video keyframes"
        },
        40,
    );
    let mut cmd = process::background_command("ffmpeg");
    cmd.args(["-v", "error", "-nostdin", "-threads", "2", "-ss"])
        .arg(start.to_string());
    if !detailed {
        cmd.args(["-skip_frame", "nokey"]);
    }
    let raw = run(
        cmd.arg("-i")
            .arg(path)
            .arg("-t")
            .arg(length.to_string())
            .args([
                "-an",
                "-vf",
                "fps=1:start_time=0,scale=160:90:flags=fast_bilinear,format=gray",
                "-filter_threads",
                "1",
                "-threads",
                "2",
                "-f",
                "rawvideo",
                "pipe:1",
            ]),
        Duration::from_secs(1200),
        (length.ceil() as usize + 2) * 160 * 90,
    )?;
    let motion = auto_clips::motion_bins(&raw);
    drop(raw);
    progress(updates, "Suggesting a camera region", 78);
    let facecam = match auto_clips::detect_facecam(path, length, start, info.width, info.height) {
        Ok(r) => r,
        Err(_) => {
            check()?;
            warnings.push(
                "Draw the camera region manually if automatic framing is unavailable.".into(),
            );
            None
        }
    };
    check()?;
    progress(updates, "Activity scan complete", 100);
    Ok(Analysis {
        duration: info.duration,
        width: info.width,
        height: info.height,
        range_start: start,
        range_end: end,
        energy,
        motion,
        transcript: json!([]),
        facecam,
        warnings,
    })
}
#[tauri::command]
pub async fn analyze_auto_clips(
    window: tauri::WebviewWindow,
    request: Request,
    updates: tauri::ipc::Channel<Progress>,
) -> Result<Analysis, String> {
    let job = Job::begin(&window)?;
    access::require(window.app_handle(), Path::new(&request.path))?;
    if let Some(audio) = &request.audio_path {
        access::require(window.app_handle(), Path::new(audio))?;
    }
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _job = job;
        let path = Path::new(&request.path);
        let audio = Path::new(request.audio_path.as_deref().unwrap_or(&request.path));
        let info = probe(path)?;
        let (start, end) = bounds(info.duration, request.range_start, request.range_end)?;
        let cache = cache_dir(
            &app,
            &format!(
                "measure-v2:{}:{}:{start}:{end}:{}",
                fingerprint(path)?,
                fingerprint(audio)?,
                request.detailed
            ),
        )?
        .join("analysis.json");
        if let Ok(data) = fs::read(&cache) {
            if let Ok(result) = serde_json::from_slice(&data) {
                progress(&updates, "Using cached activity scan", 100);
                return Ok(result);
            }
        }
        let result = measurements(path, audio, &info, start, end, request.detailed, &updates)?;
        fs::write(
            &cache,
            serde_json::to_vec(&result).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[derive(Clone, Deserialize)]
pub struct Range {
    pub start: f64,
    pub end: f64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechRequest {
    pub path: String,
    pub audio_path: Option<String>,
    pub language: String,
    pub ranges: Vec<Range>,
}
struct Temporary(PathBuf);
impl Drop for Temporary {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
fn fast_model() -> Option<PathBuf> {
    ["base", "tiny", "small", "large-v3-turbo", "medium"]
        .into_iter()
        .find_map(transcription::resolve_model)
}
pub(crate) fn speech_ranges(mut ranges: Vec<Range>, duration: f64) -> Result<Vec<Range>, String> {
    if ranges.len() > 10 || ranges.is_empty() {
        return Err("Select one to ten clip ranges for captions".into());
    }
    for r in &mut ranges {
        let (start, end) = bounds(duration, Some(r.start), Some(r.end))?;
        r.start = (start - 0.6).max(0.0);
        r.end = (end + 0.6).min(duration);
    }
    ranges.sort_by(|a, b| a.start.total_cmp(&b.start));
    let mut result: Vec<Range> = vec![];
    for r in ranges {
        if let Some(last) = result.last_mut() {
            if r.start <= last.end + 0.1 {
                last.end = last.end.max(r.end);
                continue;
            }
        }
        result.push(r);
    }
    if result.iter().map(|r| r.end - r.start).sum::<f64>() > 600.0 {
        return Err("Caption up to ten minutes of shortlisted clips at a time".into());
    }
    Ok(result)
}
#[tauri::command]
pub async fn transcribe_auto_clip_ranges(
    window: tauri::WebviewWindow,
    request: SpeechRequest,
    updates: tauri::ipc::Channel<Progress>,
) -> Result<Value, String> {
    let job = Job::begin(&window)?;
    access::require(window.app_handle(), Path::new(&request.path))?;
    if let Some(a) = &request.audio_path {
        access::require(window.app_handle(), Path::new(a))?;
    }
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _job = job;
        let info = probe(Path::new(&request.path))?;
        let ranges = speech_ranges(request.ranges, info.duration)?;
        let audio = Path::new(request.audio_path.as_deref().unwrap_or(&request.path));
        let model = fast_model().ok_or("Install Auto CC to create clip captions")?;
        let exe =
            transcription::resolve_executable().ok_or("Install Auto CC to create clip captions")?;
        let language = match request.language.as_str() {
            "en" | "hi" | "es" | "fr" | "de" | "pt" | "ja" | "zh" | "ko" => {
                request.language.as_str()
            }
            _ => "auto",
        };
        let mut result: Vec<Value> = vec![];
        let mut pending = vec![];
        let mut temporaries = vec![];
        for r in &ranges {
            check()?;
            let key = format!(
                "speech-v3:{}:{}:{language}:{}:{}",
                fingerprint(audio)?,
                fingerprint(&model)?,
                r.start,
                r.end
            );
            let dir = cache_dir(&app, &key)?;
            let cache = dir.join("segments.json");
            if let Ok(data) = fs::read(&cache) {
                if let Ok(segments) = serde_json::from_slice::<Vec<Value>>(&data) {
                    result.extend(segments);
                    continue;
                }
            }
            progress(&updates, "Preparing only the shortlisted speech", 10);
            let wav = dir.join("clip.wav");
            temporaries.push(Temporary(wav.clone()));
            run(
                process::background_command("ffmpeg")
                    .args(["-y", "-v", "error", "-nostdin", "-ss"])
                    .arg(r.start.to_string())
                    .arg("-i")
                    .arg(audio)
                    .arg("-t")
                    .arg((r.end - r.start).to_string())
                    .args(["-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"])
                    .arg(&wav),
                Duration::from_secs(60),
                1024,
            )?;
            let activity = transcription::pcm16_mono_activity(&wav)?;
            if activity.is_empty() {
                fs::write(&cache, b"[]").map_err(|e| e.to_string())?;
                continue;
            }
            pending.push((r.clone(), wav, cache, activity));
        }
        if !pending.is_empty() {
            let seconds = pending
                .iter()
                .map(|(r, _, _, _)| r.end - r.start)
                .sum::<f64>();
            progress(
                &updates,
                &format!("Captioning {:.0}s of shortlisted footage locally", seconds),
                35,
            );
            let mut command = process::background_command(exe);
            command.arg("-m").arg(model).args([
                "-l", language, "-ojf", "-sow", "-ml", "24", "-sns", "-bo", "1", "-bs", "1", "-t",
                "6",
            ]);
            for (_, wav, _, _) in &pending {
                command.arg("-f").arg(wav);
            }
            run(&mut command, Duration::from_secs(1800), 2 * 1024 * 1024)?;
            for (r, wav, cache, activity) in pending {
                let json_path = PathBuf::from(format!("{}.json", wav.display()));
                let parsed = transcription::parse_output(
                    &json_path,
                    audio.to_string_lossy().into(),
                    language.into(),
                    &activity,
                )?;
                let mut segments = serde_json::to_value(parsed).map_err(|e| e.to_string())?
                    ["segments"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default();
                for s in &mut segments {
                    shift_segment(s, (r.start * 1000.0).round() as u64);
                }
                fs::write(
                    cache,
                    serde_json::to_vec(&segments).map_err(|e| e.to_string())?,
                )
                .map_err(|e| e.to_string())?;
                result.extend(segments);
                let _ = fs::remove_file(json_path);
            }
        }
        result.sort_by_key(|s| s["startMs"].as_u64().unwrap_or(0));
        progress(&updates, "Clip captions ready", 100);
        Ok(json!(result))
    })
    .await
    .map_err(|e| e.to_string())?
}
fn shift_segment(s: &mut Value, offset: u64) {
    for key in ["startMs", "endMs"] {
        if let Some(n) = s[key].as_u64() {
            s[key] = json!(n + offset);
        }
    }
    if let Some(words) = s["words"].as_array_mut() {
        for w in words {
            for key in ["startMs", "endMs"] {
                if let Some(n) = w[key].as_u64() {
                    w[key] = json!(n + offset);
                }
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "requires generated media and local FFmpeg"]
    fn bounded_scan_smoke() {
        let media = std::env::var("SNAP_CLIP_BENCH_MEDIA").expect("fixture path");
        let path = Path::new(&media);
        let info = probe(path).unwrap();
        for detailed in [false, true] {
            let clock = std::time::Instant::now();
            let result = measurements(
                path,
                path,
                &info,
                5.0,
                25.0,
                detailed,
                &tauri::ipc::Channel::new(|_| Ok(())),
            )
            .unwrap();
            assert_eq!(result.range_start, 5.0);
            assert_eq!(result.range_end, 25.0);
            assert!(result.energy.len() >= 19 && result.energy.len() <= 21);
            assert!(result.motion.len() >= 18 && result.motion.len() <= 21);
            assert_eq!(result.transcript, json!([]));
            println!(
                "detailed={detailed}: {:.3}s for selected 20s",
                clock.elapsed().as_secs_f64()
            );
        }
    }
    #[test]
    #[ignore = "requires installed Whisper engine, base model and speech sample"]
    fn batched_whisper_smoke() {
        let engine = std::env::var("SNAP_CLIP_SMOKE_ENGINE").unwrap();
        let model = std::env::var("SNAP_CLIP_SMOKE_MODEL").unwrap();
        let wav = std::env::var("SNAP_CLIP_SMOKE_WAV").unwrap();
        let dir = std::env::temp_dir().join(format!("snap-clip-batch-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let a = dir.join("a.wav");
        let b = dir.join("b.wav");
        fs::copy(&wav, &a).unwrap();
        fs::copy(&wav, &b).unwrap();
        let clock = std::time::Instant::now();
        run(
            process::background_command(engine)
                .arg("-m")
                .arg(model)
                .args([
                    "-l", "en", "-ojf", "-sow", "-ml", "24", "-sns", "-bo", "1", "-bs", "1", "-t",
                    "6", "-f",
                ])
                .arg(&a)
                .arg("-f")
                .arg(&b),
            Duration::from_secs(120),
            1024 * 1024,
        )
        .unwrap();
        for path in [&a, &b] {
            let json = PathBuf::from(format!("{}.json", path.display()));
            let activity = transcription::pcm16_mono_activity(path).unwrap();
            let parsed =
                transcription::parse_output(&json, "test.wav".into(), "en".into(), &activity)
                    .unwrap();
            assert!(!parsed.segments.is_empty());
            assert!(parsed.segments.iter().any(|s| !s.words.is_empty()));
            let _ = fs::remove_file(json);
            let _ = fs::remove_file(path);
        }
        fs::remove_dir(&dir).unwrap();
        println!(
            "One model load, two speech files: {:.3}s",
            clock.elapsed().as_secs_f64()
        );
    }
    #[test]
    fn validates_trim_inside_source() {
        assert!(bounds(600.0, Some(300.0), Some(240.0)).is_err());
        assert_eq!(
            bounds(2400.0, Some(600.0), Some(1200.0)).unwrap(),
            (600.0, 1200.0)
        );
    }
    #[test]
    fn merges_overlapping_speech_windows() {
        let r = speech_ranges(
            vec![
                Range {
                    start: 10.0,
                    end: 20.0,
                },
                Range {
                    start: 18.0,
                    end: 30.0,
                },
            ],
            100.0,
        )
        .unwrap();
        assert_eq!(r.len(), 1);
        assert!((r[0].start - 9.4).abs() < 0.001);
    }
    #[test]
    fn keeps_absolute_word_timing() {
        let mut s = json!({"startMs":100,"endMs":500,"words":[{"startMs":100,"endMs":400}]});
        shift_segment(&mut s, 600000);
        assert_eq!(s["words"][0]["startMs"], 600100);
    }
}
