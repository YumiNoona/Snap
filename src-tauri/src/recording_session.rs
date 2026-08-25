use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Emitter;

use crate::capture::CaptureRegion;

macro_rules! eprintln {
    ($($arg:tt)*) => { crate::process::recording_diagnostic(format_args!($($arg)*)) };
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RecordingPhase {
    Preparing,
    Armed,
    CountingDown,
    Starting,
    Recording,
    Pausing,
    Paused,
    Resuming,
    Stopping,
    Finalizing,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingSessionSnapshot {
    pub session_id: String,
    pub phase: RecordingPhase,
    pub countdown: Option<u32>,
    pub error: Option<String>,
}

struct ActiveSession {
    snapshot: RecordingSessionSnapshot,
    cancel_requested: Arc<AtomicBool>,
    video_path: String,
    audio_dir: String,
}

static SESSION: Mutex<Option<ActiveSession>> = Mutex::new(None);

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRecordingSessionRequest {
    pub session_id: String,
    pub target_id: String,
    pub video_path: String,
    pub log_path: String,
    pub audio_dir: String,
    pub mic_device_id: String,
    pub speaker_device_id: String,
    pub camera_device_name: Option<String>,
    pub region: Option<CaptureRegion>,
    pub input_region: Option<CaptureRegion>,
    pub countdown_seconds: u32,
    pub recording_options: Option<crate::capture::RecordingOptions>,
}

fn emit_snapshot(app: &tauri::AppHandle, snapshot: &RecordingSessionSnapshot) {
    let _ = app.emit("recording-session-state", snapshot.clone());
}

fn can_transition(from: RecordingPhase, to: RecordingPhase) -> bool {
    use RecordingPhase::*;
    matches!(
        (from, to),
        (Preparing, Armed | Cancelled | Failed)
            | (Armed, CountingDown | Starting | Cancelled | Failed)
            | (CountingDown, CountingDown | Starting | Cancelled | Failed)
            | (Starting, Recording | Stopping | Failed)
            | (Recording, Pausing | Stopping | Failed)
            | (Pausing, Recording | Paused | Stopping | Failed)
            | (Paused, Resuming | Stopping | Failed)
            | (Resuming, Recording | Paused | Stopping | Failed)
            | (Stopping, Finalizing | Failed)
            | (Finalizing, Completed | Failed)
    )
}

fn transition(
    app: &tauri::AppHandle,
    session_id: &str,
    phase: RecordingPhase,
    countdown: Option<u32>,
    error: Option<String>,
) -> Result<(), String> {
    let snapshot = {
        let mut guard = SESSION.lock().map_err(|value| value.to_string())?;
        let active = guard
            .as_mut()
            .ok_or_else(|| "No recording session is active".to_string())?;
        if active.snapshot.session_id != session_id {
            return Err("Recording command belongs to a stale session".to_string());
        }
        if !can_transition(active.snapshot.phase, phase) {
            return Err(format!(
                "Invalid recording transition: {:?} -> {:?}",
                active.snapshot.phase, phase
            ));
        }
        active.snapshot.phase = phase;
        active.snapshot.countdown = countdown;
        active.snapshot.error = error;
        active.snapshot.clone()
    };
    emit_snapshot(app, &snapshot);
    Ok(())
}

fn cancel_flag(session_id: &str) -> Result<Arc<AtomicBool>, String> {
    let guard = SESSION.lock().map_err(|value| value.to_string())?;
    let active = guard
        .as_ref()
        .ok_or_else(|| "No recording session is active".to_string())?;
    if active.snapshot.session_id != session_id {
        return Err("Recording command belongs to a stale session".to_string());
    }
    Ok(active.cancel_requested.clone())
}

fn finish_session(
    app: &tauri::AppHandle,
    session_id: &str,
    phase: RecordingPhase,
    error: Option<String>,
) {
    let snapshot = RecordingSessionSnapshot {
        session_id: session_id.to_string(),
        phase,
        countdown: None,
        error,
    };
    emit_snapshot(app, &snapshot);
    if let Ok(mut guard) = SESSION.lock() {
        if guard
            .as_ref()
            .is_some_and(|active| active.snapshot.session_id == session_id)
        {
            *guard = None;
        }
    }
}

async fn wait_countdown_second(cancel: &AtomicBool) -> bool {
    for _ in 0..20 {
        if cancel.load(Ordering::Acquire) {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    !cancel.load(Ordering::Acquire)
}

#[tauri::command]
pub async fn start_recording_session(
    app: tauri::AppHandle,
    request: StartRecordingSessionRequest,
) -> Result<RecordingSessionSnapshot, String> {
    if request.session_id.trim().is_empty() {
        return Err("Recording session id is required".to_string());
    }

    let cancel_requested = Arc::new(AtomicBool::new(false));
    let initial = RecordingSessionSnapshot {
        session_id: request.session_id.clone(),
        phase: RecordingPhase::Preparing,
        countdown: None,
        error: None,
    };
    {
        let mut guard = SESSION.lock().map_err(|value| value.to_string())?;
        if guard.is_some() {
            return Err("Another recording session is already active".to_string());
        }
        *guard = Some(ActiveSession {
            snapshot: initial.clone(),
            cancel_requested: cancel_requested.clone(),
            video_path: request.video_path.clone(),
            audio_dir: request.audio_dir.clone(),
        });
    }
    emit_snapshot(&app, &initial);

    transition(&app, &request.session_id, RecordingPhase::Armed, None, None)?;

    if request.countdown_seconds > 0 {
        for value in (1..=request.countdown_seconds.min(10)).rev() {
            transition(
                &app,
                &request.session_id,
                RecordingPhase::CountingDown,
                Some(value),
                None,
            )?;
            crate::set_countdown_internal(app.clone(), Some(value))?;
            if !wait_countdown_second(&cancel_requested).await {
                let _ = crate::set_countdown_internal(app.clone(), None);
                finish_session(&app, &request.session_id, RecordingPhase::Cancelled, None);
                return Err("Recording countdown was cancelled".to_string());
            }
        }
    }
    crate::set_countdown_internal(app.clone(), None)?;

    transition(
        &app,
        &request.session_id,
        RecordingPhase::Starting,
        None,
        None,
    )?;

    crate::input_hook::configure_capture_fps(request.recording_options.unwrap_or_default().fps);
    let input_region = request.input_region.or(request.region);
    let input_result = crate::input_hook::start_input_logging(
        request.log_path.clone(),
        "0".to_string(),
        input_region.map(|value| value.x as f64),
        input_region.map(|value| value.y as f64),
        input_region.map(|value| value.w as f64),
        input_region.map(|value| value.h as f64),
    )
    .await;
    if let Err(error) = input_result {
        finish_session(
            &app,
            &request.session_id,
            RecordingPhase::Failed,
            Some(error.clone()),
        );
        return Err(error);
    }

    if let Err(error) = crate::capture::start_recording(
        request.target_id.clone(),
        request.video_path.clone(),
        request.region,
        request.recording_options,
    )
    .await
    {
        let _ = crate::input_hook::stop_input_logging().await;
        finish_session(
            &app,
            &request.session_id,
            RecordingPhase::Failed,
            Some(error.clone()),
        );
        return Err(error);
    }

    // The video encoder has produced its first frame at this point, so this is
    // the truthful recording boundary for the UI clock. Audio initializes
    // immediately afterward and pads itself to the shared video timeline.
    // Keeping the phase at `Starting` until slow USB/Bluetooth audio drivers
    // finish made Snap appear to be preparing while it was already recording.
    transition(
        &app,
        &request.session_id,
        RecordingPhase::Recording,
        None,
        None,
    )?;

    let camera_fps = request
        .recording_options
        .unwrap_or_default()
        .fps
        .clamp(24, 30);
    if let Err(error) = crate::camera::start_camera_capture(
        request.camera_device_name.clone(),
        request.audio_dir.clone(),
        camera_fps,
    )
    .await
    {
        let _ = crate::capture::stop_recording().await;
        let _ = crate::input_hook::stop_input_logging().await;
        finish_session(
            &app,
            &request.session_id,
            RecordingPhase::Failed,
            Some(error.clone()),
        );
        return Err(error);
    }

    let audio_process_id = crate::capture::process_id_for_target(&request.target_id);
    if let Err(error) = crate::audio::start_audio_capture(
        request.mic_device_id,
        request.speaker_device_id,
        request.audio_dir,
        audio_process_id,
    )
    .await
    {
        let _ = crate::camera::stop_camera_capture().await;
        let _ = crate::capture::stop_recording().await;
        let _ = crate::input_hook::stop_input_logging().await;
        finish_session(
            &app,
            &request.session_id,
            RecordingPhase::Failed,
            Some(error.clone()),
        );
        return Err(error);
    }

    get_recording_session_state()?.ok_or_else(|| "Recording session disappeared".to_string())
}

#[tauri::command]
pub fn cancel_recording_countdown(session_id: String) -> Result<(), String> {
    let flag = cancel_flag(&session_id)?;
    flag.store(true, Ordering::Release);
    Ok(())
}

#[tauri::command]
pub fn set_recording_session_paused(
    app: tauri::AppHandle,
    session_id: String,
    paused: bool,
) -> Result<RecordingSessionSnapshot, String> {
    let current = get_recording_session_state()?
        .ok_or_else(|| "No recording session is active".to_string())?;
    if current.session_id != session_id {
        return Err("Recording command belongs to a stale session".to_string());
    }
    let allowed = if paused {
        current.phase == RecordingPhase::Recording
    } else {
        current.phase == RecordingPhase::Paused
    };
    if !allowed {
        return Err(format!(
            "Cannot {} a session in the {:?} state",
            if paused { "pause" } else { "resume" },
            current.phase
        ));
    }

    transition(
        &app,
        &session_id,
        if paused {
            RecordingPhase::Pausing
        } else {
            RecordingPhase::Resuming
        },
        None,
        None,
    )?;
    let coordinated = (|| -> Result<(), String> {
        if paused {
            // Stop video first so no post-pause picture can be paired with
            // audio/input that the user expected to be omitted.
            crate::capture::set_paused(true)?;
            crate::camera::set_camera_paused(true)?;
            crate::audio::set_audio_paused(true)?;
            crate::input_hook::set_input_paused(true)?;
        } else {
            // A fresh video segment starts at its first encoded frame. Keep
            // audio and input paused during encoder/device initialization so
            // that startup time is not inserted into their timelines.
            crate::capture::set_paused(false)?;
            crate::camera::set_camera_paused(false)?;
            crate::input_hook::set_input_paused(false)?;
            crate::audio::set_audio_paused(false)?;
        }
        let _ = crate::set_overlay_paused_internal(app.clone(), paused);
        Ok(())
    })();
    if let Err(error) = coordinated {
        // Keep the three streams in their last stable state if one participant
        // cannot acknowledge the transition. This avoids a half-paused session.
        let stable_paused = !paused;
        let _ = crate::capture::set_paused(stable_paused);
        let _ = crate::camera::set_camera_paused(stable_paused);
        let _ = crate::audio::set_audio_paused(stable_paused);
        let _ = crate::input_hook::set_input_paused(stable_paused);
        let _ = crate::set_overlay_paused_internal(app.clone(), stable_paused);
        transition(
            &app,
            &session_id,
            if stable_paused {
                RecordingPhase::Paused
            } else {
                RecordingPhase::Recording
            },
            None,
            Some(format!("Pause transition rolled back: {error}")),
        )?;
        return Err(error);
    }
    transition(
        &app,
        &session_id,
        if paused {
            RecordingPhase::Paused
        } else {
            RecordingPhase::Recording
        },
        None,
        None,
    )?;
    get_recording_session_state()?.ok_or_else(|| "Recording session disappeared".to_string())
}

#[tauri::command]
pub async fn stop_recording_session(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<RecordingSessionSnapshot, String> {
    let current = get_recording_session_state()?
        .ok_or_else(|| "No recording session is active".to_string())?;
    if current.session_id != session_id {
        return Err("Recording command belongs to a stale session".to_string());
    }
    let (video_path, audio_dir) = {
        let guard = SESSION.lock().map_err(|value| value.to_string())?;
        let active = guard
            .as_ref()
            .ok_or_else(|| "No recording session is active".to_string())?;
        (active.video_path.clone(), active.audio_dir.clone())
    };
    if matches!(
        current.phase,
        RecordingPhase::Preparing | RecordingPhase::Armed | RecordingPhase::CountingDown
    ) {
        cancel_recording_countdown(session_id.clone())?;
        return Err("Recording was cancelled before capture started".to_string());
    }

    transition(&app, &session_id, RecordingPhase::Stopping, None, None)?;
    // From this point capture has received its stop signal and the remaining
    // work is media finalization: closing WAV headers, joining resilient
    // fragments into the editor-ready file, and validating sidecars.
    // Publish that phase before awaiting the workers so the launcher can show
    // an honest processing screen instead of appearing frozen.
    transition(&app, &session_id, RecordingPhase::Finalizing, None, None)?;
    let (video, camera, audio, input) = tokio::join!(
        crate::capture::stop_recording(),
        crate::camera::stop_camera_capture(),
        crate::audio::stop_audio_capture(),
        crate::input_hook::stop_input_logging(),
    );

    let mut failures = Vec::new();
    let mut notices = Vec::new();
    if let Err(error) = video {
        failures.push(format!("video: {error}"));
    }
    if let Err(error) = camera {
        // A webcam can be unplugged or claimed by a meeting app mid-session.
        // Preserve the primary screen recording and audio tracks; camera
        // fragments remain in the support folder for recovery/diagnostics.
        eprintln!("[Snap Camera] Optional camera track ended with a warning: {error}");
        notices.push(format!("Camera track warning: {error}"));
    }
    match audio {
        Ok(report) => notices.extend(report.warnings),
        Err(error) => failures.push(format!("audio: {error}")),
    }
    if let Err(error) = input {
        failures.push(format!("input: {error}"));
    }
    if !failures.is_empty() {
        let error = failures.join("; ");
        finish_session(
            &app,
            &session_id,
            RecordingPhase::Failed,
            Some(error.clone()),
        );
        return Err(error);
    }

    if let Err(error) = crate::audio::attach_audio_to_video(video_path, audio_dir).await {
        // The independent WAV tracks are still preserved and editable, so a
        // mux failure must not invalidate the primary screen recording.
        notices.push(format!(
            "The MP4 was saved video-only, but editable audio tracks are available: {error}"
        ));
    }

    let completion_notice = (!notices.is_empty()).then(|| notices.join(" "));

    let completed = RecordingSessionSnapshot {
        session_id: session_id.clone(),
        phase: RecordingPhase::Completed,
        countdown: None,
        error: completion_notice.clone(),
    };
    finish_session(
        &app,
        &session_id,
        RecordingPhase::Completed,
        completion_notice,
    );
    Ok(completed)
}

#[tauri::command]
pub fn get_recording_session_state() -> Result<Option<RecordingSessionSnapshot>, String> {
    Ok(SESSION
        .lock()
        .map_err(|value| value.to_string())?
        .as_ref()
        .map(|active| active.snapshot.clone()))
}

#[cfg(test)]
mod tests {
    use super::{can_transition, RecordingPhase};

    #[test]
    fn lifecycle_accepts_the_normal_recording_path() {
        use RecordingPhase::*;
        let path = [
            (Preparing, Armed),
            (Armed, CountingDown),
            (CountingDown, CountingDown),
            (CountingDown, Starting),
            (Starting, Recording),
            (Recording, Pausing),
            (Pausing, Paused),
            (Paused, Resuming),
            (Resuming, Recording),
            (Recording, Stopping),
            (Stopping, Finalizing),
            (Finalizing, Completed),
        ];
        assert!(path.into_iter().all(|(from, to)| can_transition(from, to)));
    }

    #[test]
    fn lifecycle_rejects_stale_or_terminal_commands() {
        use RecordingPhase::*;
        assert!(!can_transition(Recording, Recording));
        assert!(!can_transition(Paused, Pausing));
        assert!(!can_transition(Completed, Starting));
        assert!(!can_transition(Failed, Recording));
        assert!(!can_transition(Cancelled, Starting));
    }

    #[test]
    fn lifecycle_allows_atomic_pause_rollbacks() {
        use RecordingPhase::*;
        assert!(can_transition(Pausing, Recording));
        assert!(can_transition(Resuming, Paused));
    }
}
