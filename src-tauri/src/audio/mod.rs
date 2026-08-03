use std::collections::VecDeque;
use std::io::Write;
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
    done_rx: tokio::sync::oneshot::Receiver<std::result::Result<(), String>>,
}

static AUDIO_STATE: Mutex<Option<AudioCaptureHandle>> = Mutex::new(None);

// ── Enumerate devices ────────────────────────────────────────────────────────

#[tauri::command]
pub fn enumerate_audio_devices() -> std::result::Result<Vec<AudioDevice>, String> {
    eprintln!("[Snap Audio] Step 1: enumerating audio devices...");

    let _ = initialize_mta();

    let enumerator = DeviceEnumerator::new()
        .map_err(|e| format!("DeviceEnumerator failed: {e}"))?;

    let mut devices = Vec::new();

    // Microphones (capture devices)
    if let Ok(coll) = enumerator.get_device_collection(&Direction::Capture) {
        for (i, result) in (&coll).into_iter().enumerate() {
            if let Ok(dev) = result {
                if let Ok(name) = dev.get_friendlyname() {
                    devices.push(AudioDevice {
                        id: format!("mic:{i}"),
                        name,
                        device_type: "microphone".to_string(),
                    });
                }
            }
        }
    }

    // Speakers (render devices, for loopback target — we use default)
    if let Ok(coll) = enumerator.get_device_collection(&Direction::Render) {
        for (i, result) in (&coll).into_iter().enumerate() {
            if let Ok(dev) = result {
                if let Ok(name) = dev.get_friendlyname() {
                    devices.push(AudioDevice {
                        id: format!("speaker:{i}"),
                        name,
                        device_type: "speaker".to_string(),
                    });
                }
            }
        }
    }

    eprintln!(
        "[Snap Audio] Step 1: found {} devices",
        devices.len()
    );
    Ok(devices)
}

// ── Start audio capture (async) ──────────────────────────────────────────────

#[tauri::command]
pub async fn start_audio_capture(
    mic_device_id: String,
    output_dir: String,
) -> std::result::Result<(), String> {
    let mut guard = AUDIO_STATE.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Err("Audio capture already in progress".to_string());
    }

    let is_recording = Arc::new(AtomicBool::new(true));
    let (done_tx, done_rx) = tokio::sync::oneshot::channel();
    let is_rec_clone = is_recording.clone();

    tokio::task::spawn_blocking(move || {
        let result = run_audio_threads(&mic_device_id, &output_dir, is_rec_clone);
        let _ = done_tx.send(result);
    });

    *guard = Some(AudioCaptureHandle {
        is_recording,
        done_rx,
    });

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
    output_dir: &str,
    is_recording: Arc<AtomicBool>,
) -> std::result::Result<(), String> {
    let out_dir = std::path::PathBuf::from(output_dir);
    let mic_id = mic_device_id.to_string();
    std::fs::create_dir_all(&out_dir)
        .map_err(|e| format!("Failed to create output dir: {e}"))?;

    let sys_path = out_dir.join("system_audio.wav");
    let mic_path = out_dir.join("mic_audio.wav");

    let sys_rec = is_recording.clone();
    let mic_rec = is_recording.clone();

    let sys_file = sys_path.clone();
    let mic_file = mic_path.clone();

    eprintln!(
        "[Snap Audio] Step 2: starting system loopback capture -> {}",
        sys_file.display()
    );
    let sys_handle = thread::spawn(move || {
        if let Err(e) = capture_loopback(sys_file, sys_rec) {
            eprintln!("[Snap Audio] System loopback error: {e}");
        }
    });

    eprintln!(
        "[Snap Audio] Step 3: starting mic capture ({mic_id}) -> {}",
        mic_file.display()
    );
    let mic_handle = thread::spawn(move || {
        if let Err(e) = capture_microphone(&mic_id, mic_file, mic_rec) {
            eprintln!("[Snap Audio] Mic capture error: {e}");
        }
    });

    // Wait for both threads
    let _ = sys_handle.join();
    let _ = mic_handle.join();

    // Verify output files
    let mut errors = Vec::new();
    for (label, path) in [
        ("system audio", &sys_path),
        ("mic audio", &mic_path),
    ] {
        let exists = path.exists();
        let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        eprintln!(
            "[Snap Audio] {label} output: exists={exists}, size={size} bytes"
        );
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

// ── WAV writer ───────────────────────────────────────────────────────────────

const SAMPLE_RATE: usize = 44100;
const SYS_CHANNELS: u16 = 2;
const MIC_CHANNELS: u16 = 1;
const BITS_PER_SAMPLE: u16 = 16;

fn write_wav(
    path: &std::path::Path,
    samples: &[u8],
    channels: u16,
) -> std::result::Result<(), std::io::Error> {
    let data_size = samples.len() as u32;
    let sample_rate = SAMPLE_RATE as u32;
    let byte_rate = sample_rate * channels as u32 * (BITS_PER_SAMPLE / 8) as u32;
    let block_align = channels * (BITS_PER_SAMPLE / 8);

    let mut f = std::fs::File::create(path)?;

    // RIFF header: 4 bytes "RIFF" + 4 bytes file size (36 + data_size) + 4 bytes "WAVE"
    f.write_all(b"RIFF")?;
    f.write_all(&(36u32 + data_size).to_le_bytes())?;
    f.write_all(b"WAVE")?;

    // fmt  chunk: 4 bytes "fmt " + 4 bytes chunk size (16) + 16 bytes format data
    f.write_all(b"fmt ")?;
    f.write_all(&16u32.to_le_bytes())?;       // chunk size
    f.write_all(&1u16.to_le_bytes())?;         // PCM = 1
    f.write_all(&channels.to_le_bytes())?;      // channels (u16 LE)
    f.write_all(&sample_rate.to_le_bytes())?;   // sample rate (u32 LE)
    f.write_all(&byte_rate.to_le_bytes())?;     // byte rate (u32 LE)
    f.write_all(&block_align.to_le_bytes())?;   // block align (u16 LE)
    f.write_all(&BITS_PER_SAMPLE.to_le_bytes())?; // bits per sample (u16 LE)

    // data chunk: 4 bytes "data" + 4 bytes data size + PCM samples
    f.write_all(b"data")?;
    f.write_all(&data_size.to_le_bytes())?;
    f.write_all(samples)?;

    Ok(())
}

// ── System loopback capture ──────────────────────────────────────────────────

fn capture_loopback(
    output_path: std::path::PathBuf,
    is_recording: Arc<AtomicBool>,
) -> std::result::Result<(), String> {
    initialize_mta()
        .ok()
        .map_err(|e| format!("COM init: {e:?}"))?;

    let enumerator =
        DeviceEnumerator::new().map_err(|e| format!("DeviceEnumerator: {e}"))?;

    // Loopback: capture from the default RENDER device (system output)
    let device = enumerator
        .get_default_device(&Direction::Render)
        .map_err(|e| format!("Get default render device: {e}"))?;

    let dev_name = device
        .get_friendlyname()
        .unwrap_or_else(|_| "unknown".to_string());
    eprintln!(
        "[Snap Audio] Loopback device: \"{dev_name}\" (Direction::Render → loopback capture)"
    );

    let mut audio_client = device
        .get_iaudioclient()
        .map_err(|e| format!("Get IAudioClient: {e}"))?;

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
    let mut all_samples: Vec<u8> = Vec::new();
    let mut batch_count: u64 = 0;

    eprintln!("[Snap Audio] Loopback stream started, capturing...");

    while is_recording.load(Ordering::Relaxed) {
        capture_client
            .read_from_device_to_deque(&mut sample_queue)
            .map_err(|e| format!("Loopback read: {e}"))?;

        // Drain queue into buffer
        while sample_queue.len() > blockalign as usize * 512 {
            for _ in 0..(blockalign as usize * 512) {
                if let Some(b) = sample_queue.pop_front() {
                    all_samples.push(b);
                }
            }
            batch_count += 1;
            if batch_count % 50 == 0 {
                eprintln!(
                    "[Snap Audio] loopback frame batch {batch_count} captured ({:.1} KB)",
                    all_samples.len() as f64 / 1024.0
                );
            }
        }

        // Wait for more data with a short timeout so we can check is_recording
        if h_event.wait_for_event(100).is_err() {
            // Timeout or error — loop to check is_recording
        }
    }

    audio_client
        .stop_stream()
        .map_err(|e| format!("Stop loopback: {e}"))?;

    eprintln!(
        "[Snap Audio] Loopback stopped — writing {} bytes to WAV",
        all_samples.len()
    );
    write_wav(&output_path, &all_samples, SYS_CHANNELS)
        .map_err(|e| format!("Write loopback WAV: {e}"))?;

    eprintln!("[Snap Audio] Loopback WAV written OK");
    Ok(())
}

// ── Microphone capture ───────────────────────────────────────────────────────

fn capture_microphone(
    _mic_device_id: &str,
    output_path: std::path::PathBuf,
    is_recording: Arc<AtomicBool>,
) -> std::result::Result<(), String> {
    // A dedicated microphone device. Using Role::Communications (e.g. headset mic)
    // avoids accidentally picking up "Stereo Mix" or other virtual loopback devices
    // that sometimes masquerade as the default Capture endpoint.
    initialize_mta()
        .ok()
        .map_err(|e| format!("COM init: {e:?}"))?;

    let enumerator =
        DeviceEnumerator::new().map_err(|e| format!("DeviceEnumerator: {e}"))?;

    let device = enumerator
        .get_default_device_for_role(&Direction::Capture, &Role::Communications)
        .map_err(|e| format!("Get default capture device (Communications): {e}"))?;

    let dev_name = device
        .get_friendlyname()
        .unwrap_or_else(|_| "unknown".to_string());
    eprintln!(
        "[Snap Audio] Mic device: \"{dev_name}\" (Direction::Capture, Role::Communications)"
    );

    let mut audio_client = device
        .get_iaudioclient()
        .map_err(|e| format!("Get IAudioClient: {e}"))?;

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
    let mut all_samples: Vec<u8> = Vec::new();
    let mut batch_count: u64 = 0;

    eprintln!("[Snap Audio] Mic stream started, capturing...");

    while is_recording.load(Ordering::Relaxed) {
        capture_client
            .read_from_device_to_deque(&mut sample_queue)
            .map_err(|e| format!("Mic read: {e}"))?;

        while sample_queue.len() > blockalign as usize * 512 {
            for _ in 0..(blockalign as usize * 512) {
                if let Some(b) = sample_queue.pop_front() {
                    all_samples.push(b);
                }
            }
            batch_count += 1;
            if batch_count % 50 == 0 {
                eprintln!(
                    "[Snap Audio] mic frame batch {batch_count} captured ({:.1} KB)",
                    all_samples.len() as f64 / 1024.0
                );
            }
        }

        if h_event.wait_for_event(100).is_err() {
            // loop to check is_recording
        }
    }

    audio_client
        .stop_stream()
        .map_err(|e| format!("Stop mic: {e}"))?;

    eprintln!(
        "[Snap Audio] Mic stopped — writing {} bytes to WAV",
        all_samples.len()
    );
    write_wav(&output_path, &all_samples, MIC_CHANNELS)
        .map_err(|e| format!("Write mic WAV: {e}"))?;

    eprintln!("[Snap Audio] Mic WAV written OK");
    Ok(())
}
