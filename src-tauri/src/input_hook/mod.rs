use std::fs::File;
use std::io::{BufWriter, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use rdev::EventType;

// ── Globals — one persistent hook, one active writer ─────────────────────────

/// Set to true while we want events logged. Toggled by start/stop commands.
static IS_ACTIVE: AtomicBool = AtomicBool::new(false);

/// The single shared writer. None when not logging, Some when logging.
static ACTIVE_WRITER: Mutex<Option<BufWriter<File>>> = Mutex::new(None);

/// Event counter reset on each start, read on stop.
static EVENT_COUNT: AtomicU64 = AtomicU64::new(0);

/// Mouse-move throttle: last time a mousemove was logged.
static LAST_MOUSE: Mutex<Option<Instant>> = Mutex::new(None);

/// Last known mouse position — used to attach coordinates to click events
/// since rdev::ButtonPress/ButtonRelease don't carry position data.
static LAST_POSITION: Mutex<(f64, f64)> = Mutex::new((0.0, 0.0));

/// Session start time — reset on each call to start_input_logging so that
/// timestamps are relative to the current recording, not the hook thread's
/// birth time. This fixes the desync on second+ recordings.
static SESSION_START: Mutex<Option<Instant>> = Mutex::new(None);

/// Ensures the rdev::listen thread is spawned exactly once.
static HOOK_STARTED: OnceLock<()> = OnceLock::new();

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

fn key_name(key: &rdev::Key) -> String {
    format!("{key:?}")
}

fn button_name(btn: &rdev::Button) -> String {
    format!("{btn:?}")
}

// ── Ensure the hook thread exists (called once, idempotent) ─────────────────

fn ensure_hook_started() {
    HOOK_STARTED.get_or_init(|| {
        thread::spawn(move || {
            eprintln!("[Snap Input] rdev::listen hook started (once, persistent)");

            let callback = move |event: rdev::Event| {
                if !IS_ACTIVE.load(Ordering::Relaxed) {
                    return;
                }

                // Read session start from the shared static (reset on each recording)
                let session_start = match *SESSION_START.lock().unwrap() {
                    Some(start) => start,
                    None => return,
                };
                let ts = session_start.elapsed().as_millis() as u64;

                let log_event = match event.event_type {
                    EventType::MouseMove { x, y } => {
                        // Update last known position for click events
                        if let Ok(mut pos) = LAST_POSITION.lock() {
                            *pos = (x, y);
                        }

                        let mut last = LAST_MOUSE.lock().unwrap();
                        let now = Instant::now();
                        if let Some(prev) = *last {
                            if now.duration_since(prev) < Duration::from_micros(16_667) {
                                return;
                            }
                        }
                        *last = Some(now);
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
                        ts,
                        event_type: "keydown",
                        x: None,
                        y: None,
                        key: Some(key_name(&key)),
                        button: None,
                    },
                    EventType::KeyRelease(key) => LogEvent {
                        ts,
                        event_type: "keyup",
                        x: None,
                        y: None,
                        key: Some(key_name(&key)),
                        button: None,
                    },
                    EventType::ButtonPress(btn) => {
                        // Attach last known mouse position to click events
                        let (px, py) = *LAST_POSITION.lock().unwrap();
                        LogEvent {
                            ts,
                            event_type: "mousedown",
                            x: Some(px),
                            y: Some(py),
                            key: None,
                            button: Some(button_name(&btn)),
                        }
                    }
                    EventType::ButtonRelease(btn) => {
                        let (px, py) = *LAST_POSITION.lock().unwrap();
                        LogEvent {
                            ts,
                            event_type: "mouseup",
                            x: Some(px),
                            y: Some(py),
                            key: None,
                            button: Some(button_name(&btn)),
                        }
                    }
                    EventType::Wheel { delta_x, delta_y } => LogEvent {
                        ts,
                        event_type: "wheel",
                        x: Some(delta_x as f64),
                        y: Some(delta_y as f64),
                        key: None,
                        button: None,
                    },
                };

                if let Ok(json) = serde_json::to_string(&log_event) {
                    if let Ok(mut guard) = ACTIVE_WRITER.lock() {
                        if let Some(ref mut w) = *guard {
                            let _ = writeln!(w, "{json}");
                            EVENT_COUNT.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                }
            };

            if let Err(e) = rdev::listen(callback) {
                eprintln!("[Snap Input] rdev listen error: {e:?}");
            }
        });
    });
}

// ── Start input logging (async) ──────────────────────────────────────────────

#[tauri::command]
pub async fn start_input_logging(
    output_path: String,
    _session_start_time: String,
) -> std::result::Result<(), String> {
    // If already active, stop the previous session first.
    if IS_ACTIVE.load(Ordering::Relaxed) {
        let mut guard = ACTIVE_WRITER.lock().map_err(|e| e.to_string())?;
        if let Some(ref mut w) = *guard {
            let _ = w.flush();
        }
        *guard = None;
        IS_ACTIVE.store(false, Ordering::SeqCst);
    }

    eprintln!("[Snap Input] Step 1: opening log file -> {output_path}");

    let file =
        File::create(&output_path).map_err(|e| format!("Cannot create log file: {e}"))?;

    EVENT_COUNT.store(0, Ordering::SeqCst);

    // Reset session start time so timestamps begin from 0 for this recording
    *SESSION_START.lock().map_err(|e| e.to_string())? = Some(Instant::now());

    // Reset last mouse position
    *LAST_POSITION.lock().map_err(|e| e.to_string())? = (0.0, 0.0);

    // Reset mouse throttle
    *LAST_MOUSE.lock().map_err(|e| e.to_string())? = None;

    *ACTIVE_WRITER.lock().map_err(|e| e.to_string())? = Some(BufWriter::new(file));
    IS_ACTIVE.store(true, Ordering::SeqCst);

    ensure_hook_started();

    eprintln!("[Snap Input] Step 2: logging active");
    Ok(())
}

// ── Stop input logging (async) ───────────────────────────────────────────────

#[tauri::command]
pub async fn stop_input_logging() -> std::result::Result<u64, String> {
    if !IS_ACTIVE.load(Ordering::Relaxed) {
        return Err("No input logging in progress".to_string());
    }

    IS_ACTIVE.store(false, Ordering::SeqCst);

    // Explicitly flush the writer before dropping to surface any I/O errors.
    let mut guard = ACTIVE_WRITER.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut w) = *guard {
        w.flush().map_err(|e| format!("Failed to flush input log: {e}"))?;
    }
    *guard = None;

    let count = EVENT_COUNT.load(Ordering::Relaxed);

    eprintln!("[Snap Input] Logging stopped — {count} events written");
    Ok(count)
}
