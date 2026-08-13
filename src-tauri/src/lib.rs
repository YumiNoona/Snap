mod audio;
mod capture;
mod export;
mod input_hook;
mod mobile;
mod process;

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::webview::Color;
use tauri::Emitter;
use tauri::Manager;
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowDisplayAffinity, SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
};

fn exclude_from_capture(window: &tauri::WebviewWindow) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    unsafe {
        // Clear any stale affinity first. This matters for transparent WebView2
        // windows whose DWM surface may be recreated when the window is shown.
        SetWindowDisplayAffinity(hwnd, WDA_NONE)
            .map_err(|error| format!("Unable to reset capture affinity: {error}"))?;
        SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)
            .map_err(|error| format!("Unable to exclude window from capture: {error}"))?;

        let mut applied = 0u32;
        GetWindowDisplayAffinity(hwnd, &mut applied)
            .map_err(|error| format!("Unable to verify capture affinity: {error}"))?;
        if applied != WDA_EXCLUDEFROMCAPTURE.0 {
            return Err(format!(
                "Windows applied capture affinity {applied:#x} instead of WDA_EXCLUDEFROMCAPTURE"
            ));
        }
    }
    Ok(())
}

/// Pending video/log paths handed to the dedicated editor window.
struct EditorPaths(Mutex<Option<(String, String)>>);

/// Live state mirrored to the floating recording dock window.
struct DockState(Mutex<DockStateSnapshot>);

/// The dock should remain on-screen for the entire recording lifecycle.
/// Only an explicit recording stop (or the user's own minimize action) may
/// make it disappear.
static DOCK_VISIBLE_REQUESTED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Default, Serialize, Deserialize)]
struct DockStateSnapshot {
    recording: bool,
    elapsed: u64,
    paused: bool,
    mic_muted: bool,
}

#[derive(Clone, Serialize)]
struct VideoDevice {
    id: String,
    name: String,
}

/// Enumerate installed Windows camera devices natively. Browser media-device
/// enumeration hides friendly names until camera permission is granted, which
/// is why the launcher previously fell back to labels such as "Camera 1".
#[tauri::command]
async fn enumerate_video_devices() -> Result<Vec<VideoDevice>, String> {
    use windows::Devices::Enumeration::{DeviceClass, DeviceInformation};

    let operation = DeviceInformation::FindAllAsyncDeviceClass(DeviceClass::VideoCapture)
        .map_err(|error| format!("Unable to start camera discovery: {error}"))?;
    let collection = operation
        .await
        .map_err(|error| format!("Unable to discover cameras: {error}"))?;
    let count = collection
        .Size()
        .map_err(|error| format!("Unable to read camera list: {error}"))?;
    let mut devices = Vec::with_capacity(count as usize);

    for index in 0..count {
        let device = collection
            .GetAt(index)
            .map_err(|error| format!("Unable to read camera {index}: {error}"))?;
        let id = device
            .Id()
            .map_err(|error| format!("Unable to read camera id: {error}"))?
            .to_string_lossy();
        let name = device
            .Name()
            .map_err(|error| format!("Unable to read camera name: {error}"))?
            .to_string_lossy();
        if !id.is_empty() && !name.is_empty() {
            devices.push(VideoDevice { id, name });
        }
    }

    devices.sort_by_key(|device| device.name.to_lowercase());
    Ok(devices)
}

/// Open the editor window, hand it the recording, and focus it.
/// The window is created on demand (runtime) rather than predeclared hidden —
/// predeclared invisible windows can fail to display on some Windows setups.
#[tauri::command]
async fn open_editor_window(
    app: tauri::AppHandle,
    state: tauri::State<'_, EditorPaths>,
    video: String,
    log: String,
) -> Result<(), String> {
    *state.0.lock().map_err(|e| e.to_string())? = Some((video.clone(), log.clone()));

    if let Some(win) = app.get_webview_window("editor") {
        eprintln!("[Snap] open_editor_window: reusing existing editor window");
        let _ = win.emit("editor-open", (video, log));
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }

    eprintln!("[Snap] open_editor_window: creating editor window at runtime");

    // IMPORTANT: WebviewWindowBuilder::build() deadlocks on Windows when
    // called directly from a synchronous command — see Tauri's own docs:
    // https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html
    // "On Windows, this function deadlocks when used in a synchronous
    // command or event handlers... You should use async commands and
    // separate threads when creating windows."
    // We're already async here, but that alone isn't enough — build() must
    // run on a separate thread via a blocking channel round-trip so the
    // command-dispatch thread doesn't block the main/event-loop thread that
    // build() itself needs in order to complete.
    let (tx, rx) = std::sync::mpsc::channel();
    let app_handle = app.clone();
    let video_for_thread = video.clone();
    let log_for_thread = log.clone();
    std::thread::spawn(move || {
        let result = tauri::WebviewWindowBuilder::new(
            &app_handle,
            "editor",
            tauri::WebviewUrl::App("index.html?window=editor".into()),
        )
        .title("Snap Editor")
        .inner_size(1360.0, 860.0)
        .min_inner_size(980.0, 640.0)
        .center()
        .decorations(false)
        .visible(false)
        .background_color(Color(11, 13, 18, 255))
        .devtools(true)
        .on_page_load(|_webview, payload| {
            eprintln!("[Snap Editor] page load: {:?} {:?}", payload.url(), payload.event());
        })
        .build()
        .map(|win| {
            // Window is revealed by the `window_ready` command once React has
            // actually mounted (see src/App.tsx) — do NOT show/focus here.
            // Showing immediately re-introduces the black/white pre-content
            // flash (or a permanently blank window if the frontend fails to
            // mount).
            eprintln!("[Snap] editor window created, emitting editor-open");
            let _ = win.emit("editor-open", (video_for_thread, log_for_thread));
            eprintln!("[Snap] Press F12 or right-click > Inspect on the editor window to view JS console errors");
        })
        .map_err(|e| format!("Failed to create editor window: {e}"));
        let _ = tx.send(result);
    });

    rx.recv()
        .map_err(|e| format!("Editor window creation thread died: {e}"))?
}

/// Called by the frontend after React mounts and the UI is rendered — the
/// window stays hidden (.visible(false) on the builder) until this fires,
/// eliminating any white pre-content frame.
#[tauri::command]
fn window_ready(window: tauri::Window) -> Result<(), String> {
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

/// Open the standalone teleprompter as its own OS-level window (not a DOM overlay),
/// so it stays off-screen relative to the launcher and can be independently positioned.
#[tauri::command]
async fn open_teleprompter_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("teleprompter") {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }

    // Same Windows deadlock concern as open_editor_window above — build() on
    // a spawned thread, result relayed back via a channel.
    let (tx, rx) = std::sync::mpsc::channel();
    let app_handle = app.clone();
    std::thread::spawn(move || {
        let result = tauri::WebviewWindowBuilder::new(
            &app_handle,
            "teleprompter",
            tauri::WebviewUrl::App("index.html?window=teleprompter".into()),
        )
        .title("Snap Teleprompter")
        .inner_size(720.0, 520.0)
        .min_inner_size(460.0, 360.0)
        .center()
        .decorations(false)
        .visible(false)
        .background_color(Color(11, 13, 18, 255))
        .devtools(true)
        .always_on_top(true)
        .build()
        .map(|_win| {
            eprintln!("[Snap] Press F12 or right-click > Inspect on the teleprompter window to view JS console errors");
        })
        .map_err(|e| format!("Failed to create teleprompter window: {e}"));
        let _ = tx.send(result);
    });

    rx.recv()
        .map_err(|e| format!("Teleprompter window creation thread died: {e}"))?
}

/// Open Settings as a dedicated OS-level module, matching the standalone
/// Teleprompter behavior instead of covering the recorder with an overlay.
#[tauri::command]
async fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }

    let (tx, rx) = std::sync::mpsc::channel();
    let app_handle = app.clone();
    std::thread::spawn(move || {
        let result = tauri::WebviewWindowBuilder::new(
            &app_handle,
            "settings",
            tauri::WebviewUrl::App("index.html?window=settings".into()),
        )
        .title("Snap Settings")
        .inner_size(540.0, 620.0)
        .min_inner_size(480.0, 540.0)
        .center()
        .decorations(false)
        .resizable(true)
        .visible(false)
        .background_color(Color(11, 13, 18, 255))
        .devtools(true)
        .build()
        .map(|_| ())
        .map_err(|error| format!("Failed to create settings window: {error}"));
        let _ = tx.send(result);
    });

    rx.recv()
        .map_err(|error| format!("Settings window creation thread died: {error}"))?
}

#[tauri::command]
fn get_pending_editor_paths(state: tauri::State<EditorPaths>) -> Result<(String, String), String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "No editor paths pending".to_string())
}

#[tauri::command]
fn begin_region_selection(app: tauri::AppHandle) -> Result<capture::TargetBounds, String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or("No monitor available")?;
    let position = *monitor.position();
    let size = *monitor.size();
    window.set_always_on_top(true).map_err(|e| e.to_string())?;
    window
        .set_position(tauri::PhysicalPosition::new(position.x, position.y))
        .map_err(|e| e.to_string())?;
    window
        .set_size(tauri::PhysicalSize::new(size.width, size.height))
        .map_err(|e| e.to_string())?;
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    Ok(capture::TargetBounds {
        x: position.x,
        y: position.y,
        w: size.width as i32,
        h: size.height as i32,
    })
}

#[tauri::command]
fn end_region_selection(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;
    window.set_always_on_top(false).map_err(|e| e.to_string())?;
    window
        .set_size(tauri::LogicalSize::new(1180.0, 440.0))
        .map_err(|e| e.to_string())?;
    window.center().map_err(|e| e.to_string())
}

/// Show/hide the floating dock window, centered near the bottom of the
/// primary monitor so it floats above the desktop — independent of the
/// small launcher window.
#[tauri::command]
fn set_dock_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    DOCK_VISIBLE_REQUESTED.store(visible, Ordering::SeqCst);
    let win = app
        .get_webview_window("dock")
        .ok_or_else(|| "Dock window not found".to_string())?;

    if visible {
        let _ = win.unminimize();
        let _ = win.set_always_on_top(true);
        // Center above the bottom edge of the main window's monitor.
        if let Some(mon) = app
            .get_webview_window("main")
            .and_then(|m| m.current_monitor().ok())
            .flatten()
        {
            let scale = mon.scale_factor();
            let logical_w = (mon.size().width as f64 / scale) as i32;
            let logical_h = (mon.size().height as f64 / scale) as i32;
            let logical_x = (mon.position().x as f64 / scale) as i32;
            let logical_y = (mon.position().y as f64 / scale) as i32;
            let x0 = logical_x + (logical_w - 460) / 2;
            let y0 = logical_y + logical_h - 74 - 48;
            let _ = win.set_position(tauri::LogicalPosition::new(x0 as f64, y0 as f64));
        }
        let _ = win.show();
        // Apply exclusion after the transparent window has a live DWM surface.
        // Applying it before show can be downgraded to a black WDA_MONITOR mask.
        if let Err(error) = exclude_from_capture(&win) {
            eprintln!("[Snap] Dock capture exclusion failed: {error}");
        }
        // WebView2 may recreate its compositor surface immediately after first
        // show, so verify/reapply once more after that initialization settles.
        let delayed_dock = win.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(120));
            if !DOCK_VISIBLE_REQUESTED.load(Ordering::SeqCst) {
                return;
            }
            let _ = delayed_dock.set_always_on_top(true);
            let _ = delayed_dock.show();
            if let Err(error) = exclude_from_capture(&delayed_dock) {
                eprintln!("[Snap] Delayed dock capture exclusion failed: {error}");
            }
        });
    } else {
        let _ = win.hide();
        let _ = win.set_size(tauri::LogicalSize::new(460.0, 74.0));
        let _ = win.emit("dock-compact", false);
    }

    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("dock-visibility", visible);
    }
    Ok(())
}

/// Called after the dock React surface mounts. This closes the startup race
/// where recording can begin before the predeclared hidden WebView is ready.
#[tauri::command]
fn dock_window_ready(app: tauri::AppHandle) -> Result<(), String> {
    if !DOCK_VISIBLE_REQUESTED.load(Ordering::SeqCst) {
        return Ok(());
    }
    let win = app
        .get_webview_window("dock")
        .ok_or_else(|| "Dock window not found".to_string())?;
    let _ = win.set_always_on_top(true);
    let _ = win.show();
    exclude_from_capture(&win)
}

/// Resize the recorder dock between its full controls and a small restorable
/// pill while preserving the window's visual center on screen.
#[tauri::command]
fn set_dock_compact(app: tauri::AppHandle, compact: bool) -> Result<(), String> {
    let win = app
        .get_webview_window("dock")
        .ok_or_else(|| "Dock window not found".to_string())?;
    let scale = win.scale_factor().map_err(|error| error.to_string())?;
    let old_size = win.outer_size().map_err(|error| error.to_string())?;
    let old_position = win.outer_position().map_err(|error| error.to_string())?;
    let (logical_width, logical_height) = if compact {
        (196.0, 60.0)
    } else {
        (460.0, 74.0)
    };
    let new_width = (logical_width * scale).round() as i32;
    let new_height = (logical_height * scale).round() as i32;
    let centered_x = old_position.x + (old_size.width as i32 - new_width) / 2;
    let centered_y = old_position.y + (old_size.height as i32 - new_height) / 2;

    win.set_size(tauri::LogicalSize::new(logical_width, logical_height))
        .map_err(|error| error.to_string())?;
    win.set_position(tauri::PhysicalPosition::new(centered_x, centered_y))
        .map_err(|error| error.to_string())?;
    // Resizing can recreate the transparent compositor surface as well.
    exclude_from_capture(&win)
}

/// Mirror the latest recording state to the dock window.
#[tauri::command]
fn update_dock_state(
    app: tauri::AppHandle,
    state: tauri::State<DockState>,
    snapshot: DockStateSnapshot,
) -> Result<(), String> {
    *state.0.lock().map_err(|e| e.to_string())? = snapshot.clone();
    if let Some(dock) = app.get_webview_window("dock") {
        let _ = dock.emit("dock-state", snapshot);
        // A live recording owns dock visibility. Reassert show/topmost on each
        // state tick so focus changes, display changes, or WebView recreation
        // cannot silently leave the controls hidden. `show` does not restore a
        // user-minimized native window, so an explicit minimize remains honored.
        if DOCK_VISIBLE_REQUESTED.load(Ordering::SeqCst) {
            let _ = dock.set_always_on_top(true);
            let _ = dock.show();
        }
    }
    Ok(())
}

#[tauri::command]
fn get_dock_state(state: tauri::State<DockState>) -> Result<DockStateSnapshot, String> {
    Ok(state.0.lock().map_err(|e| e.to_string())?.clone())
}

/// Relay a dock button action (stop / pause / mic) to the launcher window.
#[tauri::command]
fn dock_action(app: tauri::AppHandle, action: String) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("dock-action", action);
    }
    Ok(())
}

#[derive(Clone, Serialize, Deserialize)]
struct OverlayRegion {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

/// Last shown overlay appearance (style + region) so a pause toggle can
/// re-emit the state without the frontend re-sending coordinates.
static OVERLAY_APPEARANCE: Mutex<Option<(String, Option<OverlayRegion>)>> = Mutex::new(None);

/// True while the recording is paused — the border renders green.
static OVERLAY_PAUSED: AtomicBool = AtomicBool::new(false);

/// Emit a countdown value (3, 2, 1, or null to clear) to the recorder-overlay
/// window so it renders full-screen, not clipped to the small launcher window.
#[tauri::command]
fn set_countdown(app: tauri::AppHandle, value: Option<u32>) -> Result<(), String> {
    let win = app
        .get_webview_window("recorder-overlay")
        .ok_or_else(|| "Overlay window not found".to_string())?;

    if let Some(monitor) = app
        .get_webview_window("main")
        .and_then(|m| m.current_monitor().ok())
        .flatten()
    {
        let scale = monitor.scale_factor();
        let logical_w = monitor.size().width as f64 / scale;
        let logical_h = monitor.size().height as f64 / scale;
        let logical_x = monitor.position().x as f64 / scale;
        let logical_y = monitor.position().y as f64 / scale;

        let _ = win.set_size(tauri::LogicalSize::new(logical_w, logical_h));
        let _ = win.set_position(tauri::LogicalPosition::new(logical_x, logical_y));
    }

    let payload = serde_json::json!({ "countdown": value });
    let _ = win.emit("countdown-state", payload);

    if value.is_some() {
        let _ = exclude_from_capture(&win);
        let _ = win.set_ignore_cursor_events(true);
        let _ = win.set_always_on_top(true);
        let _ = win.show();
        let _ = win.set_focus();
    } else {
        // If overlay border is active, don't hide the window — just clear countdown
        let border_active = OVERLAY_APPEARANCE
            .lock()
            .map(|g| g.is_some())
            .unwrap_or(false);
        if !border_active {
            let _ = win.hide();
        }
    }

    Ok(())
}

#[tauri::command]
fn set_recording_overlay(
    app: tauri::AppHandle,
    enabled: bool,
    style: String,
    region: Option<OverlayRegion>,
) -> Result<(), String> {
    let win = app
        .get_webview_window("recorder-overlay")
        .ok_or_else(|| "Overlay window not found".to_string())?;

    if !enabled {
        OVERLAY_PAUSED.store(false, Ordering::SeqCst);
        if let Ok(mut guard) = OVERLAY_APPEARANCE.lock() {
            *guard = None;
        }
        let _ = win.set_ignore_cursor_events(false);
        let _ = win.hide();
        return Ok(());
    }

    let monitor = app
        .get_webview_window("main")
        .and_then(|m| m.current_monitor().ok())
        .flatten()
        .ok_or_else(|| "No monitor available".to_string())?;
    let _ = exclude_from_capture(&win);

    let scale = monitor.scale_factor();
    let logical_w = monitor.size().width as f64 / scale;
    let logical_h = monitor.size().height as f64 / scale;
    let logical_x = monitor.position().x as f64 / scale;
    let logical_y = monitor.position().y as f64 / scale;

    let _ = win.set_size(tauri::LogicalSize::new(logical_w, logical_h));
    let _ = win.set_position(tauri::LogicalPosition::new(logical_x, logical_y));

    let logical_region = region.map(|r| OverlayRegion {
        x: ((r.x - monitor.position().x) as f64 / scale).round() as i32,
        y: ((r.y - monitor.position().y) as f64 / scale).round() as i32,
        w: (r.w as f64 / scale).round() as i32,
        h: (r.h as f64 / scale).round() as i32,
    });

    if let Ok(mut guard) = OVERLAY_APPEARANCE.lock() {
        *guard = Some((style.clone(), logical_region.clone()));
    }

    let paused = OVERLAY_PAUSED.load(Ordering::SeqCst);
    let payload = serde_json::json!({
        "style": style,
        "region": logical_region,
        "paused": paused,
    });
    let _ = win.emit("overlay-state", payload);
    // Make the whole monitor overlay click-through — CSS pointer-events can't
    // do this at the OS level, so without this the overlay blocks every click.
    let _ = win.set_ignore_cursor_events(true);
    let _ = win.show();
    Ok(())
}

/// Flip the overlay between "recording" and "paused" appearance — the border
/// turns green while paused. Re-emits the current overlay state.
#[tauri::command]
fn set_overlay_paused(app: tauri::AppHandle, paused: bool) -> Result<(), String> {
    OVERLAY_PAUSED.store(paused, Ordering::SeqCst);
    let appearance = OVERLAY_APPEARANCE.lock().map_err(|e| e.to_string())?;
    if let Some((style, region)) = appearance.as_ref() {
        if let Some(win) = app.get_webview_window("recorder-overlay") {
            let payload = serde_json::json!({
                "style": style,
                "region": region,
                "paused": paused,
            });
            let _ = win.emit("overlay-state", payload);
        }
    }
    Ok(())
}

#[derive(Serialize)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
}

#[tauri::command]
fn read_text_file(path: String) -> std::result::Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Cannot read {path}: {e}"))
}

#[tauri::command]
fn open_explorer(path: String) -> std::result::Result<(), String> {
    process::background_command("explorer")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Cannot open explorer: {e}"))?;
    Ok(())
}

#[derive(Serialize)]
struct CursorPackState {
    name: String,
    path: String,
    url: String,
}

#[derive(Serialize)]
struct CursorPack {
    name: String,
    label: String,
    pointer_path: String,
    pointer_url: String,
    states: Vec<CursorPackState>,
}

fn resolve_cursors_dir() -> Option<std::path::PathBuf> {
    let candidates = [
        std::env::current_dir().ok()?.join("public").join("Cursors"),
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("public")
            .join("Cursors"),
    ];
    candidates.into_iter().find(|p| p.is_dir())
}

#[derive(Serialize)]
struct WallpaperEntry {
    name: String,
    path: String,
    url: String,
}

const WALLPAPER_EXTENSIONS: [&str; 6] = ["png", "jpg", "jpeg", "webp", "bmp", "gif"];

fn resolve_wallpapers_dir() -> Option<std::path::PathBuf> {
    let candidates = [
        std::env::current_dir()
            .ok()?
            .join("public")
            .join("Wallpapers"),
        std::env::current_dir()
            .ok()?
            .join("public")
            .join("wallpapers"),
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("public")
            .join("Wallpapers"),
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("public")
            .join("wallpapers"),
    ];
    candidates.into_iter().find(|p| p.is_dir())
}

/// Enumerate wallpaper images under public/Wallpapers/ (png/jpg/jpeg/webp/bmp/gif).
#[tauri::command]
fn list_wallpaper_images() -> std::result::Result<Vec<WallpaperEntry>, String> {
    let dir = resolve_wallpapers_dir()
        .ok_or_else(|| "public/Wallpapers directory not found".to_string())?;
    let mut entries: Vec<WallpaperEntry> = Vec::new();

    for entry in
        std::fs::read_dir(&dir).map_err(|e| format!("Cannot read {}: {e}", dir.display()))?
    {
        let entry = entry.map_err(|e| format!("Cannot read dir entry: {e}"))?;
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let ext = entry
            .path()
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if !WALLPAPER_EXTENSIONS.contains(&ext.as_str()) {
            continue;
        }
        entries.push(WallpaperEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            url: format!("/Wallpapers/{}", entry.file_name().to_string_lossy()),
        });
    }

    entries.sort_by_key(|a| a.name.to_lowercase());
    Ok(entries)
}

fn pack_label(name: &str) -> String {
    name.split(['-', '_', ' '])
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Enumerate cursor packs under public/Cursors/<pack-name>/*.png.
/// Each subfolder is one selectable pack; `pointer.png` is preferred as the
/// active state, otherwise the first PNG found is used.
#[tauri::command]
fn list_cursor_packs() -> std::result::Result<Vec<CursorPack>, String> {
    let dir =
        resolve_cursors_dir().ok_or_else(|| "public/Cursors directory not found".to_string())?;
    let mut packs = Vec::new();

    for entry in
        std::fs::read_dir(&dir).map_err(|e| format!("Cannot read {}: {e}", dir.display()))?
    {
        let entry = entry.map_err(|e| format!("Cannot read dir entry: {e}"))?;
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }

        let pack_dir = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        let mut states: Vec<CursorPackState> = Vec::new();
        let mut pointer_path: Option<String> = None;
        let mut pointer_url: Option<String> = None;

        if let Ok(rd) = std::fs::read_dir(&pack_dir) {
            for f in rd.flatten() {
                if !f.file_type().map(|t| t.is_file()).unwrap_or(false) {
                    continue;
                }
                let ext = f
                    .path()
                    .extension()
                    .map(|e| e.to_string_lossy().to_lowercase())
                    .unwrap_or_default();
                if ext != "png" {
                    continue;
                }
                let fname = f.file_name().to_string_lossy().to_string();
                let path = f.path().to_string_lossy().to_string();
                let url = format!("/Cursors/{name}/{fname}");
                if pointer_path.is_none() && fname.to_lowercase() == "pointer.png" {
                    pointer_path = Some(path.clone());
                    pointer_url = Some(url.clone());
                }
                states.push(CursorPackState {
                    name: fname.clone(),
                    path,
                    url,
                });
            }
        }

        if states.is_empty() {
            continue;
        }

        states.sort_by(|a, b| a.name.cmp(&b.name));
        let pointer_path = pointer_path.unwrap_or_else(|| states[0].path.clone());
        let pointer_url = pointer_url.unwrap_or_else(|| states[0].url.clone());
        packs.push(CursorPack {
            label: pack_label(&name),
            name,
            pointer_path,
            pointer_url,
            states,
        });
    }

    packs.sort_by_key(|a| a.label.to_lowercase());
    Ok(packs)
}

#[tauri::command]
fn list_directory(path: String) -> std::result::Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();
    let dir = std::fs::read_dir(&path).map_err(|e| format!("Cannot read directory {path}: {e}"))?;
    for entry in dir.flatten() {
        let meta = entry.metadata().ok();
        entries.push(FileEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            is_dir: meta.as_ref().map(|m| m.is_dir()).unwrap_or(false),
            size: meta.map(|m| m.len()).unwrap_or(0),
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordingDataPaths {
    data_dir: String,
    log_path: String,
}

fn recording_data_paths(video_path: &Path) -> (PathBuf, PathBuf) {
    let parent = video_path.parent().unwrap_or_else(|| Path::new("."));
    let stem = video_path.file_stem().unwrap_or_default().to_string_lossy();
    let data_dir = parent.join(stem.as_ref());
    let log_path = data_dir.join("events.json");
    (data_dir, log_path)
}

#[cfg(target_os = "windows")]
fn set_support_folder_hidden(path: &Path, hidden: bool) -> std::result::Result<(), String> {
    let flag = if hidden { "+H" } else { "-H" };
    let status = process::background_command("attrib.exe")
        .arg(flag)
        .arg(path.as_os_str())
        .status()
        .map_err(|error| format!("Unable to update recording-data visibility: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("attrib.exe exited with {status}"))
    }
}

#[cfg(not(target_os = "windows"))]
fn set_support_folder_hidden(_path: &Path, _hidden: bool) -> std::result::Result<(), String> {
    Ok(())
}

/// Create the private working-data folder used by input logging and both
/// audio tracks. The MP4 deliberately remains in Videos\Snap so Explorer
/// presents a clean recording library owned by Snap.
#[tauri::command]
fn prepare_recording_data(
    video_path: String,
    show_support_files: bool,
) -> std::result::Result<RecordingDataPaths, String> {
    let (data_dir, log_path) = recording_data_paths(Path::new(&video_path));
    std::fs::create_dir_all(&data_dir)
        .map_err(|error| format!("Unable to create recording-data folder: {error}"))?;
    set_support_folder_hidden(&data_dir, !show_support_files)?;
    Ok(RecordingDataPaths {
        data_dir: data_dir.to_string_lossy().to_string(),
        log_path: log_path.to_string_lossy().to_string(),
    })
}

/// Resolve current and legacy input-log layouts. This keeps old recordings,
/// imported recordings, auto-zoom, and export working across the migration.
#[tauri::command]
fn resolve_recording_log_path(video_path: String) -> String {
    let video = Path::new(&video_path);
    let (data_dir, preferred) = recording_data_paths(video);
    if preferred.exists() {
        return preferred.to_string_lossy().to_string();
    }

    let stem = video.file_stem().unwrap_or_default().to_string_lossy();
    let nested_legacy = data_dir.join(format!("{stem}.json"));
    if nested_legacy.exists() {
        return nested_legacy.to_string_lossy().to_string();
    }

    let flat_legacy = video.with_extension("json");
    if flat_legacy.exists() {
        return flat_legacy.to_string_lossy().to_string();
    }
    preferred.to_string_lossy().to_string()
}

/// Move legacy flat JSON sidecars into their matching audio folders and set
/// folder visibility to the user's preference. Individual failures are kept
/// non-fatal so one locked recording cannot block the rest of the library.
#[tauri::command]
fn organize_recording_data(show_support_files: bool) -> std::result::Result<usize, String> {
    let videos = PathBuf::from(capture::get_videos_dir()?);
    std::fs::create_dir_all(&videos)
        .map_err(|error| format!("Unable to open Videos folder: {error}"))?;
    let mut moved = 0usize;

    // Migrate only Snap-owned recordings from the former flat Videos layout.
    // Existing destination names win, so this is safe to retry and never
    // overwrites a user's recording.
    let legacy_root = capture::get_videos_root();
    if legacy_root != videos {
        if let Ok(legacy_entries) = std::fs::read_dir(&legacy_root) {
            for entry in legacy_entries.flatten() {
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().to_string();
                if !name.starts_with("snap_") {
                    continue;
                }
                let is_support_folder = path.is_dir()
                    && [
                        "events.json",
                        "system_audio.wav",
                        "mic_audio.wav",
                        "device_audio.wav",
                        "mobile-recording.json",
                        "mobile-capture.partial.mkv",
                    ]
                    .iter()
                    .any(|asset| path.join(asset).exists());
                let is_snap_asset = is_support_folder
                    || path
                        .extension()
                        .and_then(|value| value.to_str())
                        .is_some_and(|value| {
                            value.eq_ignore_ascii_case("mp4") || value.eq_ignore_ascii_case("json")
                        });
                if !is_snap_asset {
                    continue;
                }
                let destination = videos.join(&name);
                if !destination.exists() && std::fs::rename(&path, &destination).is_ok() {
                    moved += 1;
                }
            }
        }
    }

    let entries: Vec<_> = std::fs::read_dir(&videos)
        .map_err(|error| format!("Unable to scan Videos folder: {error}"))?
        .flatten()
        .collect();

    for entry in &entries {
        let path = entry.path();
        if !path.is_file()
            || path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| !value.eq_ignore_ascii_case("json"))
                .unwrap_or(true)
        {
            continue;
        }
        let stem = path.file_stem().unwrap_or_default().to_string_lossy();
        if !stem.starts_with("snap_") {
            continue;
        }
        let data_dir = videos.join(stem.as_ref());
        if std::fs::create_dir_all(&data_dir).is_err() {
            continue;
        }
        let destination = data_dir.join("events.json");
        if !destination.exists() && std::fs::rename(&path, &destination).is_ok() {
            moved += 1;
        }
        let _ = set_support_folder_hidden(&data_dir, !show_support_files);
    }

    for entry in entries {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        if name.starts_with("snap_") {
            let _ = set_support_folder_hidden(&path, !show_support_files);
        }
    }
    Ok(moved)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(EditorPaths(Mutex::new(None)))
        .manage(DockState(Mutex::new(DockStateSnapshot::default())))
        .invoke_handler(tauri::generate_handler![
            capture::enumerate_targets,
            capture::get_target_bounds,
            capture::start_recording,
            capture::stop_recording,
            capture::set_paused,
            capture::get_videos_dir,
            audio::enumerate_audio_devices,
            enumerate_video_devices,
            audio::start_audio_capture,
            audio::stop_audio_capture,
            audio::set_audio_paused,
            audio::set_microphone_muted,
            mobile::mobile_environment,
            mobile::install_android_capture_support,
            mobile::enumerate_mobile_devices,
            mobile::enumerate_mobile_capture_sources,
            mobile::start_mobile_recording,
            mobile::mobile_recording_status,
            mobile::stop_mobile_recording,
            mobile::recover_mobile_recordings,
            input_hook::start_input_logging,
            input_hook::stop_input_logging,
            input_hook::set_input_paused,
            export::export_video,
            export::open_export_sink,
            export::write_export_chunk,
            export::close_export_sink,
            export::finalize_canvas_export,
            open_editor_window,
            open_teleprompter_window,
            open_settings_window,
            window_ready,
            get_pending_editor_paths,
            begin_region_selection,
            end_region_selection,
            set_dock_visible,
            dock_window_ready,
            set_dock_compact,
            update_dock_state,
            get_dock_state,
            dock_action,
            set_recording_overlay,
            set_overlay_paused,
            set_countdown,
            read_text_file,
            list_directory,
            prepare_recording_data,
            resolve_recording_log_path,
            organize_recording_data,
            list_cursor_packs,
            list_wallpaper_images,
            open_explorer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
