//! Small, ephemeral native input meter. No files, FFmpeg or editor analysis.
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use wasapi::*;

struct Meter {
    device: String,
    stop: Arc<AtomicBool>,
    lease: Arc<Mutex<Instant>>,
    level: Arc<AtomicU32>,
    worker: thread::JoinHandle<()>,
    started: Instant,
}
static METER: Mutex<Option<Meter>> = Mutex::new(None);

#[tauri::command]
pub async fn microphone_preview_level(mic_device_id: String) -> Result<f32, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut state = METER.lock().map_err(|_| "Microphone meter unavailable")?;
        let recording = crate::recording_session::get_recording_session_state()
            .ok()
            .flatten()
            .is_some();
        let disabled = mic_device_id == "disabled" || recording;
        let replace = state.as_ref().is_some_and(|m| {
            disabled
                || m.device != mic_device_id
                || (m.worker.is_finished() && m.started.elapsed() > Duration::from_secs(2))
        });
        if replace {
            if let Some(old) = state.take() {
                old.stop.store(true, Ordering::Relaxed);
                let _ = old.worker.join();
            }
        }
        if disabled {
            return Ok(0.0);
        }
        if state.is_none() {
            let stop = Arc::new(AtomicBool::new(false));
            let lease = Arc::new(Mutex::new(Instant::now()));
            let level = Arc::new(AtomicU32::new(0));
            let (s, l, v, id) = (
                stop.clone(),
                lease.clone(),
                level.clone(),
                mic_device_id.clone(),
            );
            let worker = thread::spawn(move || {
                if initialize_mta().is_err() {
                    return;
                }
                let _ = meter_stream(&id, &s, &l, &v);
                v.store(0, Ordering::Relaxed);
                deinitialize();
            });
            *state = Some(Meter {
                device: mic_device_id,
                stop,
                lease,
                level,
                worker,
                started: Instant::now(),
            });
        }
        let meter = state.as_ref().ok_or("Microphone meter unavailable")?;
        *meter
            .lease
            .lock()
            .map_err(|_| "Microphone meter unavailable")? = Instant::now();
        Ok(f32::from_bits(meter.level.load(Ordering::Relaxed)))
    })
    .await
    .map_err(|_| "Microphone meter worker unavailable".to_string())?
}

fn meter_stream(
    id: &str,
    stop: &AtomicBool,
    lease: &Mutex<Instant>,
    level: &AtomicU32,
) -> Result<(), String> {
    let enumerator = DeviceEnumerator::new().map_err(|e| e.to_string())?;
    let device = if id.is_empty() || id == "default" {
        enumerator
            .get_default_device_for_role(&Direction::Capture, &Role::Multimedia)
            .or_else(|_| {
                enumerator.get_default_device_for_role(&Direction::Capture, &Role::Communications)
            })
    } else if let Some(id) = id.strip_prefix("mic-id:") {
        enumerator.get_device(id)
    } else {
        return Err("Unsupported microphone".into());
    }
    .map_err(|e| e.to_string())?;
    let mut client = device.get_iaudioclient().map_err(|e| e.to_string())?;
    let format = WaveFormat::new(16, 16, &SampleType::Int, 48000, 1, None);
    client
        .initialize_client(
            &format,
            &Direction::Capture,
            &StreamMode::EventsShared {
                autoconvert: true,
                buffer_duration_hns: 100_000,
            },
        )
        .map_err(|e| e.to_string())?;
    let event = client.set_get_eventhandle().map_err(|e| e.to_string())?;
    let capture = client.get_audiocaptureclient().map_err(|e| e.to_string())?;
    client.start_stream().map_err(|e| e.to_string())?;
    let mut queue = VecDeque::with_capacity(8192);
    let result = (|| {
        while !stop.load(Ordering::Relaxed)
            && lease
                .lock()
                .is_ok_and(|l| l.elapsed() < Duration::from_secs(2))
            && crate::recording_session::get_recording_session_state()
                .ok()
                .flatten()
                .is_none()
        {
            let _ = event.wait_for_event(100);
            let mut peak = 0.0f32;
            while capture
                .get_next_packet_size()
                .map_err(|e| e.to_string())?
                .is_some_and(|n| n > 0)
            {
                queue.clear();
                let packet = capture
                    .read_from_device_to_deque(&mut queue)
                    .map_err(|e| e.to_string())?;
                if !packet.flags.silent {
                    peak = peak.max(pcm_peak(queue.make_contiguous()));
                }
            }
            level.store(peak.to_bits(), Ordering::Relaxed);
        }
        Ok(())
    })();
    let _ = client.stop_stream();
    result
}
fn pcm_peak(bytes: &[u8]) -> f32 {
    bytes
        .chunks_exact(2)
        .map(|s| (i16::from_le_bytes([s[0], s[1]]) as f32 / 32768.0).abs())
        .fold(0.0, f32::max)
}
#[cfg(test)]
mod tests {
    #[test]
    fn peak_is_bounded_and_handles_silence_and_negative_full_scale() {
        assert_eq!(super::pcm_peak(&[]), 0.0);
        assert_eq!(super::pcm_peak(&[0, 0, 0]), 0.0);
        assert_eq!(super::pcm_peak(&[0, 128]), 1.0);
        assert_eq!(super::pcm_peak(&[0, 64]), 0.5);
    }
}
