use crate::{access, link_install, process, recording_session};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicU64, AtomicU8, Ordering},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

const LINK_IDLE: u8 = 0;
const LINK_ACTIVE: u8 = 1;
const LINK_CANCELLED: u8 = 2;
static LINK_STATE: AtomicU8 = AtomicU8::new(LINK_IDLE);
static NEXT_FILE: AtomicU64 = AtomicU64::new(0);

struct LinkJob;

impl LinkJob {
    fn begin(window: &tauri::WebviewWindow) -> Result<Self, String> {
        if window.label() != "editor" {
            return Err("Open the Snap editor to import a link.".into());
        }
        if LINK_STATE
            .compare_exchange(LINK_IDLE, LINK_ACTIVE, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err("Wait for the current link import to finish.".into());
        }
        let job = Self;
        check_recording()?;
        Ok(job)
    }
}

impl Drop for LinkJob {
    fn drop(&mut self) {
        LINK_STATE.store(LINK_IDLE, Ordering::Release);
    }
}

fn check_recording() -> Result<(), String> {
    use recording_session::RecordingPhase::*;
    if recording_session::get_recording_session_state()?.is_some_and(|session| {
        matches!(
            session.phase,
            Starting | Recording | Pausing | Paused | Resuming | Stopping | Finalizing
        )
    }) {
        return Err("Finish the current recording before importing a link.".into());
    }
    Ok(())
}

pub(crate) fn cancel_link() {
    let _ = LINK_STATE.compare_exchange(
        LINK_ACTIVE,
        LINK_CANCELLED,
        Ordering::AcqRel,
        Ordering::Acquire,
    );
}

#[tauri::command]
pub fn cancel_editor_link(window: tauri::WebviewWindow) {
    if window.label() == "editor" {
        cancel_link();
    }
}

#[tauri::command]
pub fn editor_link_ready(window: tauri::WebviewWindow) -> bool {
    window.label() == "editor"
        && (link_install::installed(window.app_handle()).is_some()
            || process::media_tool_path("yt-dlp").is_some())
}

#[tauri::command]
pub async fn install_editor_link(
    window: tauri::WebviewWindow,
    progress: tauri::ipc::Channel<link_install::Progress>,
) -> Result<(), String> {
    let job = LinkJob::begin(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _job = job;
        link_install::install(
            &app,
            &format!("download-{}", unique_name()),
            check_link_work,
            |event| {
                let _ = progress.send(event);
            },
        )
    })
    .await
    .map_err(|_| "The link importer setup worker stopped.".to_string())?
}

fn check_link_work() -> Result<(), String> {
    if LINK_STATE.load(Ordering::Acquire) == LINK_CANCELLED {
        return Err("Link import cancelled.".into());
    }
    check_recording()
}

fn sources_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("editor-sources"))
        .map_err(|e| e.to_string())
}

fn unique_name() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let index = NEXT_FILE.fetch_add(1, Ordering::Relaxed);
    format!("{}-{timestamp}-{index}", std::process::id())
}

fn stage_source(app: &tauri::AppHandle, source: &Path) -> Result<String, String> {
    check_recording()?;
    access::require(app, source)?;
    let root = sources_dir(app)?;
    let extension = source
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if ![
        "png", "jpg", "jpeg", "webp", "bmp", "gif", "wav", "mp3", "m4a", "aac", "flac", "ogg",
        "opus", "wma", "mp4", "mov", "mkv", "webm", "avi",
    ]
    .contains(&extension.as_str())
    {
        return Err("Select a supported image, audio or video file.".into());
    }
    let metadata = fs::metadata(source).map_err(|_| "The source file no longer exists.")?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err("Select a readable media file.".into());
    }
    if source.starts_with(&root) {
        return Ok(source.to_string_lossy().into_owned());
    }
    let name = source.file_name().ok_or("Select a media file.")?;
    let mut fingerprint = Sha256::new();
    fingerprint.update(source.to_string_lossy().to_lowercase());
    fingerprint.update(metadata.len().to_le_bytes());
    if let Ok(modified) = metadata
        .modified()
        .and_then(|time| time.duration_since(UNIX_EPOCH).map_err(io::Error::other))
    {
        fingerprint.update(modified.as_nanos().to_le_bytes());
    }
    let folder = root.join(format!("{:x}", fingerprint.finalize()));
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let destination = folder.join(name);
    if !destination.is_file() {
        let temporary = folder.join(format!("{}.partial", unique_name()));
        let result = (|| -> Result<(), String> {
            let mut input = fs::File::open(source).map_err(|e| e.to_string())?;
            let mut output = fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temporary)
                .map_err(|e| e.to_string())?;
            let mut buffer = vec![0_u8; 1024 * 1024];
            let mut size = 0;
            loop {
                check_recording()?;
                let read = input.read(&mut buffer).map_err(|e| e.to_string())?;
                if read == 0 {
                    break;
                }
                output
                    .write_all(&buffer[..read])
                    .map_err(|e| e.to_string())?;
                size += read as u64;
            }
            if size != metadata.len() {
                return Err("The source changed during import.".into());
            }
            drop(output);
            fs::rename(&temporary, &destination).map_err(|e| e.to_string())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
            if !destination.is_file() {
                result?;
            }
        }
    }
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn stage_editor_source(
    window: tauri::WebviewWindow,
    path: String,
) -> Result<String, String> {
    if window.label() != "editor" {
        return Err("Open the Snap editor to import media.".into());
    }
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || stage_source(&app, Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
}

fn web_url(value: &str) -> Result<reqwest::Url, String> {
    reqwest::Url::parse(value.trim())
        .ok()
        .filter(|url| {
            matches!(url.scheme(), "http" | "https")
                && url.host_str().is_some()
                && url.username().is_empty()
                && url.password().is_none()
        })
        .ok_or_else(|| "Paste a full HTTP or HTTPS video link.".into())
}

fn downloader(app: &tauri::AppHandle) -> Result<Command, String> {
    let managed = link_install::installed(app);
    let executable = managed
        .as_ref()
        .map(|(path, _)| path.clone())
        .or_else(|| process::media_tool_path("yt-dlp"))
        .ok_or("Select Install downloader to set up link import.")?;
    let mut command = process::background_command(executable);
    command.args([
        "--ignore-config",
        "--no-plugin-dirs",
        "--no-playlist",
        "--playlist-items",
        "1",
        "--no-warnings",
        "--socket-timeout",
        "15",
    ]);
    if let Some(ffmpeg) = process::media_tool_path("ffmpeg") {
        command.arg("--ffmpeg-location").arg(ffmpeg);
    }
    if let Some((_, deno)) = managed {
        command
            .arg("--js-runtimes")
            .arg(format!("deno:{}", deno.display()));
    } else if let Some(node) = process::media_tool_path("node") {
        command
            .arg("--js-runtimes")
            .arg(format!("node:{}", node.display()));
    }
    Ok(command)
}

fn read_output(mut pipe: impl Read, limit: usize) -> Vec<u8> {
    let mut output = Vec::new();
    let _ = (&mut pipe).take(limit as u64).read_to_end(&mut output);
    let _ = io::copy(&mut pipe, &mut io::sink());
    output
}

fn run_tool(command: &mut Command, timeout: Duration, failure: &str) -> Result<Vec<u8>, String> {
    run_tool_with_output(command, timeout, failure, |stdout| {
        read_output(stdout, 16 * 1024 * 1024)
    })
}

fn run_tool_with_output(
    command: &mut Command,
    timeout: Duration,
    failure: &str,
    read_stdout: impl FnOnce(std::process::ChildStdout) -> Vec<u8> + Send,
) -> Result<Vec<u8>, String> {
    check_link_work()?;
    let job = process::ProcessJob::new().map_err(|_| "Could not start the link import worker.")?;
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = job.spawn(command).map_err(|_| failure.to_string())?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let errors = std::thread::spawn(move || read_output(stderr, 8192));
    let start = Instant::now();
    let (status, output) = std::thread::scope(|scope| {
        let output = scope.spawn(move || read_stdout(stdout));
        let status = loop {
            if let Err(error) = check_link_work() {
                break Err(error);
            }
            if start.elapsed() >= timeout {
                break Err(
                    "The link import timed out. Try again or choose a smaller quality.".into(),
                );
            }
            match child.try_wait() {
                Ok(Some(status)) => break Ok(status),
                Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                Err(_) => break Err(failure.to_string()),
            }
        };
        drop(job);
        let _ = child.wait();
        (status, output.join().unwrap_or_default())
    });
    let errors = errors.join().unwrap_or_default();
    if !status?.success() {
        let diagnostic = String::from_utf8_lossy(&errors).to_ascii_lowercase();
        if diagnostic.contains("sign in")
            || diagnostic.contains("login required")
            || diagnostic.contains("private video")
        {
            return Err(
                "This video requires sign-in or is private. Use a publicly accessible clip.".into(),
            );
        }
        return Err(failure.to_string());
    }
    Ok(output)
}

#[derive(Serialize)]
pub struct LinkProgress {
    phase: &'static str,
    percent: Option<u8>,
}

fn report(progress: &tauri::ipc::Channel<LinkProgress>, phase: &'static str, percent: Option<u8>) {
    let _ = progress.send(LinkProgress { phase, percent });
}

fn run_progress_tool(
    command: &mut Command,
    failure: &str,
    mut on_line: impl FnMut(&str) + Send,
) -> Result<(), String> {
    run_tool_with_output(command, Duration::from_secs(30 * 60), failure, |stdout| {
        let mut reader = BufReader::new(stdout);
        let mut bytes = Vec::new();
        while reader
            .read_until(b'\n', &mut bytes)
            .is_ok_and(|count| count > 0)
        {
            if let Ok(line) = std::str::from_utf8(&bytes) {
                on_line(line.trim());
            }
            bytes.clear();
        }
        Vec::new()
    })?;
    Ok(())
}

fn download_percent(line: &str) -> Option<u8> {
    let (received, total) = line.strip_prefix("snap-download:")?.split_once(':')?;
    let received = received.parse::<u64>().ok()?;
    let total = total.parse::<u64>().ok().filter(|total| *total > 0)?;
    Some((received.min(total).saturating_mul(100) / total) as u8)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkFormat {
    id: String,
    width: u64,
    height: u64,
    fps: Option<f64>,
    codec: String,
    embedded_audio: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkInfo {
    title: String,
    duration: Option<f64>,
    formats: Vec<LinkFormat>,
    separate_audio: bool,
}

fn valid_format_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 96
        && id
            .bytes()
            .all(|ch| ch.is_ascii_alphanumeric() || b"._-".contains(&ch))
}

fn codec_present(value: &serde_json::Value) -> bool {
    value
        .as_str()
        .is_some_and(|codec| !codec.is_empty() && codec != "none")
}

fn read_link_info(metadata: serde_json::Value) -> Result<LinkInfo, String> {
    if metadata["is_live"].as_bool() == Some(true) || metadata.get("entries").is_some() {
        return Err("Paste a link to one finished video.".into());
    }
    let formats = metadata["formats"]
        .as_array()
        .ok_or("No downloadable video qualities were found.")?;
    let eligible = |format: &&serde_json::Value| {
        format["has_drm"].as_bool() != Some(true)
            && format["format_id"].as_str().is_some_and(valid_format_id)
    };
    let separate_audio = formats
        .iter()
        .filter(eligible)
        .any(|f| f["vcodec"] == "none" && codec_present(&f["acodec"]));
    let mut video: Vec<_> = formats
        .iter()
        .filter(eligible)
        .filter_map(|f| {
            if f["vcodec"] == "none" {
                return None;
            }
            let height = f["height"].as_u64().unwrap_or_default();
            if height == 0
                && !codec_present(&f["vcodec"])
                && !matches!(f["ext"].as_str(), Some("mp4" | "mov" | "mkv" | "webm"))
            {
                return None;
            }
            Some(LinkFormat {
                id: f["format_id"].as_str()?.to_string(),
                width: f["width"].as_u64().unwrap_or_default(),
                height,
                fps: f["fps"].as_f64().filter(|fps| *fps > 0.0),
                codec: f["vcodec"]
                    .as_str()
                    .unwrap_or_default()
                    .split('.')
                    .next()
                    .unwrap_or_default()
                    .to_string(),
                embedded_audio: f["acodec"].as_str().map(|_| codec_present(&f["acodec"])),
            })
        })
        .collect();
    video.reverse(); // yt-dlp sorts formats from worst to best by default.
    video.sort_by(|a, b| {
        (b.height, b.width).cmp(&(a.height, a.width)).then_with(|| {
            b.fps
                .unwrap_or_default()
                .total_cmp(&a.fps.unwrap_or_default())
        })
    });
    if video.is_empty() {
        return Err("No downloadable video qualities were found.".into());
    }
    Ok(LinkInfo {
        title: metadata["title"]
            .as_str()
            .unwrap_or("Online video")
            .chars()
            .take(180)
            .collect(),
        duration: metadata["duration"].as_f64(),
        formats: video,
        separate_audio,
    })
}

#[tauri::command]
pub async fn inspect_editor_link(
    window: tauri::WebviewWindow,
    url: String,
) -> Result<LinkInfo, String> {
    let job = LinkJob::begin(&window)?;
    let app = window.app_handle().clone();
    let url = web_url(&url)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _job = job;
        let bytes = run_tool(
            downloader(&app)?.args(["--dump-single-json", "--skip-download", "--", url.as_str()]),
            Duration::from_secs(90),
            "Could not read this link. Check that it contains a public video and that yt-dlp is up to date.",
        )?;
        let metadata = serde_json::from_slice(&bytes).map_err(|_| "Could not read the available video qualities.")?;
        read_link_info(metadata)
    }).await.map_err(|_| "The link inspection worker stopped.".to_string())?
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkRequest {
    url: String,
    title: String,
    format_id: String,
    embedded_audio: Option<bool>,
    with_audio: bool,
}

fn download_link(
    app: &tauri::AppHandle,
    request: LinkRequest,
    progress: &tauri::ipc::Channel<LinkProgress>,
) -> Result<String, String> {
    let url = web_url(&request.url)?;
    if !valid_format_id(&request.format_id) {
        return Err("Inspect the link again and choose a video quality.".into());
    }
    if process::media_tool_path("ffmpeg").is_none() || process::media_tool_path("ffprobe").is_none()
    {
        return Err("Set up the FFmpeg video engine in Snap Settings before importing.".into());
    }
    let folder = sources_dir(app)?.join(unique_name());
    fs::create_dir_all(&folder).map_err(|_| "Could not create the source folder.")?;
    let result = (|| {
        let title: String = request
            .title
            .chars()
            .take(60)
            .map(|ch| {
                if ch.is_control() || "<>:\"/\\|?*%".contains(ch) {
                    '_'
                } else {
                    ch
                }
            })
            .collect();
        let destination = folder.join(format!(
            "Video - {}.mp4",
            title.trim().trim_end_matches('.')
        ));
        let selector = if request.with_audio && request.embedded_audio == Some(false) {
            format!("{}+(bestaudio[acodec^=mp4a]/bestaudio)", request.format_id)
        } else {
            request.format_id
        };
        report(progress, "Downloading video", None);
        run_progress_tool(
            downloader(app)?.current_dir(&folder).args([
                "--progress", "--newline", "--progress-delta", "0.5", "--concurrent-fragments", "8",
                "--progress-template", "download:snap-download:%(progress.downloaded_bytes)d:%(progress.total_bytes,progress.total_bytes_estimate)d",
                "--progress-template", "postprocess:snap-merge",
                "-f", &selector, "--merge-output-format", "mp4/mkv",
                "-o", "download.%(ext)s", "--", url.as_str()
            ]),
            "Could not download the selected quality. Inspect the link again or choose another quality.",
            |line| {
                if line == "snap-merge" {
                    report(progress, "Preparing downloaded tracks", None);
                } else if let Some(percent) = download_percent(line) {
                    report(progress, "Downloading video", Some(percent));
                }
            },
        )?;
        let mut outputs = fs::read_dir(&folder)
            .map_err(|_| "Could not find the downloaded video.")?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.is_file()
                    && path.file_stem().is_some_and(|stem| stem == "download")
                    && !matches!(
                        path.extension().and_then(|ext| ext.to_str()),
                        None | Some("part" | "ytdl")
                    )
            });
        let input = outputs
            .next()
            .filter(|_| outputs.next().is_none())
            .ok_or("Could not identify the finished download.")?;
        report(progress, "Reading downloaded video", None);
        let info = run_tool(
            process::background_command("ffprobe")
                .args([
                    "-v",
                    "error",
                    "-show_entries",
                    "stream=codec_name,codec_type,pix_fmt:format=duration",
                    "-of",
                    "json",
                ])
                .arg(&input),
            Duration::from_secs(30),
            "Could not read the downloaded video.",
        )?;
        let probe: serde_json::Value =
            serde_json::from_slice(&info).map_err(|_| "Could not read the downloaded video.")?;
        let streams = probe["streams"]
            .as_array()
            .ok_or("Could not read the downloaded video tracks.")?;
        let video = streams
            .iter()
            .find(|s| s["codec_type"] == "video")
            .ok_or("The download has no video track.")?;
        let audio = streams
            .iter()
            .find(|stream| stream["codec_type"] == "audio");
        if request.with_audio && request.embedded_audio.is_some() && audio.is_none() {
            return Err(
                "This quality has no audio. Choose another quality or download without audio."
                    .into(),
            );
        }
        let copying_video = video["codec_name"] == "h264" && video["pix_fmt"] == "yuv420p";
        let copying_audio = audio.is_none()
            || request.with_audio && audio.is_some_and(|stream| stream["codec_name"] == "aac");
        if copying_video
            && copying_audio
            && input
                .extension()
                .is_some_and(|extension| extension == "mp4")
        {
            check_link_work()?;
            fs::rename(&input, &destination).map_err(|_| "Could not save the downloaded MP4.")?;
            return Ok(destination.to_string_lossy().into_owned());
        }
        let duration = probe["format"]["duration"]
            .as_str()
            .and_then(|duration| duration.parse::<f64>().ok())
            .filter(|duration| duration.is_finite() && *duration > 0.0);
        let mut command = process::background_command("ffmpeg");
        command
            .args([
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-progress",
                "pipe:1",
                "-nostats",
                "-i",
            ])
            .arg(&input)
            .args(["-map", "0:v:0"]);
        if copying_video {
            command.args(["-c:v", "copy"]);
        } else {
            command.args([
                "-vf",
                "pad=ceil(iw/2)*2:ceil(ih/2)*2",
                "-pix_fmt",
                "yuv420p",
                "-c:v",
                "libx264",
                "-preset",
                "superfast",
                "-crf",
                "18",
            ]);
        }
        if request.with_audio {
            if let Some(audio) = audio {
                command.args([
                    "-map",
                    "0:a:0",
                    "-c:a",
                    if audio["codec_name"] == "aac" {
                        "copy"
                    } else {
                        "aac"
                    },
                ]);
            }
        } else {
            command.arg("-an");
        }
        let phase = if copying_video {
            "Preparing video for the editor"
        } else {
            "Converting video for the editor"
        };
        report(progress, phase, duration.map(|_| 0));
        run_progress_tool(
            command.args(["-movflags", "+faststart"]).arg(&destination),
            "Could not prepare this video for the editor.",
            |line| {
                if let Some((elapsed, duration)) = line
                    .strip_prefix("out_time_us=")
                    .and_then(|time| time.parse::<f64>().ok())
                    .zip(duration)
                {
                    report(
                        progress,
                        phase,
                        Some((elapsed / (duration * 1_000_000.0) * 100.0).clamp(0.0, 99.0) as u8),
                    );
                }
            },
        )?;
        let _ = fs::remove_file(input);
        Ok(destination.to_string_lossy().into_owned())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&folder);
    }
    result
}

#[tauri::command]
pub async fn download_editor_link(
    window: tauri::WebviewWindow,
    request: LinkRequest,
    progress: tauri::ipc::Channel<LinkProgress>,
) -> Result<String, String> {
    let job = LinkJob::begin(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _job = job;
        download_link(&app, request, &progress)
    })
    .await
    .map_err(|_| "The link download worker stopped.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_download_progress_without_guessing_unknown_sizes() {
        assert_eq!(download_percent("snap-download:5:20"), Some(25));
        assert_eq!(download_percent("snap-download:21:20"), Some(100));
        assert_eq!(download_percent("snap-download:5:NA"), None);
        assert_eq!(download_percent("snap-download:5:0"), None);
        assert_eq!(download_percent("[download] starting"), None);
    }

    #[test]
    fn link_formats_show_audio_availability_and_filter_protected_streams() {
        let info = read_link_info(json!({"title": "Test", "formats": [
            {"format_id": "360p", "height": 360, "vcodec": "avc1.123", "acodec": "mp4a.40"},
            {"format_id": "720p", "height": 720, "vcodec": "vp9", "acodec": "none"},
            {"format_id": "audio", "vcodec": "none", "acodec": "opus"},
            {"format_id": "4k", "height": 2160, "vcodec": "av1", "has_drm": true},
            {"format_id": "best+audio", "height": 1080, "vcodec": "av1"}
        ]}))
        .unwrap();
        assert_eq!(
            info.formats
                .iter()
                .map(|f| f.id.as_str())
                .collect::<Vec<_>>(),
            ["720p", "360p"]
        );
        assert!(info.separate_audio);
        assert_eq!(info.formats[1].embedded_audio, Some(true));
        assert!(read_link_info(json!({"entries": []})).is_err());
        assert!(web_url("file:///video.mp4").is_err());
        assert!(web_url("https://example.com/video").is_ok());
        let direct =
            read_link_info(json!({"formats": [{"format_id": "mp4", "ext": "mp4"}]})).unwrap();
        assert_eq!(direct.formats[0].embedded_audio, None);
    }
}
