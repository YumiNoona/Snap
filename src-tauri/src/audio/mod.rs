use std::collections::VecDeque;
use std::io::{Read, Seek, SeekFrom, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use wasapi::*;

// ── Device type ──────────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub device_type: String, // "microphone" or "speaker"
}

// ── State ────────────────────────────────────────────────────────────────────

struct AudioCaptureHandle {
    is_recording: Arc<AtomicBool>,
    is_paused: Arc<AtomicBool>,
    mic_muted: Arc<AtomicBool>,
    done_rx: tokio::sync::oneshot::Receiver<std::result::Result<(), String>>,
}

struct AudioCaptureConfig {
    mic_device_id: String,
    speaker_device_id: String,
    output_dir: String,
    process_id: Option<u32>,
}

static AUDIO_STATE: Mutex<Option<AudioCaptureHandle>> = Mutex::new(None);

// ── Enumerate devices ────────────────────────────────────────────────────────

#[tauri::command]
pub fn enumerate_audio_devices() -> std::result::Result<Vec<AudioDevice>, String> {
    eprintln!("[Snap Audio] Step 1: enumerating audio devices...");

    let _ = initialize_mta();

    let enumerator =
        DeviceEnumerator::new().map_err(|e| format!("DeviceEnumerator failed: {e}"))?;

    let mut devices = Vec::new();

    devices.push(AudioDevice {
        id: "default".to_string(),
        name: "Default microphone".to_string(),
        device_type: "microphone".to_string(),
    });

    // Microphones (capture devices)
    if let Ok(coll) = enumerator.get_device_collection(&Direction::Capture) {
        for dev in (&coll).into_iter().flatten() {
            if let (Ok(name), Ok(id)) = (dev.get_friendlyname(), dev.get_id()) {
                devices.push(AudioDevice {
                    id: format!("mic-id:{id}"),
                    name,
                    device_type: "microphone".to_string(),
                });
            }
        }
    }

    devices.push(AudioDevice {
        id: "default".to_string(),
        name: "Default system output".to_string(),
        device_type: "speaker".to_string(),
    });

    // Speakers (render devices, for loopback target — we use default)
    if let Ok(coll) = enumerator.get_device_collection(&Direction::Render) {
        for dev in (&coll).into_iter().flatten() {
            if let (Ok(name), Ok(id)) = (dev.get_friendlyname(), dev.get_id()) {
                devices.push(AudioDevice {
                    id: format!("speaker-id:{id}"),
                    name,
                    device_type: "speaker".to_string(),
                });
            }
        }
    }

    eprintln!("[Snap Audio] Step 1: found {} devices", devices.len());
    Ok(devices)
}

// ── Start audio capture (async) ──────────────────────────────────────────────

#[tauri::command]
pub async fn start_audio_capture(
    mic_device_id: String,
    speaker_device_id: String,
    output_dir: String,
    process_id: Option<u32>,
) -> std::result::Result<(), String> {
    let mut guard = AUDIO_STATE.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Err("Audio capture already in progress".to_string());
    }

    let is_recording = Arc::new(AtomicBool::new(true));
    let is_paused = Arc::new(AtomicBool::new(false));
    let mic_muted = Arc::new(AtomicBool::new(false));
    let (done_tx, done_rx) = tokio::sync::oneshot::channel();
    let (startup_tx, startup_rx) = std::sync::mpsc::channel::<std::result::Result<(), String>>();
    let is_rec_clone = is_recording.clone();
    let is_paused_clone = is_paused.clone();
    let mic_muted_clone = mic_muted.clone();
    let expected_streams =
        usize::from(speaker_device_id != "disabled") + usize::from(mic_device_id != "disabled");
    let config = AudioCaptureConfig {
        mic_device_id,
        speaker_device_id,
        output_dir,
        process_id,
    };

    // Use std::thread::spawn for a fresh thread with no prior COM initialization.
    thread::spawn(move || {
        let result = run_audio_threads(
            config,
            is_rec_clone,
            is_paused_clone,
            mic_muted_clone,
            startup_tx,
        );
        let _ = done_tx.send(result);
    });

    for _ in 0..expected_streams {
        match startup_rx.recv_timeout(Duration::from_secs(6)) {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                is_recording.store(false, Ordering::SeqCst);
                return Err(error);
            }
            Err(_) => {
                is_recording.store(false, Ordering::SeqCst);
                return Err("Audio devices failed to start within 6 seconds".to_string());
            }
        }
    }

    *guard = Some(AudioCaptureHandle {
        is_recording,
        is_paused,
        mic_muted,
        done_rx,
    });

    Ok(())
}

#[tauri::command]
pub fn set_microphone_muted(muted: bool) -> std::result::Result<(), String> {
    let guard = AUDIO_STATE.lock().map_err(|e| e.to_string())?;
    if let Some(handle) = guard.as_ref() {
        handle.mic_muted.store(muted, Ordering::SeqCst);
    }
    Ok(())
}

/// Pause (true) or resume (false) audio capture. While paused, incoming
/// samples are dropped so the WAV timelines match the video timeline (which
/// omits the paused segment).
#[tauri::command]
pub fn set_audio_paused(paused: bool) -> std::result::Result<(), String> {
    let guard = AUDIO_STATE.lock().map_err(|e| e.to_string())?;
    if let Some(handle) = guard.as_ref() {
        handle.is_paused.store(paused, Ordering::SeqCst);
        eprintln!(
            "[Snap Audio] Capture {}",
            if paused { "paused" } else { "resumed" }
        );
    }
    Ok(())
}

// ── Stop audio capture (async) ───────────────────────────────────────────────

#[tauri::command]
pub async fn stop_audio_capture() -> std::result::Result<(), String> {
    let handle = {
        let mut guard = AUDIO_STATE.lock().map_err(|e| e.to_string())?;
        guard
            .take()
            .ok_or_else(|| "No audio capture in progress".to_string())?
    };

    eprintln!("[Snap Audio] Signaling audio threads to stop...");
    handle.is_recording.store(false, Ordering::SeqCst);

    match tokio::time::timeout(Duration::from_secs(15), handle.done_rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("Audio capture thread dropped without result".to_string()),
        Err(_) => Err("Audio capture stop timed out after 15s".to_string()),
    }
}

// ── Audio capture threads ────────────────────────────────────────────────────

fn run_audio_threads(
    config: AudioCaptureConfig,
    is_recording: Arc<AtomicBool>,
    is_paused: Arc<AtomicBool>,
    mic_muted: Arc<AtomicBool>,
    startup_tx: std::sync::mpsc::Sender<std::result::Result<(), String>>,
) -> std::result::Result<(), String> {
    let out_dir = std::path::PathBuf::from(config.output_dir);
    let mic_id = config.mic_device_id;
    let speaker_id = config.speaker_device_id;
    let timeline_offset = Duration::from_millis(crate::input_hook::capture_timeline_elapsed_ms());
    std::fs::create_dir_all(&out_dir).map_err(|e| format!("Failed to create output dir: {e}"))?;

    let sys_path = out_dir.join("system_audio.wav");
    let mic_path = out_dir.join("mic_audio.wav");

    let sys_rec = is_recording.clone();
    let mic_rec = is_recording.clone();
    let sys_paused = is_paused.clone();
    let mic_paused = is_paused.clone();

    let sys_file = sys_path.clone();
    let mic_file = mic_path.clone();

    let capture_system = speaker_id != "disabled";
    let capture_mic = mic_id != "disabled";
    let sys_handle = if capture_system {
        eprintln!(
            "[Snap Audio] Step 2: starting system loopback capture -> {}",
            sys_file.display()
        );
        let startup = startup_tx.clone();
        Some(thread::spawn(move || {
            let result = capture_loopback(
                &speaker_id,
                sys_file,
                sys_rec,
                sys_paused,
                timeline_offset,
                config.process_id,
                startup.clone(),
            );
            if let Err(error) = &result {
                let _ = startup.send(Err(format!("Desktop audio could not start: {error}")));
            }
            result
        }))
    } else {
        None
    };

    eprintln!(
        "[Snap Audio] Step 3: starting mic capture ({mic_id}) -> {}",
        mic_file.display()
    );
    let mic_handle = if capture_mic {
        let startup = startup_tx.clone();
        Some(thread::spawn(move || {
            let result = capture_microphone(
                &mic_id,
                mic_file,
                mic_rec,
                mic_paused,
                mic_muted,
                timeline_offset,
                startup.clone(),
            );
            if let Err(error) = &result {
                let _ = startup.send(Err(format!("Microphone could not start: {error}")));
            }
            result
        }))
    } else {
        None
    };

    // Wait for both threads
    let mut errors = Vec::new();
    if let Some(handle) = sys_handle {
        match handle.join() {
            Ok(Ok(())) => {}
            Ok(Err(error)) => errors.push(format!("system audio: {error}")),
            Err(_) => errors.push("system audio thread crashed".to_string()),
        }
    }
    if let Some(handle) = mic_handle {
        match handle.join() {
            Ok(Ok(())) => {}
            Ok(Err(error)) => errors.push(format!("microphone: {error}")),
            Err(_) => errors.push("microphone audio thread crashed".to_string()),
        }
    }

    // Verify output files
    let mut expected = Vec::new();
    if capture_system {
        expected.push(("system audio", &sys_path));
    }
    if capture_mic {
        expected.push(("mic audio", &mic_path));
    }
    for (label, path) in expected {
        let exists = path.exists();
        let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        eprintln!("[Snap Audio] {label} output: exists={exists}, size={size} bytes");
        if !exists {
            errors.push(format!("{label} file missing: {}", path.display()));
        } else if size <= 44 {
            // A valid header-only file means the endpoint started correctly
            // but delivered no packets (for example, desktop audio remained
            // silent for the entire recording). Preserve the video and any
            // other audio track instead of failing the whole session.
            eprintln!(
                "[Snap Audio] {label} was silent; no playable sidecar will be exposed ({})",
                path.display()
            );
        }
    }

    if !errors.is_empty() {
        return Err(errors.join("; "));
    }

    eprintln!("[Snap Audio] Capture complete");
    Ok(())
}

// ── WAV helpers ──────────────────────────────────────────────────────────────

// 48 kHz is the native/default rate for the large majority of Windows video
// and communications endpoints. Keeping the capture clock at that rate avoids
// an unnecessary shared-mode resample that can introduce noise on some drivers.
const SAMPLE_RATE: usize = 48_000;
const SYS_CHANNELS: u16 = 2;
const MIC_CHANNELS: u16 = 1;
const BITS_PER_SAMPLE: u16 = 16;

#[tauri::command]
pub fn audio_waveform(
    path: String,
    buckets: Option<usize>,
) -> std::result::Result<Vec<f32>, String> {
    let mut file = std::fs::File::open(&path)
        .map_err(|error| format!("Unable to read audio track {path}: {error}"))?;
    let bucket_count = buckets.unwrap_or(220).clamp(16, 2_000);
    let mut riff = [0u8; 12];
    file.read_exact(&mut riff)
        .map_err(|error| format!("Unable to read WAV header: {error}"))?;
    if &riff[0..4] != b"RIFF" || &riff[8..12] != b"WAVE" {
        return Err("Audio track is not a valid WAV file".to_string());
    }

    let mut channels = 1usize;
    let mut bits = 16usize;
    let mut data = None::<(u64, u64)>;
    loop {
        let mut header = [0u8; 8];
        if file.read_exact(&mut header).is_err() {
            break;
        }
        let size = u32::from_le_bytes(header[4..8].try_into().unwrap()) as u64;
        let start = file
            .stream_position()
            .map_err(|error| format!("Unable to inspect WAV chunks: {error}"))?;
        match &header[0..4] {
            b"fmt " if size >= 16 => {
                let mut format = [0u8; 16];
                file.read_exact(&mut format)
                    .map_err(|error| format!("Unable to read WAV format: {error}"))?;
                channels = u16::from_le_bytes([format[2], format[3]]) as usize;
                bits = u16::from_le_bytes([format[14], format[15]]) as usize;
            }
            b"data" => {
                let available = file
                    .metadata()
                    .map_err(|error| format!("Unable to inspect audio track: {error}"))?
                    .len()
                    .saturating_sub(start);
                data = Some((start, size.min(available)));
                break;
            }
            _ => {}
        }
        file.seek(SeekFrom::Start(
            start.saturating_add(size).saturating_add(size % 2),
        ))
        .map_err(|error| format!("Unable to scan WAV chunks: {error}"))?;
    }
    if bits != 16 || channels == 0 {
        return Err(format!(
            "Unsupported WAV format: {bits}-bit, {channels} channels"
        ));
    }
    let (start, data_size) =
        data.ok_or_else(|| "Audio track contains no sample data".to_string())?;
    let frame_bytes = channels * 2;
    let frames = data_size as usize / frame_bytes;
    if frames == 0 {
        return Ok(vec![]);
    }

    file.seek(SeekFrom::Start(start))
        .map_err(|error| format!("Unable to seek audio samples: {error}"))?;
    let mut sums = vec![0f64; bucket_count];
    let mut counts = vec![0u64; bucket_count];
    let buffer_frames = (65_536 / frame_bytes).max(1);
    let mut buffer = vec![0u8; buffer_frames * frame_bytes];
    let mut frame_index = 0usize;
    while frame_index < frames {
        let wanted_frames = (frames - frame_index).min(buffer_frames);
        let wanted_bytes = wanted_frames * frame_bytes;
        file.read_exact(&mut buffer[..wanted_bytes])
            .map_err(|error| format!("Unable to stream waveform samples: {error}"))?;
        for local_frame in 0..wanted_frames {
            let bucket = ((frame_index + local_frame) * bucket_count / frames)
                .min(bucket_count.saturating_sub(1));
            let offset = local_frame * frame_bytes;
            for channel in 0..channels {
                let sample_offset = offset + channel * 2;
                let sample = i16::from_le_bytes([buffer[sample_offset], buffer[sample_offset + 1]])
                    as f64
                    / 32768.0;
                // Measure energy per channel. Mixing channels before squaring
                // makes opposite-phase stereo look silent even when audible.
                sums[bucket] += sample * sample;
                counts[bucket] += 1;
            }
        }
        frame_index += wanted_frames;
    }
    Ok(sums
        .into_iter()
        .zip(counts)
        .map(|(sum, count)| {
            if count == 0 {
                0.0
            } else {
                (sum / count as f64).sqrt().min(1.0) as f32
            }
        })
        .collect())
}

/// Write a WAV header with the given data_size. If data_size is 0 (used as a
/// placeholder during streaming), the header will be updated later via
/// `finalize_wav_header`.
fn write_wav_header(
    writer: &mut impl Write,
    channels: u16,
    data_size: u32,
) -> std::result::Result<(), std::io::Error> {
    let sample_rate = SAMPLE_RATE as u32;
    let byte_rate = sample_rate * channels as u32 * (BITS_PER_SAMPLE / 8) as u32;
    let block_align = channels * (BITS_PER_SAMPLE / 8);

    // RIFF header
    writer.write_all(b"RIFF")?;
    writer.write_all(&(36u32 + data_size).to_le_bytes())?;
    writer.write_all(b"WAVE")?;

    // fmt chunk
    writer.write_all(b"fmt ")?;
    writer.write_all(&16u32.to_le_bytes())?; // chunk size
    writer.write_all(&1u16.to_le_bytes())?; // PCM = 1
    writer.write_all(&channels.to_le_bytes())?;
    writer.write_all(&sample_rate.to_le_bytes())?;
    writer.write_all(&byte_rate.to_le_bytes())?;
    writer.write_all(&block_align.to_le_bytes())?;
    writer.write_all(&BITS_PER_SAMPLE.to_le_bytes())?;

    // data chunk header (actual samples follow)
    writer.write_all(b"data")?;
    writer.write_all(&data_size.to_le_bytes())?;

    Ok(())
}

/// Seek back to the WAV header and update the file-size and data-size fields
/// with the actual number of bytes written.
fn finalize_wav_header(
    file: &mut std::fs::File,
    data_size: u32,
) -> std::result::Result<(), std::io::Error> {
    // Byte 4: RIFF chunk size = 36 + data_size
    file.seek(SeekFrom::Start(4))?;
    file.write_all(&(36u32 + data_size).to_le_bytes())?;

    // Byte 40: data chunk size
    file.seek(SeekFrom::Start(40))?;
    file.write_all(&data_size.to_le_bytes())?;

    file.flush()?;
    Ok(())
}

/// Monotonic recording clock shared conceptually with video/input capture.
/// The initial offset accounts for the small gap between the first video
/// frame and WASAPI startup; paused time is excluded from every track.
struct AudioTimelineClock {
    started: Instant,
    initial_offset: Duration,
    paused_total: Duration,
    pause_started: Option<Instant>,
}

impl AudioTimelineClock {
    fn new(initial_offset: Duration) -> Self {
        Self {
            started: Instant::now(),
            initial_offset,
            paused_total: Duration::ZERO,
            pause_started: None,
        }
    }

    fn elapsed(&mut self, paused: bool) -> Duration {
        let now = Instant::now();
        if paused {
            let pause_start = *self.pause_started.get_or_insert(now);
            return self.initial_offset
                + pause_start
                    .saturating_duration_since(self.started)
                    .saturating_sub(self.paused_total);
        }
        if let Some(pause_start) = self.pause_started.take() {
            self.paused_total += now.saturating_duration_since(pause_start);
        }
        self.initial_offset
            + now
                .saturating_duration_since(self.started)
                .saturating_sub(self.paused_total)
    }
}

fn duration_frames(duration: Duration) -> u64 {
    (duration.as_nanos() * SAMPLE_RATE as u128 / 1_000_000_000) as u64
}

fn write_silence_frames(
    file: &mut std::fs::File,
    frames: u64,
    block_align: usize,
) -> std::result::Result<u64, String> {
    const ZERO_CHUNK: [u8; 16_384] = [0; 16_384];
    let mut bytes_left = frames.saturating_mul(block_align as u64);
    let total = bytes_left;
    while bytes_left > 0 {
        let count = usize::try_from(bytes_left.min(ZERO_CHUNK.len() as u64)).unwrap_or(0);
        file.write_all(&ZERO_CHUNK[..count])
            .map_err(|error| format!("Write timeline silence: {error}"))?;
        bytes_left -= count as u64;
    }
    Ok(total)
}

/// Place a batch of WASAPI packets on the recording clock. Loopback produces
/// no packets before the first sound, so concatenating packets destroys A/V
/// sync. We insert silence for genuine gaps and keep small scheduler jitter
/// continuous to avoid clicks.
fn write_timed_audio_batch(
    file: &mut std::fs::File,
    samples: &mut VecDeque<u8>,
    block_align: usize,
    elapsed: Duration,
    total_data_bytes: &mut u64,
) -> std::result::Result<(), String> {
    let packet_frames = samples.len() as u64 / block_align as u64;
    if packet_frames == 0 {
        samples.clear();
        return Ok(());
    }

    let written_frames = *total_data_bytes / block_align as u64;
    let desired_start = duration_frames(elapsed).saturating_sub(packet_frames);
    let gap = desired_start.saturating_sub(written_frames);
    let tolerance = (SAMPLE_RATE as u64 / 50).max(1); // 20 ms
    if gap > tolerance {
        *total_data_bytes += write_silence_frames(file, gap, block_align)?;
    }

    let complete_bytes = packet_frames * block_align as u64;
    let chunk: Vec<u8> = samples.drain(..complete_bytes as usize).collect();
    file.write_all(&chunk)
        .map_err(|error| format!("Write captured audio: {error}"))?;
    *total_data_bytes += complete_bytes;
    samples.clear();
    Ok(())
}

fn finish_audio_timeline(
    file: &mut std::fs::File,
    elapsed: Duration,
    block_align: usize,
    total_data_bytes: &mut u64,
) -> std::result::Result<(), String> {
    let written_frames = *total_data_bytes / block_align as u64;
    let target_frames = duration_frames(elapsed);
    if target_frames > written_frames {
        *total_data_bytes +=
            write_silence_frames(file, target_frames - written_frames, block_align)?;
    }
    Ok(())
}

// ── System loopback capture ──────────────────────────────────────────────────

fn endpoint_audio_client(
    enumerator: &DeviceEnumerator,
    device: &Device,
    speaker_device_id: &str,
) -> std::result::Result<AudioClient, String> {
    match device.get_iaudioclient() {
        Ok(client) => Ok(client),
        Err(selected_error) if speaker_device_id != "default" && !speaker_device_id.is_empty() => {
            eprintln!(
                "[Snap Audio] Selected output became unavailable ({selected_error}); falling back to default output"
            );
            enumerator
                .get_default_device(&Direction::Render)
                .and_then(|fallback| fallback.get_iaudioclient())
                .map_err(|fallback_error| {
                    format!(
                        "Selected output failed ({selected_error}); default output also failed: {fallback_error}"
                    )
                })
        }
        Err(error) => Err(format!("Get output IAudioClient: {error}")),
    }
}

fn capture_loopback(
    speaker_device_id: &str,
    output_path: std::path::PathBuf,
    is_recording: Arc<AtomicBool>,
    is_paused: Arc<AtomicBool>,
    timeline_offset: Duration,
    process_id: Option<u32>,
    startup_tx: std::sync::mpsc::Sender<std::result::Result<(), String>>,
) -> std::result::Result<(), String> {
    initialize_mta()
        .ok()
        .map_err(|e| format!("COM init: {e:?}"))?;

    let enumerator = DeviceEnumerator::new().map_err(|e| format!("DeviceEnumerator: {e}"))?;

    let device = if speaker_device_id == "default" || speaker_device_id.is_empty() {
        enumerator
            .get_default_device(&Direction::Render)
            .map_err(|e| format!("Get default render device: {e}"))?
    } else if let Some(idx_str) = speaker_device_id.strip_prefix("speaker:") {
        let idx: usize = idx_str
            .parse()
            .map_err(|_| format!("Invalid speaker device index: {idx_str}"))?;
        let coll = enumerator
            .get_device_collection(&Direction::Render)
            .map_err(|e| format!("Get render device collection: {e}"))?;
        (&coll)
            .into_iter()
            .enumerate()
            .find(|(i, _)| *i == idx)
            .and_then(|(_, d)| d.ok())
            .ok_or_else(|| format!("Speaker device at index {idx} not found"))?
    } else if let Some(device_id) = speaker_device_id.strip_prefix("speaker-id:") {
        enumerator
            .get_device(device_id)
            .map_err(|e| format!("Get selected render device: {e}"))?
    } else {
        return Err(format!(
            "Unknown speaker device ID format: {speaker_device_id}"
        ));
    };

    let dev_name = device
        .get_friendlyname()
        .unwrap_or_else(|_| "unknown".to_string());
    let mut process_loopback = false;
    let mut audio_client = if let Some(target_process_id) = process_id {
        match AudioClient::new_application_loopback_client(target_process_id, true) {
            Ok(client) => {
                process_loopback = true;
                eprintln!(
                    "[Snap Audio] Capturing process {target_process_id} and its child process tree"
                );
                client
            }
            Err(error) => {
                // Process loopback requires Windows 10 build 20348 or newer and
                // may be denied for protected processes. Preserve recording by
                // falling back to the selected render endpoint.
                eprintln!(
                    "[Snap Audio] Process loopback unavailable ({error}); falling back to output \"{dev_name}\""
                );
                endpoint_audio_client(&enumerator, &device, speaker_device_id)?
            }
        }
    } else {
        eprintln!("[Snap Audio] Loopback device: \"{dev_name}\" (full display/region capture)");
        endpoint_audio_client(&enumerator, &device, speaker_device_id)?
    };

    let format = WaveFormat::new(
        BITS_PER_SAMPLE as usize,
        BITS_PER_SAMPLE as usize,
        &SampleType::Int,
        SAMPLE_RATE,
        SYS_CHANNELS as usize,
        None,
    );
    let blockalign = format.get_blockalign();

    // Application loopback intentionally does not expose a device period;
    // event-shared mode ignores this value for the virtual endpoint.
    let buffer_duration_hns = if process_loopback {
        0
    } else {
        audio_client
            .get_device_period()
            .map_err(|e| format!("Get device period: {e}"))?
            .1
    };

    // IMPORTANT: loopback uses Direction::Capture on the client,
    // even though we opened a Render device
    audio_client
        .initialize_client(
            &format,
            &Direction::Capture,
            &StreamMode::EventsShared {
                autoconvert: true,
                buffer_duration_hns,
            },
        )
        .map_err(|e| format!("Init loopback client: {e}"))?;

    let h_event = audio_client
        .set_get_eventhandle()
        .map_err(|e| format!("Get event handle: {e}"))?;

    // The virtual process-loopback client reports a nonsensical multi-billion
    // frame buffer size. Use a modest queue and grow it only when packets arrive.
    let buffer_frame_count = if process_loopback {
        4_800
    } else {
        audio_client
            .get_buffer_size()
            .map_err(|e| format!("Get buffer size: {e}"))?
    };

    let capture_client = audio_client
        .get_audiocaptureclient()
        .map_err(|e| format!("Get capture client: {e}"))?;

    audio_client
        .start_stream()
        .map_err(|e| format!("Start loopback stream: {e}"))?;

    let mut sample_queue: VecDeque<u8> = VecDeque::with_capacity(
        100 * blockalign as usize * (1024 + 2 * buffer_frame_count as usize),
    );

    // Stream audio directly to disk instead of accumulating in memory.
    // Write a WAV header with placeholder size, then stream samples, then
    // seek back and finalize the header with the actual data size.
    let mut file =
        std::fs::File::create(&output_path).map_err(|e| format!("Create loopback WAV: {e}"))?;
    write_wav_header(&mut file, SYS_CHANNELS, 0)
        .map_err(|e| format!("Write loopback WAV header: {e}"))?;
    let _ = startup_tx.send(Ok(()));

    let mut total_data_bytes: u64 = 0;
    let mut batch_count: u64 = 0;
    let mut timeline = AudioTimelineClock::new(timeline_offset);

    eprintln!("[Snap Audio] Loopback stream started, capturing...");

    while is_recording.load(Ordering::Relaxed) {
        // Event-driven capture avoids repeatedly polling an empty WASAPI
        // buffer on high-refresh systems. A timeout simply lets us re-check
        // the recording flag.
        if h_event.wait_for_event(100).is_err() {
            let _ = timeline.elapsed(is_paused.load(Ordering::Relaxed));
            continue;
        }
        sample_queue.clear();
        let mut discontinuity = false;
        while capture_client
            .get_next_packet_size()
            .map_err(|e| format!("Loopback packet size: {e}"))?
            .is_some_and(|frames| frames > 0)
        {
            let packet_start = sample_queue.len();
            let info = capture_client
                .read_from_device_to_deque(&mut sample_queue)
                .map_err(|e| format!("Loopback read: {e}"))?;
            if info.flags.silent {
                for sample in sample_queue.iter_mut().skip(packet_start) {
                    *sample = 0;
                }
            }
            discontinuity |= info.flags.data_discontinuity;
        }

        let paused = is_paused.load(Ordering::Relaxed);
        let elapsed = timeline.elapsed(paused);
        if paused {
            sample_queue.clear();
            continue;
        }
        if discontinuity {
            eprintln!("[Snap Audio] Loopback discontinuity detected; repairing timeline gap");
        }
        if !sample_queue.is_empty() {
            write_timed_audio_batch(
                &mut file,
                &mut sample_queue,
                blockalign as usize,
                elapsed,
                &mut total_data_bytes,
            )?;
            batch_count += 1;
            if batch_count.is_multiple_of(100) {
                eprintln!(
                    "[Snap Audio] loopback batch {batch_count} captured ({:.1} KB)",
                    total_data_bytes as f64 / 1024.0
                );
            }
        }
    }

    audio_client
        .stop_stream()
        .map_err(|e| format!("Stop loopback: {e}"))?;

    let final_elapsed = timeline.elapsed(false);
    finish_audio_timeline(
        &mut file,
        final_elapsed,
        blockalign as usize,
        &mut total_data_bytes,
    )?;

    // Cap at u32::MAX for classic WAV (about 6.2 hours of stereo 16-bit/48 kHz audio).
    let data_size_u32 = if total_data_bytes > u32::MAX as u64 {
        eprintln!("[Snap Audio] WARNING: loopback data exceeds WAV 4GB limit, truncating header");
        u32::MAX
    } else {
        total_data_bytes as u32
    };

    finalize_wav_header(&mut file, data_size_u32)
        .map_err(|e| format!("Finalize loopback WAV header: {e}"))?;

    eprintln!("[Snap Audio] Loopback stopped — {total_data_bytes} bytes streamed to WAV");
    eprintln!("[Snap Audio] Loopback WAV written OK");
    Ok(())
}

// ── Microphone capture ───────────────────────────────────────────────────────

fn capture_microphone(
    mic_device_id: &str,
    output_path: std::path::PathBuf,
    is_recording: Arc<AtomicBool>,
    is_paused: Arc<AtomicBool>,
    is_muted: Arc<AtomicBool>,
    timeline_offset: Duration,
    startup_tx: std::sync::mpsc::Sender<std::result::Result<(), String>>,
) -> std::result::Result<(), String> {
    initialize_mta()
        .ok()
        .map_err(|e| format!("COM init: {e:?}"))?;

    let enumerator = DeviceEnumerator::new().map_err(|e| format!("DeviceEnumerator: {e}"))?;

    // Select the mic device based on the provided ID.
    // "default" or "" → default multimedia capture device, with the
    // communications role as a compatibility fallback.
    // "mic:{index}"   → specific capture device by enumeration index
    let device = if mic_device_id == "default" || mic_device_id.is_empty() {
        enumerator
            .get_default_device_for_role(&Direction::Capture, &Role::Multimedia)
            .or_else(|_| {
                enumerator.get_default_device_for_role(&Direction::Capture, &Role::Communications)
            })
            .map_err(|e| format!("Get default capture device: {e}"))?
    } else if let Some(idx_str) = mic_device_id.strip_prefix("mic:") {
        let idx: usize = idx_str
            .parse()
            .map_err(|_| format!("Invalid mic device index: {idx_str}"))?;
        let coll = enumerator
            .get_device_collection(&Direction::Capture)
            .map_err(|e| format!("Get capture device collection: {e}"))?;
        (&coll)
            .into_iter()
            .enumerate()
            .find(|(i, _)| *i == idx)
            .and_then(|(_, d)| d.ok())
            .ok_or_else(|| format!("Mic device at index {idx} not found"))?
    } else if let Some(device_id) = mic_device_id.strip_prefix("mic-id:") {
        enumerator
            .get_device(device_id)
            .map_err(|e| format!("Get selected microphone: {e}"))?
    } else {
        return Err(format!("Unknown mic device ID format: {mic_device_id}"));
    };

    let dev_name = device
        .get_friendlyname()
        .unwrap_or_else(|_| "unknown".to_string());
    eprintln!("[Snap Audio] Mic device: \"{dev_name}\" (id={mic_device_id})");

    let mut audio_client = match device.get_iaudioclient() {
        Ok(client) => client,
        Err(selected_error) if mic_device_id != "default" && !mic_device_id.is_empty() => {
            eprintln!("[Snap Audio] Selected microphone became unavailable ({selected_error}); falling back to default microphone");
            enumerator.get_default_device_for_role(&Direction::Capture, &Role::Multimedia)
                .or_else(|_| enumerator.get_default_device_for_role(&Direction::Capture, &Role::Communications))
                .and_then(|fallback| fallback.get_iaudioclient())
                .map_err(|fallback_error| format!("Selected microphone failed ({selected_error}); default microphone also failed: {fallback_error}"))?
        }
        Err(error) => return Err(format!("Get microphone IAudioClient: {error}")),
    };

    let format = WaveFormat::new(
        BITS_PER_SAMPLE as usize,
        BITS_PER_SAMPLE as usize,
        &SampleType::Int,
        SAMPLE_RATE,
        MIC_CHANNELS as usize,
        None,
    );
    let blockalign = format.get_blockalign();

    let (_, min_time) = audio_client
        .get_device_period()
        .map_err(|e| format!("Get device period: {e}"))?;

    audio_client
        .initialize_client(
            &format,
            &Direction::Capture,
            &StreamMode::EventsShared {
                autoconvert: true,
                buffer_duration_hns: min_time,
            },
        )
        .map_err(|e| format!("Init mic client: {e}"))?;

    let h_event = audio_client
        .set_get_eventhandle()
        .map_err(|e| format!("Get event handle: {e}"))?;

    let buffer_frame_count = audio_client
        .get_buffer_size()
        .map_err(|e| format!("Get buffer size: {e}"))?;

    let capture_client = audio_client
        .get_audiocaptureclient()
        .map_err(|e| format!("Get capture client: {e}"))?;

    audio_client
        .start_stream()
        .map_err(|e| format!("Start mic stream: {e}"))?;

    let mut sample_queue: VecDeque<u8> = VecDeque::with_capacity(
        100 * blockalign as usize * (1024 + 2 * buffer_frame_count as usize),
    );

    // Stream mic audio directly to disk (same pattern as loopback).
    let mut file =
        std::fs::File::create(&output_path).map_err(|e| format!("Create mic WAV: {e}"))?;
    write_wav_header(&mut file, MIC_CHANNELS, 0)
        .map_err(|e| format!("Write mic WAV header: {e}"))?;
    let _ = startup_tx.send(Ok(()));

    let mut total_data_bytes: u64 = 0;
    let mut batch_count: u64 = 0;
    let mut timeline = AudioTimelineClock::new(timeline_offset);

    eprintln!("[Snap Audio] Mic stream started, capturing...");

    while is_recording.load(Ordering::Relaxed) {
        if h_event.wait_for_event(100).is_err() {
            let _ = timeline.elapsed(is_paused.load(Ordering::Relaxed));
            continue;
        }
        sample_queue.clear();
        let mut discontinuity = false;
        while capture_client
            .get_next_packet_size()
            .map_err(|e| format!("Mic packet size: {e}"))?
            .is_some_and(|frames| frames > 0)
        {
            let packet_start = sample_queue.len();
            let info = capture_client
                .read_from_device_to_deque(&mut sample_queue)
                .map_err(|e| format!("Mic read: {e}"))?;
            if info.flags.silent {
                for sample in sample_queue.iter_mut().skip(packet_start) {
                    *sample = 0;
                }
            }
            discontinuity |= info.flags.data_discontinuity;
        }

        let paused = is_paused.load(Ordering::Relaxed);
        let elapsed = timeline.elapsed(paused);
        if paused {
            sample_queue.clear();
            continue;
        }
        if is_muted.load(Ordering::Relaxed) {
            sample_queue.make_contiguous().fill(0);
        }
        if discontinuity {
            eprintln!("[Snap Audio] Microphone discontinuity detected; repairing timeline gap");
        }
        if !sample_queue.is_empty() {
            write_timed_audio_batch(
                &mut file,
                &mut sample_queue,
                blockalign as usize,
                elapsed,
                &mut total_data_bytes,
            )?;
            batch_count += 1;
            if batch_count.is_multiple_of(100) {
                eprintln!(
                    "[Snap Audio] mic batch {batch_count} captured ({:.1} KB)",
                    total_data_bytes as f64 / 1024.0
                );
            }
        }
    }

    audio_client
        .stop_stream()
        .map_err(|e| format!("Stop mic: {e}"))?;

    let final_elapsed = timeline.elapsed(false);
    finish_audio_timeline(
        &mut file,
        final_elapsed,
        blockalign as usize,
        &mut total_data_bytes,
    )?;

    let data_size_u32 = if total_data_bytes > u32::MAX as u64 {
        eprintln!("[Snap Audio] WARNING: mic data exceeds WAV 4GB limit, truncating header");
        u32::MAX
    } else {
        total_data_bytes as u32
    };

    finalize_wav_header(&mut file, data_size_u32)
        .map_err(|e| format!("Finalize mic WAV header: {e}"))?;

    eprintln!("[Snap Audio] Mic stopped — {total_data_bytes} bytes streamed to WAV");
    eprintln!("[Snap Audio] Mic WAV written OK");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duration_frames_uses_video_sample_rate() {
        assert_eq!(duration_frames(Duration::from_secs(20)), 960_000);
        assert_eq!(duration_frames(Duration::from_millis(10)), 480);
    }

    #[test]
    fn timed_batch_preserves_silence_before_first_sound() {
        let path = std::env::temp_dir().join(format!(
            "snap-audio-timeline-{}-{}.raw",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut file = std::fs::File::create(&path).unwrap();
        let block_align = 4usize;
        let packet_frames = 480usize;
        let mut samples = VecDeque::from(vec![0x5a; packet_frames * block_align]);
        let mut written = 0u64;

        write_timed_audio_batch(
            &mut file,
            &mut samples,
            block_align,
            Duration::from_millis(20_010),
            &mut written,
        )
        .unwrap();
        file.flush().unwrap();

        assert_eq!(written, (960_000 + packet_frames as u64) * 4);
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(bytes[0], 0);
        assert_eq!(bytes[960_000 * block_align], 0x5a);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn waveform_does_not_cancel_opposite_phase_stereo() {
        let path = std::env::temp_dir().join(format!(
            "snap-waveform-antiphase-{}-{}.wav",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let frame_count = 320u32;
        let data_size = frame_count * 4;
        let mut file = std::fs::File::create(&path).unwrap();
        write_wav_header(&mut file, 2, data_size).unwrap();
        for _ in 0..frame_count {
            file.write_all(&12_000i16.to_le_bytes()).unwrap();
            file.write_all(&(-12_000i16).to_le_bytes()).unwrap();
        }
        file.flush().unwrap();
        drop(file);

        let waveform = audio_waveform(path.to_string_lossy().to_string(), Some(16)).unwrap();
        assert_eq!(waveform.len(), 16);
        assert!(waveform.iter().all(|value| *value > 0.3));
        std::fs::remove_file(path).unwrap();
    }
}
