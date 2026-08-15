use std::collections::VecDeque;
use std::io::{Seek, SeekFrom, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

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
        for result in &coll {
            if let Ok(dev) = result {
                if let (Ok(name), Ok(id)) = (dev.get_friendlyname(), dev.get_id()) {
                    devices.push(AudioDevice {
                        id: format!("mic-id:{id}"),
                        name,
                        device_type: "microphone".to_string(),
                    });
                }
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
        for result in &coll {
            if let Ok(dev) = result {
                if let (Ok(name), Ok(id)) = (dev.get_friendlyname(), dev.get_id()) {
                    devices.push(AudioDevice {
                        id: format!("speaker-id:{id}"),
                        name,
                        device_type: "speaker".to_string(),
                    });
                }
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

    // Use std::thread::spawn for a fresh thread with no prior COM initialization.
    thread::spawn(move || {
        let result = run_audio_threads(
            &mic_device_id,
            &speaker_device_id,
            &output_dir,
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
    mic_device_id: &str,
    speaker_device_id: &str,
    output_dir: &str,
    is_recording: Arc<AtomicBool>,
    is_paused: Arc<AtomicBool>,
    mic_muted: Arc<AtomicBool>,
    startup_tx: std::sync::mpsc::Sender<std::result::Result<(), String>>,
) -> std::result::Result<(), String> {
    let out_dir = std::path::PathBuf::from(output_dir);
    let mic_id = mic_device_id.to_string();
    let speaker_id = speaker_device_id.to_string();
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
            let result =
                capture_loopback(&speaker_id, sys_file, sys_rec, sys_paused, startup.clone());
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
        } else if size == 0 {
            errors.push(format!("{label} file is empty: {}", path.display()));
        }
    }

    if !errors.is_empty() {
        return Err(errors.join("; "));
    }

    eprintln!("[Snap Audio] Capture complete");
    Ok(())
}

// ── WAV helpers ──────────────────────────────────────────────────────────────

const SAMPLE_RATE: usize = 44100;
const SYS_CHANNELS: u16 = 2;
const MIC_CHANNELS: u16 = 1;
const BITS_PER_SAMPLE: u16 = 16;

#[tauri::command]
pub fn audio_waveform(path: String, buckets: Option<usize>) -> std::result::Result<Vec<f32>, String> {
    let bytes = std::fs::read(&path).map_err(|error| format!("Unable to read audio track {path}: {error}"))?;
    let bucket_count = buckets.unwrap_or(220).clamp(16, 2_000);
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("Audio track is not a valid WAV file".to_string());
    }
    let mut cursor = 12usize;
    let mut channels = 1usize;
    let mut bits = 16usize;
    let mut data = None;
    while cursor + 8 <= bytes.len() {
        let size = u32::from_le_bytes(bytes[cursor + 4..cursor + 8].try_into().unwrap()) as usize;
        let start = cursor + 8;
        let end = start.saturating_add(size).min(bytes.len());
        match &bytes[cursor..cursor + 4] {
            b"fmt " if size >= 16 && start + 16 <= bytes.len() => {
                channels = u16::from_le_bytes(bytes[start + 2..start + 4].try_into().unwrap()) as usize;
                bits = u16::from_le_bytes(bytes[start + 14..start + 16].try_into().unwrap()) as usize;
            }
            b"data" => { data = Some((start, end)); break; }
            _ => {}
        }
        cursor = start.saturating_add(size).saturating_add(size % 2);
    }
    if bits != 16 || channels == 0 {
        return Err(format!("Unsupported WAV format: {bits}-bit, {channels} channels"));
    }
    let (start, end) = data.ok_or_else(|| "Audio track contains no sample data".to_string())?;
    let frame_bytes = channels * 2;
    let frames = (end - start) / frame_bytes;
    if frames == 0 { return Ok(vec![]); }
    let mut result = vec![0f32; bucket_count];
    for (bucket, value) in result.iter_mut().enumerate() {
        let from = frames * bucket / bucket_count;
        let to = (frames * (bucket + 1) / bucket_count).max(from + 1).min(frames);
        let stride = ((to - from) / 512).max(1);
        let mut sum = 0f64;
        let mut count = 0usize;
        for frame in (from..to).step_by(stride) {
            let mut mixed = 0f64;
            for channel in 0..channels {
                let offset = start + frame * frame_bytes + channel * 2;
                mixed += i16::from_le_bytes([bytes[offset], bytes[offset + 1]]) as f64 / 32768.0;
            }
            mixed /= channels as f64;
            sum += mixed * mixed;
            count += 1;
        }
        *value = if count == 0 { 0.0 } else { (sum / count as f64).sqrt().min(1.0) as f32 };
    }
    Ok(result)
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

// ── System loopback capture ──────────────────────────────────────────────────

fn capture_loopback(
    speaker_device_id: &str,
    output_path: std::path::PathBuf,
    is_recording: Arc<AtomicBool>,
    is_paused: Arc<AtomicBool>,
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
    eprintln!(
        "[Snap Audio] Loopback device: \"{dev_name}\" (Direction::Render → loopback capture)"
    );

    let mut audio_client = match device.get_iaudioclient() {
        Ok(client) => client,
        Err(selected_error) if speaker_device_id != "default" && !speaker_device_id.is_empty() => {
            eprintln!("[Snap Audio] Selected output became unavailable ({selected_error}); falling back to default output");
            enumerator.get_default_device(&Direction::Render)
                .and_then(|fallback| fallback.get_iaudioclient())
                .map_err(|fallback_error| format!("Selected output failed ({selected_error}); default output also failed: {fallback_error}"))?
        }
        Err(error) => return Err(format!("Get output IAudioClient: {error}")),
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

    let (_, min_time) = audio_client
        .get_device_period()
        .map_err(|e| format!("Get device period: {e}"))?;

    // IMPORTANT: loopback uses Direction::Capture on the client,
    // even though we opened a Render device
    audio_client
        .initialize_client(
            &format,
            &Direction::Capture,
            &StreamMode::EventsShared {
                autoconvert: true,
                buffer_duration_hns: min_time,
            },
        )
        .map_err(|e| format!("Init loopback client: {e}"))?;

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

    eprintln!("[Snap Audio] Loopback stream started, capturing...");

    while is_recording.load(Ordering::Relaxed) {
        capture_client
            .read_from_device_to_deque(&mut sample_queue)
            .map_err(|e| format!("Loopback read: {e}"))?;

        // While paused, drop incoming samples so the WAV timeline matches the
        // video timeline (which omits the paused segment).
        if !is_paused.load(Ordering::Relaxed) {
            // Drain queue directly to disk
            while sample_queue.len() > blockalign as usize * 512 {
                let chunk_size = blockalign as usize * 512;
                let chunk: Vec<u8> = sample_queue.drain(..chunk_size).collect();
                file.write_all(&chunk)
                    .map_err(|e| format!("Write loopback chunk: {e}"))?;
                total_data_bytes += chunk_size as u64;
                batch_count += 1;
                if batch_count.is_multiple_of(50) {
                    eprintln!(
                        "[Snap Audio] loopback frame batch {batch_count} captured ({:.1} KB)",
                        total_data_bytes as f64 / 1024.0
                    );
                }
            }
        } else {
            sample_queue.clear();
        }

        // Wait for more data with a short timeout so we can check is_recording
        if h_event.wait_for_event(100).is_err() {
            // Timeout or error — loop to check is_recording
        }
    }

    audio_client
        .stop_stream()
        .map_err(|e| format!("Stop loopback: {e}"))?;

    // Flush any remaining samples in the queue
    if !sample_queue.is_empty() {
        let remaining: Vec<u8> = sample_queue.drain(..).collect();
        total_data_bytes += remaining.len() as u64;
        file.write_all(&remaining)
            .map_err(|e| format!("Write loopback remaining: {e}"))?;
    }

    // Cap at u32::MAX for WAV format (handles recordings up to ~49 hours stereo 16-bit 44.1kHz)
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
    startup_tx: std::sync::mpsc::Sender<std::result::Result<(), String>>,
) -> std::result::Result<(), String> {
    initialize_mta()
        .ok()
        .map_err(|e| format!("COM init: {e:?}"))?;

    let enumerator = DeviceEnumerator::new().map_err(|e| format!("DeviceEnumerator: {e}"))?;

    // Select the mic device based on the provided ID.
    // "default" or "" → default Communications capture device
    // "mic:{index}"   → specific capture device by enumeration index
    let device = if mic_device_id == "default" || mic_device_id.is_empty() {
        enumerator
            .get_default_device_for_role(&Direction::Capture, &Role::Communications)
            .map_err(|e| format!("Get default capture device (Communications): {e}"))?
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
            enumerator.get_default_device_for_role(&Direction::Capture, &Role::Communications)
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

    eprintln!("[Snap Audio] Mic stream started, capturing...");

    while is_recording.load(Ordering::Relaxed) {
        capture_client
            .read_from_device_to_deque(&mut sample_queue)
            .map_err(|e| format!("Mic read: {e}"))?;

        if !is_paused.load(Ordering::Relaxed) {
            while sample_queue.len() > blockalign as usize * 512 {
                let chunk_size = blockalign as usize * 512;
                let mut chunk: Vec<u8> = sample_queue.drain(..chunk_size).collect();
                if is_muted.load(Ordering::Relaxed) {
                    chunk.fill(0);
                }
                file.write_all(&chunk)
                    .map_err(|e| format!("Write mic chunk: {e}"))?;
                total_data_bytes += chunk_size as u64;
                batch_count += 1;
                if batch_count.is_multiple_of(50) {
                    eprintln!(
                        "[Snap Audio] mic frame batch {batch_count} captured ({:.1} KB)",
                        total_data_bytes as f64 / 1024.0
                    );
                }
            }
        } else {
            sample_queue.clear();
        }

        if h_event.wait_for_event(100).is_err() {
            // loop to check is_recording
        }
    }

    audio_client
        .stop_stream()
        .map_err(|e| format!("Stop mic: {e}"))?;

    // Flush remaining samples
    if !sample_queue.is_empty() {
        let remaining: Vec<u8> = sample_queue.drain(..).collect();
        total_data_bytes += remaining.len() as u64;
        file.write_all(&remaining)
            .map_err(|e| format!("Write mic remaining: {e}"))?;
    }

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
