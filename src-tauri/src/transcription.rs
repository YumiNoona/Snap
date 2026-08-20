use crate::process::background_command;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tauri::Emitter;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionEnvironment {
    available: bool,
    executable_path: Option<String>,
    model_path: Option<String>,
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionRequest {
    pub audio_path: String,
    pub language: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionSegment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionResult {
    pub language: String,
    pub source_path: String,
    pub segments: Vec<TranscriptionSegment>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallProgress {
    percent: u8,
    phase: String,
    downloaded_bytes: Option<u64>,
    total_bytes: Option<u64>,
}

fn emit_install_progress(
    window: &tauri::Window,
    percent: u8,
    phase: &str,
    downloaded: Option<u64>,
    total: Option<u64>,
) {
    let _ = window.emit(
        "transcription-install-progress",
        InstallProgress {
            percent,
            phase: phase.to_string(),
            downloaded_bytes: downloaded,
            total_bytes: total,
        },
    );
}

fn run_installer_step(
    window: &tauri::Window,
    script: &str,
    path: &Path,
    start: u8,
    end: u8,
    total: Option<u64>,
    phase: &str,
) -> Result<(), String> {
    let mut child = background_command("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Unable to start dependency installer: {error}"))?;
    loop {
        match child
            .try_wait()
            .map_err(|error| format!("Unable to monitor dependency installer: {error}"))?
        {
            Some(status) => {
                let output = child
                    .wait_with_output()
                    .map_err(|error| format!("Unable to finish dependency installer: {error}"))?;
                if !status.success() {
                    return Err(format!(
                        "Transcription installation failed: {}",
                        String::from_utf8_lossy(&output.stderr)
                    ));
                }
                emit_install_progress(window, end, phase, total, total);
                return Ok(());
            }
            None => {
                let downloaded = std::fs::metadata(path)
                    .map(|value| value.len())
                    .unwrap_or(0);
                let percent = total
                    .map(|bytes| {
                        start.saturating_add(
                            ((downloaded.min(bytes) as f64 / bytes as f64) * (end - start) as f64)
                                .round() as u8,
                        )
                    })
                    .unwrap_or(start);
                emit_install_progress(
                    window,
                    percent.min(end.saturating_sub(1)),
                    phase,
                    Some(downloaded),
                    total,
                );
                std::thread::sleep(Duration::from_millis(250));
            }
        }
    }
}

fn existing_candidate(candidates: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find(|path| path.is_file())
}

fn bundled_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources")
}

fn user_transcription_root() -> PathBuf {
    std::env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("Snap")
        .join("transcription")
}

fn resolve_executable() -> Option<PathBuf> {
    let root = bundled_root();
    let user = user_transcription_root();
    existing_candidate([
        user.join("whisper-cli.exe"),
        root.join("transcription").join("whisper-cli.exe"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tools")
            .join("whisper-cli.exe"),
    ])
}

fn resolve_model() -> Option<PathBuf> {
    let root = bundled_root().join("transcription").join("models");
    let user = user_transcription_root().join("models");
    existing_candidate([
        user.join("ggml-base.bin"),
        root.join("ggml-small.bin"),
        root.join("ggml-base.bin"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("models")
            .join("ggml-small.bin"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("models")
            .join("ggml-base.bin"),
    ])
}

#[tauri::command]
pub async fn install_transcription_dependencies(
    window: tauri::Window,
) -> Result<TranscriptionEnvironment, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = user_transcription_root();
        let models = root.join("models");
        std::fs::create_dir_all(&models).map_err(|error| format!("Unable to create transcription folder: {error}"))?;
        let root_text = root.to_string_lossy().replace('\'', "''");
        let zip = root.join("whisper.zip");
        let engine_script = format!(r#"$ErrorActionPreference='Stop'; $root='{root_text}'; $zip=Join-Path $root 'whisper.zip'; $unpack=Join-Path $root 'unpack'; Invoke-WebRequest -UseBasicParsing 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-bin-x64.zip' -OutFile $zip; if(Test-Path $unpack){{Remove-Item -LiteralPath $unpack -Recurse -Force}}; Expand-Archive -LiteralPath $zip -DestinationPath $unpack -Force; Get-ChildItem -LiteralPath $unpack -Recurse -File | Copy-Item -Destination $root -Force; Remove-Item -LiteralPath $unpack -Recurse -Force"#);
        emit_install_progress(&window, 2, "Downloading caption engine", None, None);
        run_installer_step(&window, &engine_script, &zip, 2, 20, None, "Installing caption engine")?;
        let model = models.join("ggml-base.bin");
        let model_script = format!(r#"$ErrorActionPreference='Stop'; $model='{model}'; Invoke-WebRequest -UseBasicParsing 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin?download=true' -OutFile $model; $hash=(Get-FileHash -LiteralPath $model -Algorithm SHA1).Hash.ToLowerInvariant(); if($hash -ne '465707469ff3a37a2b9b8d8f89f2f99de7299dac'){{Remove-Item -LiteralPath $model -Force; throw 'Whisper model checksum verification failed'}}"#, model = model.to_string_lossy().replace('\'', "''"));
        run_installer_step(&window, &model_script, &model, 20, 99, Some(147_951_465), "Downloading multilingual model")?;
        let _ = std::fs::remove_file(&zip);
        let environment = transcription_environment();
        if !environment.available { return Err("Downloaded transcription files could not be activated".to_string()); }
        emit_install_progress(&window, 100, "Offline captions ready", None, None);
        Ok(environment)
    }).await.map_err(|error| format!("Transcription installer failed: {error}"))?
}

#[tauri::command]
pub fn transcription_environment() -> TranscriptionEnvironment {
    let executable = resolve_executable();
    let model = resolve_model();
    let available = executable.is_some() && model.is_some();
    TranscriptionEnvironment {
        available,
        executable_path: executable
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        model_path: model
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        message: if available {
            "Offline transcription is ready".to_string()
        } else {
            "Snap needs whisper-cli.exe and a multilingual ggml model in resources/transcription"
                .to_string()
        },
    }
}

fn parse_timestamp(value: &serde_json::Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_f64().map(|number| number.max(0.0) as u64))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct AudioActivityRange {
    start_ms: u64,
    end_ms: u64,
}

fn pcm16_mono_activity(path: &Path) -> Result<Vec<AudioActivityRange>, String> {
    let bytes = std::fs::read(path)
        .map_err(|error| format!("Unable to inspect transcription audio: {error}"))?;
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("Prepared transcription audio is not a valid WAV file".to_string());
    }
    let mut cursor = 12usize;
    let mut sample_rate = 16_000u32;
    let mut channels = 1u16;
    let mut bits_per_sample = 16u16;
    let mut data = None;
    while cursor + 8 <= bytes.len() {
        let id = &bytes[cursor..cursor + 4];
        let size = u32::from_le_bytes(bytes[cursor + 4..cursor + 8].try_into().unwrap()) as usize;
        let start = cursor + 8;
        let end = start.saturating_add(size).min(bytes.len());
        if id == b"fmt " && end >= start + 16 {
            channels = u16::from_le_bytes(bytes[start + 2..start + 4].try_into().unwrap());
            sample_rate = u32::from_le_bytes(bytes[start + 4..start + 8].try_into().unwrap());
            bits_per_sample = u16::from_le_bytes(bytes[start + 14..start + 16].try_into().unwrap());
        } else if id == b"data" {
            data = Some(&bytes[start..end]);
            break;
        }
        cursor = start.saturating_add(size).saturating_add(size % 2);
    }
    if channels != 1 || bits_per_sample != 16 || sample_rate == 0 {
        return Err("Transcription analysis expects 16-bit mono PCM audio".to_string());
    }
    let data = data.ok_or_else(|| "Prepared transcription WAV has no audio data".to_string())?;
    let samples = data
        .chunks_exact(2)
        .map(|sample| i16::from_le_bytes([sample[0], sample[1]]) as f64 / 32768.0)
        .collect::<Vec<_>>();
    if samples.is_empty() {
        return Ok(Vec::new());
    }

    let window_samples = (sample_rate as usize / 50).max(1); // 20 ms
    let mut levels = Vec::with_capacity(samples.len().div_ceil(window_samples));
    let mut peaks = Vec::with_capacity(levels.capacity());
    for window in samples.chunks(window_samples) {
        let sum_squares = window.iter().map(|sample| sample * sample).sum::<f64>();
        levels.push((sum_squares / window.len().max(1) as f64).sqrt());
        peaks.push(window.iter().map(|sample| sample.abs()).fold(0.0, f64::max));
    }
    let mut sorted = levels.clone();
    sorted.sort_by(f64::total_cmp);
    let noise_floor = sorted[sorted.len() / 5];
    // Absolute floor rejects digital silence; the adaptive component rejects
    // steady fan/static noise without making continuous speech impossible.
    let threshold = (noise_floor * 3.2).clamp(0.0032, 0.015);
    let mut active = levels
        .iter()
        .zip(peaks.iter())
        .map(|(rms, peak)| *rms >= threshold || (*peak >= 0.02 && *rms >= 0.0025))
        .collect::<Vec<_>>();

    // Bridge natural gaps inside words/sentences, but not long silent spans.
    let max_gap_windows = 15usize; // 300 ms
    let mut index = 0usize;
    while index < active.len() {
        if active[index] {
            index += 1;
            continue;
        }
        let gap_start = index;
        while index < active.len() && !active[index] {
            index += 1;
        }
        if gap_start > 0 && index < active.len() && index - gap_start <= max_gap_windows {
            active[gap_start..index].fill(true);
        }
    }

    let mut ranges: Vec<AudioActivityRange> = Vec::new();
    let mut start = 0usize;
    while start < active.len() {
        if !active[start] {
            start += 1;
            continue;
        }
        let mut end = start + 1;
        while end < active.len() && active[end] {
            end += 1;
        }
        if end - start >= 6 {
            let start_ms = (start as u64 * 20).saturating_sub(100);
            let end_ms =
                (end as u64 * 20 + 200).min(samples.len() as u64 * 1000 / sample_rate as u64);
            if let Some(previous) = ranges.last_mut() {
                if start_ms <= previous.end_ms {
                    previous.end_ms = previous.end_ms.max(end_ms);
                } else {
                    ranges.push(AudioActivityRange { start_ms, end_ms });
                }
            } else {
                ranges.push(AudioActivityRange { start_ms, end_ms });
            }
        }
        start = end;
    }
    Ok(ranges)
}

fn align_to_audio_activity(
    segments: Vec<TranscriptionSegment>,
    activity: &[AudioActivityRange],
) -> Vec<TranscriptionSegment> {
    segments
        .into_iter()
        .filter_map(|segment| {
            let overlaps = activity
                .iter()
                .filter(|range| range.end_ms > segment.start_ms && range.start_ms < segment.end_ms)
                .collect::<Vec<_>>();
            let first = overlaps.first()?;
            let last = overlaps.last()?;
            let start_ms = segment.start_ms.max(first.start_ms);
            let end_ms = segment.end_ms.min(last.end_ms);
            (end_ms.saturating_sub(start_ms) >= 120).then_some(TranscriptionSegment {
                start_ms,
                end_ms,
                text: segment.text,
            })
        })
        .collect()
}

fn parse_output(
    path: &Path,
    source_path: String,
    requested_language: String,
    activity: &[AudioActivityRange],
) -> Result<TranscriptionResult, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|error| format!("Unable to read transcription output: {error}"))?;
    let root: serde_json::Value = serde_json::from_str(&text)
        .map_err(|error| format!("whisper.cpp returned invalid JSON: {error}"))?;
    let detected = root
        .get("result")
        .and_then(|value| value.get("language"))
        .and_then(|value| value.as_str())
        .unwrap_or(&requested_language)
        .to_string();
    let entries = root
        .get("transcription")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "whisper.cpp JSON did not contain transcription segments".to_string())?;
    let segments = entries
        .iter()
        .filter_map(|entry| {
            let offsets = entry.get("offsets")?;
            let start_ms = parse_timestamp(offsets.get("from")?)?;
            let end_ms = parse_timestamp(offsets.get("to")?)?;
            let text = entry.get("text")?.as_str()?.trim().to_string();
            (!text.is_empty() && end_ms > start_ms).then_some(TranscriptionSegment {
                start_ms,
                end_ms,
                text,
            })
        })
        .collect();
    let segments = align_to_audio_activity(segments, activity);
    Ok(TranscriptionResult {
        language: detected,
        source_path,
        segments,
    })
}

#[tauri::command]
pub async fn transcribe_audio(
    request: TranscriptionRequest,
) -> Result<TranscriptionResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let executable =
            resolve_executable().ok_or_else(|| "whisper-cli.exe is not installed".to_string())?;
        let model = resolve_model()
            .ok_or_else(|| "A multilingual Whisper model is not installed".to_string())?;
        let source = PathBuf::from(&request.audio_path);
        if !source.is_file() {
            return Err(format!("Audio track does not exist: {}", source.display()));
        }
        let parent = source.parent().unwrap_or_else(|| Path::new("."));
        let stem = source.file_stem().unwrap_or_default().to_string_lossy();
        let prepared = parent.join(format!("{stem}.transcription.wav"));
        let output_prefix = parent.join(format!("{stem}.captions"));
        let json_path = PathBuf::from(format!("{}.json", output_prefix.to_string_lossy()));
        // Never leave an earlier hallucinated transcript available after a
        // silent re-run or a failed replacement attempt.
        let _ = std::fs::remove_file(&json_path);
        let ffmpeg = background_command("ffmpeg")
            .args(["-y", "-i"])
            .arg(&source)
            .args(["-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"])
            .arg(&prepared)
            .output()
            .map_err(|error| format!("Unable to start FFmpeg for transcription: {error}"))?;
        if !ffmpeg.status.success() {
            return Err(format!(
                "Unable to prepare transcription audio: {}",
                String::from_utf8_lossy(&ffmpeg.stderr)
            ));
        }
        let activity = pcm16_mono_activity(&prepared)?;
        if activity.is_empty() {
            let _ = std::fs::remove_file(&prepared);
            return Ok(TranscriptionResult {
                language: request.language,
                source_path: request.audio_path,
                segments: Vec::new(),
            });
        }
        let language = match request.language.as_str() {
            "en" | "hi" => request.language.as_str(),
            _ => "auto",
        };
        let prompt = match language {
            "hi" => "यह स्पष्ट हिंदी भाषण है। सही शब्द, वाक्य और विराम चिह्न लिखें। अंग्रेज़ी नामों को सही रखें।",
            "en" => "Clear spoken English with accurate words, names, capitalization, and punctuation.",
            _ => "Clear Hindi or English speech. Preserve the spoken language, names, numbers, and punctuation accurately.",
        };
        let output = background_command(&executable)
            .arg("-m")
            .arg(&model)
            .arg("-f")
            .arg(&prepared)
            .args(["-l", language, "-oj", "-of"])
            .arg(&output_prefix)
            .args(["-sow", "-ml", "42", "-sns", "-bo", "8", "-bs", "8", "-nth", "0.50", "--prompt", prompt])
            .output()
            .map_err(|error| format!("Unable to start offline transcription: {error}"))?;
        let _ = std::fs::remove_file(&prepared);
        if !output.status.success() {
            return Err(format!(
                "Offline transcription failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        parse_output(&json_path, request.audio_path, request.language, &activity)
    })
    .await
    .map_err(|error| format!("Transcription worker failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::{
        align_to_audio_activity, parse_timestamp, pcm16_mono_activity, AudioActivityRange,
        TranscriptionSegment,
    };
    use std::io::Write;
    #[test]
    fn accepts_integer_and_float_offsets() {
        assert_eq!(parse_timestamp(&serde_json::json!(1250)), Some(1250));
        assert_eq!(parse_timestamp(&serde_json::json!(1250.9)), Some(1250));
    }

    #[test]
    fn removes_hallucinations_and_clamps_captions_to_audible_time() {
        let segments = vec![
            TranscriptionSegment {
                start_ms: 0,
                end_ms: 15_920,
                text: "real speech".into(),
            },
            TranscriptionSegment {
                start_ms: 48_840,
                end_ms: 54_000,
                text: "hallucination".into(),
            },
        ];
        let aligned = align_to_audio_activity(
            segments,
            &[AudioActivityRange {
                start_ms: 14_100,
                end_ms: 23_900,
            }],
        );
        assert_eq!(aligned.len(), 1);
        assert_eq!(aligned[0].start_ms, 14_100);
        assert_eq!(aligned[0].end_ms, 15_920);
    }

    #[test]
    fn pcm_activity_keeps_late_audio_late_and_rejects_silence() {
        let path = std::env::temp_dir().join(format!(
            "snap-caption-activity-{}-{}.wav",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let sample_rate = 16_000u32;
        let mut samples = vec![0i16; sample_rate as usize * 3];
        for (index, sample) in samples
            .iter_mut()
            .enumerate()
            .skip(sample_rate as usize * 2)
            .take(sample_rate as usize / 2)
        {
            let phase = index as f32 * 440.0 * std::f32::consts::TAU / sample_rate as f32;
            *sample = (phase.sin() * 8_000.0) as i16;
        }
        let data_size = (samples.len() * 2) as u32;
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(b"RIFF").unwrap();
        file.write_all(&(36 + data_size).to_le_bytes()).unwrap();
        file.write_all(b"WAVEfmt \x10\0\0\0\x01\0\x01\0").unwrap();
        file.write_all(&sample_rate.to_le_bytes()).unwrap();
        file.write_all(&(sample_rate * 2).to_le_bytes()).unwrap();
        file.write_all(&2u16.to_le_bytes()).unwrap();
        file.write_all(&16u16.to_le_bytes()).unwrap();
        file.write_all(b"data").unwrap();
        file.write_all(&data_size.to_le_bytes()).unwrap();
        for sample in samples {
            file.write_all(&sample.to_le_bytes()).unwrap();
        }
        drop(file);

        let ranges = pcm16_mono_activity(&path).unwrap();
        let _ = std::fs::remove_file(path);
        assert_eq!(ranges.len(), 1);
        assert!(
            ranges[0].start_ms >= 1_850,
            "speech moved too early: {ranges:?}"
        );
        assert!(
            ranges[0].end_ms <= 2_750,
            "speech stretched too late: {ranges:?}"
        );
    }
}
