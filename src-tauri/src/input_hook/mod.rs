use std::fs::File;
use std::io::{BufWriter, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use rdev::EventType;
use serde::Serialize;
use windows::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};

// ── Globals — one persistent hook, one active writer ─────────────────────────

/// Set to true while we want events logged. Toggled by start/stop commands.
static IS_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Set to true while the recording is paused — events are dropped so the log
/// timeline matches the video timeline (which omits the paused segment).
static IS_PAUSED: AtomicBool = AtomicBool::new(false);
static PAUSE_STARTED: Mutex<Option<Instant>> = Mutex::new(None);
static PAUSED_ACCUM_MS: AtomicU64 = AtomicU64::new(0);
static CAPTURE_START_MS: AtomicU64 = AtomicU64::new(0);
static CAPTURE_START_QPC_100NS: AtomicU64 = AtomicU64::new(0);

/// The single shared writer. None when not logging, Some when logging.
static ACTIVE_WRITER: Mutex<Option<BufWriter<File>>> = Mutex::new(None);

/// Event counter reset on each start, read on stop.
static EVENT_COUNT: AtomicU64 = AtomicU64::new(0);

/// Mouse-move throttle on the persistent hook's monotonic clock. Atomics keep
/// the Windows hook callback lock-free for high-polling-rate gaming mice.
static HOOK_EPOCH: OnceLock<Instant> = OnceLock::new();
static LAST_MOUSE_US: AtomicU64 = AtomicU64::new(0);

/// Last known mouse position — used to attach coordinates to click events
/// since rdev::ButtonPress/ButtonRelease don't carry position data.
static LAST_POSITION_X: AtomicU64 = AtomicU64::new(0f64.to_bits());
static LAST_POSITION_Y: AtomicU64 = AtomicU64::new(0f64.to_bits());

/// Session start time — reset on each call to start_input_logging so that
/// timestamps are relative to the current recording, not the hook thread's
/// birth time. This fixes the desync on second+ recordings.
static SESSION_START: Mutex<Option<Instant>> = Mutex::new(None);

/// Ensures the rdev::listen thread is spawned exactly once.
static HOOK_STARTED: OnceLock<()> = OnceLock::new();
static EVENT_TX: OnceLock<SyncSender<WriterMessage>> = OnceLock::new();
static SESSION_GENERATION: AtomicU64 = AtomicU64::new(0);
static DROPPED_EVENTS: AtomicU64 = AtomicU64::new(0);

fn active_session_elapsed_ms() -> Option<u64> {
    let session_start = (*SESSION_START.lock().ok()?)?;
    let mut paused_ms = PAUSED_ACCUM_MS.load(Ordering::Relaxed);
    if let Some(pause_started) = *PAUSE_STARTED.lock().ok()? {
        paused_ms = paused_ms.saturating_add(pause_started.elapsed().as_millis() as u64);
    }
    Some((session_start.elapsed().as_millis() as u64).saturating_sub(paused_ms))
}

fn qpc_100ns() -> Option<u64> {
    let mut counter = 0i64;
    let mut frequency = 0i64;
    unsafe {
        QueryPerformanceCounter(&mut counter).ok()?;
        QueryPerformanceFrequency(&mut frequency).ok()?;
    }
    if counter < 0 || frequency <= 0 {
        return None;
    }
    Some((counter as u128 * 10_000_000u128 / frequency as u128) as u64)
}

// ── Log event struct ─────────────────────────────────────────────────────────

#[derive(Serialize)]
struct LogEvent {
    ts: u64,
    #[serde(rename = "type")]
    event_type: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    button: Option<String>,
}

enum WriterMessage {
    Event {
        generation: u64,
        event: LogEvent,
    },
    Flush {
        generation: u64,
        done: std::sync::mpsc::Sender<()>,
    },
}

fn key_name(key: &rdev::Key) -> String {
    format!("{key:?}")
}

fn button_name(btn: &rdev::Button) -> String {
    format!("{btn:?}")
}

// ── Ensure the hook thread exists (called once, idempotent) ─────────────────

fn ensure_hook_started() {
    HOOK_STARTED.get_or_init(|| {
        // The Windows low-level hook must return immediately. JSON encoding and
        // disk writes happen on this bounded worker instead of inside the hook
        // callback, so a slow disk can never stall mouse/keyboard delivery.
        let (event_tx, event_rx) = sync_channel::<WriterMessage>(8_192);
        let _ = EVENT_TX.set(event_tx.clone());
        thread::spawn(move || {
            while let Ok(message) = event_rx.recv() {
                match message {
                    WriterMessage::Event { generation, event } => {
                        if generation != SESSION_GENERATION.load(Ordering::Acquire) {
                            continue;
                        }
                        if let Ok(json) = serde_json::to_string(&event) {
                            if let Ok(mut guard) = ACTIVE_WRITER.lock() {
                                if let Some(ref mut writer) = *guard {
                                    if writeln!(writer, "{json}").is_ok() {
                                        EVENT_COUNT.fetch_add(1, Ordering::Relaxed);
                                    }
                                }
                            }
                        }
                    }
                    WriterMessage::Flush { generation, done } => {
                        if generation == SESSION_GENERATION.load(Ordering::Acquire) {
                            if let Ok(mut guard) = ACTIVE_WRITER.lock() {
                                if let Some(ref mut writer) = *guard {
                                    let _ = writer.flush();
                                }
                            }
                        }
                        let _ = done.send(());
                    }
                }
            }
        });

        thread::spawn(move || {
            eprintln!("[Snap Input] rdev::listen hook started (once, persistent)");

            let callback = move |event: rdev::Event| {
                if !IS_ACTIVE.load(Ordering::Relaxed) {
                    return;
                }
                if IS_PAUSED.load(Ordering::Relaxed) {
                    return;
                }

                let log_event = match event.event_type {
                    EventType::MouseMove { x, y } => {
                        LAST_POSITION_X.store(x.to_bits(), Ordering::Relaxed);
                        LAST_POSITION_Y.store(y.to_bits(), Ordering::Relaxed);
                        let now_us =
                            HOOK_EPOCH.get_or_init(Instant::now).elapsed().as_micros() as u64;
                        let previous = LAST_MOUSE_US.load(Ordering::Relaxed);
                        // 120 Hz is denser than the 60 fps video. Gate before
                        // touching the session clock so discarded 500/1000 Hz
                        // mouse packets never contend with recorder control.
                        if previous != 0 && now_us.saturating_sub(previous) < 8_000 {
                            return;
                        }
                        LAST_MOUSE_US.store(now_us.max(1), Ordering::Relaxed);
                        let Some(ts) = active_session_elapsed_ms() else {
                            return;
                        };
                        LogEvent {
                            ts,
                            event_type: "mousemove",
                            x: Some(x),
                            y: Some(y),
                            key: None,
                            button: None,
                        }
                    }
                    EventType::KeyPress(key) => LogEvent {
                        ts: active_session_elapsed_ms().unwrap_or_default(),
                        event_type: "keydown",
                        x: None,
                        y: None,
                        key: Some(key_name(&key)),
                        button: None,
                    },
                    EventType::KeyRelease(key) => LogEvent {
                        ts: active_session_elapsed_ms().unwrap_or_default(),
                        event_type: "keyup",
                        x: None,
                        y: None,
                        key: Some(key_name(&key)),
                        button: None,
                    },
                    EventType::ButtonPress(btn) => {
                        // Attach last known mouse position to click events
                        let px = f64::from_bits(LAST_POSITION_X.load(Ordering::Relaxed));
                        let py = f64::from_bits(LAST_POSITION_Y.load(Ordering::Relaxed));
                        LogEvent {
                            ts: active_session_elapsed_ms().unwrap_or_default(),
                            event_type: "mousedown",
                            x: Some(px),
                            y: Some(py),
                            key: None,
                            button: Some(button_name(&btn)),
                        }
                    }
                    EventType::ButtonRelease(btn) => {
                        let px = f64::from_bits(LAST_POSITION_X.load(Ordering::Relaxed));
                        let py = f64::from_bits(LAST_POSITION_Y.load(Ordering::Relaxed));
                        LogEvent {
                            ts: active_session_elapsed_ms().unwrap_or_default(),
                            event_type: "mouseup",
                            x: Some(px),
                            y: Some(py),
                            key: None,
                            button: Some(button_name(&btn)),
                        }
                    }
                    EventType::Wheel { delta_x, delta_y } => LogEvent {
                        ts: active_session_elapsed_ms().unwrap_or_default(),
                        event_type: "wheel",
                        x: Some(delta_x as f64),
                        y: Some(delta_y as f64),
                        key: None,
                        button: None,
                    },
                };

                let message = WriterMessage::Event {
                    generation: SESSION_GENERATION.load(Ordering::Acquire),
                    event: log_event,
                };
                if let Err(TrySendError::Full(_)) = event_tx.try_send(message) {
                    DROPPED_EVENTS.fetch_add(1, Ordering::Relaxed);
                }
            };

            if let Err(e) = rdev::listen(callback) {
                eprintln!("[Snap Input] rdev listen error: {e:?}");
            }
        });
    });
}

fn flush_event_queue() -> std::result::Result<(), String> {
    let Some(sender) = EVENT_TX.get() else {
        return Ok(());
    };
    let (done_tx, done_rx) = std::sync::mpsc::channel();
    sender
        .send(WriterMessage::Flush {
            generation: SESSION_GENERATION.load(Ordering::Acquire),
            done: done_tx,
        })
        .map_err(|_| "Input event writer is unavailable".to_string())?;
    done_rx
        .recv_timeout(Duration::from_secs(2))
        .map_err(|_| "Timed out while flushing input events".to_string())
}

// ── Start input logging (async) ──────────────────────────────────────────────

#[tauri::command]
pub async fn start_input_logging(
    output_path: String,
    _session_start_time: String,
    region_x: Option<f64>,
    region_y: Option<f64>,
    region_w: Option<f64>,
    region_h: Option<f64>,
) -> std::result::Result<(), String> {
    // If already active, stop the previous session first.
    if IS_ACTIVE.load(Ordering::Relaxed) {
        IS_ACTIVE.store(false, Ordering::SeqCst);
        flush_event_queue()?;
        let mut guard = ACTIVE_WRITER.lock().map_err(|e| e.to_string())?;
        *guard = None;
    }

    eprintln!("[Snap Input] Step 1: opening log file -> {output_path}");

    let file = File::create(&output_path).map_err(|e| format!("Cannot create log file: {e}"))?;

    EVENT_COUNT.store(0, Ordering::SeqCst);
    DROPPED_EVENTS.store(0, Ordering::SeqCst);
    SESSION_GENERATION.fetch_add(1, Ordering::SeqCst);

    // Reset session start time so timestamps begin from 0 for this recording
    *SESSION_START.lock().map_err(|e| e.to_string())? = Some(Instant::now());
    PAUSED_ACCUM_MS.store(0, Ordering::SeqCst);
    CAPTURE_START_MS.store(0, Ordering::SeqCst);
    CAPTURE_START_QPC_100NS.store(0, Ordering::SeqCst);
    *PAUSE_STARTED.lock().map_err(|e| e.to_string())? = None;
    IS_PAUSED.store(false, Ordering::SeqCst);

    // Reset last mouse position
    LAST_POSITION_X.store(0f64.to_bits(), Ordering::SeqCst);
    LAST_POSITION_Y.store(0f64.to_bits(), Ordering::SeqCst);

    // Reset mouse throttle
    LAST_MOUSE_US.store(0, Ordering::SeqCst);

    // Build the writer first, then write the recording region meta line before
    // any event can be flushed — the hook thread may already be alive and starts
    // writing events immediately after IS_ACTIVE flips.
    let mut writer = BufWriter::new(file);

    if let (Some(x), Some(y), Some(w), Some(h)) = (region_x, region_y, region_w, region_h) {
        if w > 0.0 && h > 0.0 {
            let meta = serde_json::json!({
                "type": "meta",
                "x": x,
                "y": y,
                "w": w,
                "h": h,
            })
            .to_string();
            let _ = writeln!(writer, "{meta}");
        }
    }

    *ACTIVE_WRITER.lock().map_err(|e| e.to_string())? = Some(writer);
    IS_ACTIVE.store(true, Ordering::SeqCst);

    ensure_hook_started();

    eprintln!("[Snap Input] Step 2: logging active");
    Ok(())
}

/// Timestamp the moment the video capture produces its first frame (video time 0).
/// Called by the capture module; writes a `meta` line the editor uses to align
/// input-event timestamps with video time.
pub fn mark_capture_start() {
    mark_capture_start_with_lead(Duration::ZERO);
}

/// Desktop Duplication begins producing frames immediately after FFmpeg is
/// spawned, before its short health check completes. Backdate time zero by
/// that measured startup interval so input and delayed audio startup remain
/// aligned to the actual first video segment.
pub fn mark_capture_start_with_lead(startup_lead: Duration) {
    if !IS_ACTIVE.load(Ordering::Relaxed) {
        return;
    }
    let Some(now_ms) = active_session_elapsed_ms() else {
        return;
    };
    let ts = now_ms.saturating_sub(startup_lead.as_millis() as u64);
    CAPTURE_START_MS.store(ts, Ordering::SeqCst);
    if let Some(now_qpc) = qpc_100ns() {
        CAPTURE_START_QPC_100NS.store(
            now_qpc.saturating_sub(startup_lead.as_nanos() as u64 / 100),
            Ordering::SeqCst,
        );
    }
    if let Ok(mut guard) = ACTIVE_WRITER.lock() {
        if let Some(ref mut w) = *guard {
            let _ = writeln!(w, "{{\"type\":\"meta\",\"captureStartMs\":{ts}}}");
        }
    }
}

/// Convert WASAPI's packet QPC timestamp (100 ns units) to the encoded video
/// timeline. Unlike callback arrival time, this remains stable when the audio
/// thread is scheduled late or a driver returns several buffered packets.
pub fn audio_packet_timeline(packet_qpc_100ns: u64) -> Option<Duration> {
    let capture_start = CAPTURE_START_QPC_100NS.load(Ordering::Acquire);
    if capture_start == 0 || packet_qpc_100ns < capture_start {
        return None;
    }
    let paused_100ns = PAUSED_ACCUM_MS
        .load(Ordering::Relaxed)
        .saturating_mul(10_000);
    let active_100ns = packet_qpc_100ns
        .saturating_sub(capture_start)
        .saturating_sub(paused_100ns);
    Some(Duration::from_nanos(active_100ns.saturating_mul(100)))
}

/// Active wall-clock position of the encoded recording, excluding pauses.
/// Audio capture starts on a separate thread after the video session has been
/// created, so this offset lets each WAV begin on the same time-zero instead
/// of silently shifting toward the start of the clip.
pub fn capture_timeline_elapsed_ms() -> u64 {
    let Some(now_ms) = active_session_elapsed_ms() else {
        return 0;
    };
    now_ms.saturating_sub(CAPTURE_START_MS.load(Ordering::Relaxed))
}

/// Record the relationship between wall-clock capture time and the encoded
/// video's frame clock. WGC occasionally delivers fewer than 60 frames/sec;
/// FFmpeg still timestamps every submitted frame at 60 FPS, so without this
/// correction input events gradually fall behind the actual video.
pub fn mark_capture_end(frames_sent: u64) {
    if !IS_ACTIVE.load(Ordering::Relaxed) {
        return;
    }
    let Some(now_ms) = active_session_elapsed_ms() else {
        return;
    };
    let start_ms = CAPTURE_START_MS.load(Ordering::Relaxed);
    let capture_elapsed_ms = now_ms.saturating_sub(start_ms);
    let video_duration_ms = frames_sent.saturating_mul(1000) / 60;
    if let Ok(mut guard) = ACTIVE_WRITER.lock() {
        if let Some(ref mut writer) = *guard {
            let _ = writeln!(writer, "{{\"type\":\"meta\",\"captureElapsedMs\":{capture_elapsed_ms},\"videoDurationMs\":{video_duration_ms}}}");
        }
    }
}

/// Pause (true) or resume (false) event logging — mirrors the recording pause
/// so no events are written during the omitted segment.
#[tauri::command]
pub fn set_input_paused(paused: bool) -> std::result::Result<(), String> {
    let was_paused = IS_PAUSED.load(Ordering::SeqCst);
    if paused && !was_paused {
        IS_PAUSED.store(true, Ordering::SeqCst);
        *PAUSE_STARTED.lock().map_err(|e| e.to_string())? = Some(Instant::now());
    } else if !paused && was_paused {
        if let Some(start) = PAUSE_STARTED.lock().map_err(|e| e.to_string())?.take() {
            PAUSED_ACCUM_MS.fetch_add(start.elapsed().as_millis() as u64, Ordering::SeqCst);
        }
        IS_PAUSED.store(false, Ordering::SeqCst);
    }
    eprintln!(
        "[Snap Input] Logging {}",
        if paused { "paused" } else { "resumed" }
    );
    Ok(())
}

// ── Stop input logging (async) ───────────────────────────────────────────────

#[tauri::command]
pub async fn stop_input_logging() -> std::result::Result<u64, String> {
    if !IS_ACTIVE.load(Ordering::Relaxed) {
        return Err("No input logging in progress".to_string());
    }

    IS_ACTIVE.store(false, Ordering::SeqCst);

    // A FIFO barrier guarantees every event accepted by the hook has reached
    // the buffered writer before we finalize and drop the file.
    flush_event_queue()?;

    // Explicitly flush the writer before dropping to surface any I/O errors.
    let mut guard = ACTIVE_WRITER.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut w) = *guard {
        w.flush()
            .map_err(|e| format!("Failed to flush input log: {e}"))?;
    }
    *guard = None;

    let count = EVENT_COUNT.load(Ordering::Relaxed);
    let dropped = DROPPED_EVENTS.load(Ordering::Relaxed);

    eprintln!("[Snap Input] Logging stopped — {count} events written, {dropped} throttled");
    Ok(count)
}
