import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import {
  Settings,
  Minus,
  X,
  Folder,
  Video,
  Mic,
  Volume2,
  FileText,
  MonitorCheck,
  AppWindow,
} from "lucide-react";
import RegionSelector from "./RegionSelector";
import DeviceView from "./DeviceView";
import Dropdown from "../shared/Dropdown";
import "./RecorderLauncher.css";

// ── Types ───────────────────────────────────────────────────────────────────

interface DisplayTarget {
  id: string;
  name: string;
  target_type: string;
}

interface AudioDevice {
  id: string;
  name: string;
  device_type: string;
}

interface Props {
  onOpenEditor: (videoPath: string, logPath: string) => void;
  onOpenTeleprompter: () => void;
  editorError?: string | null;
}

type BorderStyle = "off" | "red" | "dashed";

interface AppSettings {
  borderStyle: BorderStyle;
  countdown: boolean;
}

const SETTINGS_KEY = "snap.settings";
const DEFAULT_SETTINGS: AppSettings = { borderStyle: "off", countdown: true };

// ── Component ───────────────────────────────────────────────────────────────

export default function RecorderLauncher({ onOpenEditor, onOpenTeleprompter, editorError }: Props) {
  const [targets, setTargets] = useState<DisplayTarget[]>([]);
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [_selectedTarget, setSelectedTarget] = useState("");
  const [selectedMic, setSelectedMic] = useState("default");
  const [selectedSpeaker, setSelectedSpeaker] = useState("default");
  const [selectedCamera, setSelectedCamera] = useState("OBS Virtual Camera");

  // Settings (persisted)
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  const [showSettings, setShowSettings] = useState(false);

  // Navigation / Views
  const [activeView, setActiveView] = useState<"launcher" | "device">("launcher");
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [showWindowPicker, setShowWindowPicker] = useState(false);
  const [showRegionSelector, setShowRegionSelector] = useState(false);
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [fileList, setFileList] = useState<{ name: string; path: string }[]>([]);

  // Recording
  const [recording, setRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [recordStatus, setRecordStatus] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [lastVideo, setLastVideo] = useState("");
  const [lastLog, setLastLog] = useState("");
  const [countdownValue, setCountdownValue] = useState<number | null>(null);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const regionRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const pausedRef = useRef(false);
  const appWindow = getCurrentWindow();

  // Keep the ref in sync so the elapsed interval can pause without re-creating.
  useEffect(() => {
    pausedRef.current = isPaused;
  }, [isPaused]);

  // Persist settings
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // ignore storage errors
    }
  }, [settings]);

  // Countdown-then-record: shows 3→2→1 then starts actual recording.
  // Respects the "countdown" setting — off starts immediately.
  const startWithCountdown = (targetId: string) => {
    if (!settings.countdown) {
      startRecording(targetId);
      return;
    }
    setCountdownValue(3);
    let count = 3;
    const tick = () => {
      count -= 1;
      if (count > 0) {
        setCountdownValue(count);
        countdownRef.current = setTimeout(tick, 1000);
      } else {
        setCountdownValue(null);
        startRecording(targetId);
      }
    };
    countdownRef.current = setTimeout(tick, 1000);
  };

  // ── Load devices ───────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const t = await invoke<DisplayTarget[]>("enumerate_targets");
        setTargets(t);
        const firstMonitor = t.find((x) => x.target_type === "monitor");
        if (firstMonitor) setSelectedTarget(firstMonitor.id);
      } catch (e) {
        console.error("Failed to enumerate targets:", e);
      }
      try {
        const d = await invoke<AudioDevice[]>("enumerate_audio_devices");
        setAudioDevices(d);
      } catch (e) {
        console.error("Failed to enumerate audio devices:", e);
      }
    })();
  }, []);

  const [shutterFlash, setShutterFlash] = useState(false);

  // ── Recording Actions ──────────────────────────────────────────────────
  const startRecording = async (targetId: string) => {
    try {
      const videosDir = await invoke<string>("get_videos_dir");
      const stamp = Date.now();
      const videoPath = `${videosDir}\\snap_${stamp}.mp4`;
      const logPath = `${videosDir}\\snap_${stamp}.json`;
      const audioDir = `${videosDir}\\snap_${stamp}`;

      setRecordStatus("Starting...");
      await invoke("start_recording", { targetId, outputPath: videoPath });
      let region: { x: number; y: number; w: number; h: number } | null = null;
      try {
        region = await invoke<{ x: number; y: number; w: number; h: number }>("get_target_bounds", { targetId });
      } catch {
        // region unknown — editor falls back to full-desktop mapping
      }
      regionRef.current = region;
      await invoke("start_input_logging", {
        outputPath: logPath,
        sessionStartTime: "0",
        regionX: region?.x,
        regionY: region?.y,
        regionW: region?.w,
        regionH: region?.h,
      });
      try {
        await invoke("start_audio_capture", { micDeviceId: selectedMic, outputDir: audioDir });
      } catch (e) {
        console.error("Audio capture failed:", e);
      }

      // Single 120ms soft amber shutter pulse micro-interaction when recording starts
      setShutterFlash(true);
      setTimeout(() => setShutterFlash(false), 120);

      setRecording(true);
      setIsPaused(false);
      setElapsed(0);
      setLastVideo(videoPath);
      setLastLog(logPath);

      elapsedRef.current = setInterval(
        () => setElapsed((p) => (pausedRef.current ? p : p + 1)),
        1000
      );
      setRecordStatus("Recording");

      // Show the floating dock on the desktop (its own small window).
      invoke("set_dock_visible", { visible: true }).catch(() => {});
      invoke("update_dock_state", {
        snapshot: { recording: true, elapsed: 0, paused: false, mic_muted: false },
      }).catch(() => {});

      // Draw the recording-area border overlay (red / dashed / off).
      if (settings.borderStyle !== "off") {
        invoke("set_recording_overlay", {
          enabled: true,
          style: settings.borderStyle,
          region: regionRef.current,
        }).catch(() => {});
      }
    } catch (e) {
      setRecordStatus(`Error: ${e}`);
    }
  };

  const stopRecording = async () => {
    try {
      if (elapsedRef.current) clearInterval(elapsedRef.current);
      setRecordStatus("Stopping...");
      await invoke("stop_recording");
      const count = await invoke<number>("stop_input_logging");
      try { await invoke("stop_audio_capture"); } catch { /* ignore */ }
      setRecording(false);
      setRecordStatus(`Done — ${count} events captured`);

      // Hide the floating dock window + recording border overlay.
      invoke("set_dock_visible", { visible: false }).catch(() => {});
      invoke("set_recording_overlay", { enabled: false, style: "off", region: null }).catch(() => {});
      invoke("set_overlay_paused", { paused: false }).catch(() => {});
      setIsPaused(false);
      pausedRef.current = false;

      // Open the recording in its own editor window
      if (lastVideo && lastLog) {
        onOpenEditor(lastVideo, lastLog);
      }
    } catch (e) {
      setRecording(false);
      setRecordStatus(`Stop error: ${e}`);
    }
  };

  const handleFullScreen = async () => {
    const monitor = targets.find((t) => t.target_type === "monitor");
    if (!monitor) { setRecordStatus("No monitor found"); return; }
    setSelectedTarget(monitor.id);
    startWithCountdown(monitor.id);
  };

  const handleWindow = () => {
    setShowWindowPicker(true);
  };

  const handlePickWindow = (id: string) => {
    setShowWindowPicker(false);
    setSelectedTarget(id);
    startWithCountdown(id);
  };

  const handleCustom = () => {
    setShowRegionSelector(true);
  };

  const handleRegionSelect = (region: { x: number; y: number; w: number; h: number }) => {
    setShowRegionSelector(false);
    const monitor = targets.find((t) => t.target_type === "monitor");
    if (!monitor) return;
    setSelectedTarget(monitor.id);
    setRecordStatus(`Recording region ${region.w}x${region.h}`);
    startWithCountdown(monitor.id);
  };

  const handleDevice = () => {
    setActiveView("device");
  };

  const handleOpenRecording = async () => {
    setShowFileMenu(false);
    try {
      const dir = await invoke<string>("get_videos_dir");
      const files = await invoke<Array<{ name: string; path: string; is_dir: boolean; size: number }>>("list_directory", { path: dir });
      const recordings = files
        .filter((f) => !f.is_dir && f.name.endsWith(".mp4"))
        .map((f) => ({ name: f.name, path: f.path }));
      setFileList(recordings);
      setShowFileBrowser(true);
    } catch (e) {
      setRecordStatus(`Cannot browse: ${e}`);
    }
  };

  const openRecording = (videoPath: string) => {
    setShowFileBrowser(false);
    onOpenEditor(videoPath, videoPath.replace(/\.mp4$/i, ".json"));
  };

  const microphones = audioDevices.filter((d) => d.device_type === "microphone");
  const speakers = audioDevices.filter((d) => d.device_type === "speaker");

  // Pause (true) / resume (false) the recording on all capture backends, and
  // keep the dock + overlay UI in sync. The paused segment is omitted from the
  // video, input log, and audio tracks entirely.
  const togglePause = () => {
    const next = !isPaused;
    setIsPaused(next);
    pausedRef.current = next;
    invoke("set_paused", { paused: next }).catch(() => {});
    invoke("set_input_paused", { paused: next }).catch(() => {});
    invoke("set_audio_paused", { paused: next }).catch(() => {});
    setRecordStatus(next ? "Paused" : "Recording");
  };

  // Keep the floating dock window in sync with recording state.
  useEffect(() => {
    if (!recording) return;
    invoke("update_dock_state", {
      snapshot: { recording: true, elapsed, paused: isPaused, mic_muted: micMuted },
    }).catch(() => {});
    invoke("set_overlay_paused", { paused: isPaused }).catch(() => {});
  }, [recording, elapsed, isPaused, micMuted]);

  // Relay dock button presses (stop / pause / mic) back to this window.
  const actionHandlersRef = useRef<{ stop: () => void }>({ stop: () => {} });
  useEffect(() => {
    actionHandlersRef.current = { stop: stopRecording };
  });

  useEffect(() => {
    const un = listen<string>("dock-action", (e) => {
      if (e.payload === "stop") {
        actionHandlersRef.current.stop();
      } else if (e.payload === "pause") {
        togglePause();
      } else if (e.payload === "mic") {
        setMicMuted((m) => !m);
      }
    });
    return () => {
      un.then((fn) => fn());
    };
  });

  // Safety: never leave the dock floating if this window goes away.
  useEffect(() => {
    return () => {
      invoke("set_dock_visible", { visible: false }).catch(() => {});
    };
  }, []);

  // Sub-view: Device Connection (image_1.png / image_2.png)
  if (activeView === "device") {
    return <DeviceView onBack={() => setActiveView("launcher")} />;
  }

  return (
    <div className={`app-layout ${shutterFlash ? "shutter-flash-active" : ""}`}>
      {/* ── Topbar ────────────────────────── */}
      <header className="titlebar" data-tauri-drag-region>
        <div
          className="titlebar-drag-area"
          data-tauri-drag-region
          onMouseDown={async (e) => {
            e.preventDefault();
            await appWindow.startDragging();
          }}
        />
        <div className="titlebar-left">
          <div className="brand-logo-area">
            <span className="brand-logo-text">S</span>
            <span className="app-name">Snap</span>
          </div>

          <div className="menu-wrap">
            <span
              className="menu-item"
              onClick={(e) => { e.stopPropagation(); setShowFileMenu(!showFileMenu); }}
            >
              <Folder size={14} />
              File
            </span>
            {showFileMenu && (
              <div className="dropdown-menu" onClick={(e) => e.stopPropagation()}>
                <button className="dropdown-item" onClick={handleOpenRecording}>
                  Open Recording...
                </button>
                <button className="dropdown-item" onClick={async () => {
                  const dir = await invoke<string>("get_videos_dir");
                  await invoke("open_explorer", { path: dir });
                }}>
                  Output Folder
                </button>
                <div className="dropdown-divider" />
                <button className="dropdown-item danger" onClick={() => appWindow.close()}>
                  Exit
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="titlebar-right">
          <button className="titlebar-icon-btn" title="Settings" onClick={() => setShowSettings(true)}>
            <Settings size={15} />
          </button>

          <div className="window-controls">
            <button className="window-btn" title="Minimize" onClick={() => appWindow.minimize()}>
              <Minus size={12} />
            </button>
            <button className="window-btn close-btn" title="Close" onClick={() => appWindow.close()}>
              <X size={12} />
            </button>
          </div>
        </div>
      </header>

      {/* ── Main Workspace ─────────────────────────────────────── */}
      <div className="main-content">
        {/* Left: Recording Modes Grid */}
        <div className="recording-modes-area">
          <h2 className="section-heading">Pick a mode to start recording</h2>

          <div className="focusee-mode-cards-grid">
            {/* Card 1: Full Screen */}
            <div className="focusee-card" onClick={handleFullScreen} title="Record Full Screen">
              <div className="card-thumb-frame">
                <div className="wallpaper-preview full-screen-preview">
                  <MonitorCheck size={28} className="card-preview-icon" />
                </div>
              </div>
              <span className="card-title-text">Full Screen</span>
            </div>

            {/* Card 2: Custom Region */}
            <div className="focusee-card" onClick={handleCustom} title="Record a Custom Region">
              <div className="card-thumb-frame">
                <div className="wallpaper-preview custom-region-preview">
                  <div className="cyan-crop-box" />
                </div>
              </div>
              <span className="card-title-text">Custom</span>
            </div>

            {/* Card 3: Window */}
            <div className="focusee-card" onClick={handleWindow} title="Record a Window">
              <div className="card-thumb-frame">
                <div className="wallpaper-preview window-preview">
                  <div className="window-mockup-overlay">
                    <div className="mockup-bar">
                      <span className="dot" /><span className="dot" /><span className="dot" />
                    </div>
                  </div>
                </div>
              </div>
              <span className="card-title-text">Window</span>
            </div>

            {/* Card 4: Device */}
            <div className="focusee-card" onClick={handleDevice} title="Record a Mobile Device">
              <div className="card-thumb-frame">
                <div className="wallpaper-preview device-preview">
                  <div className="phone-illustration-icon" />
                </div>
              </div>
              <span className="card-title-text">Device</span>
            </div>
          </div>

          {recordStatus && (
            <p className="launcher-status-text">{recordStatus}</p>
          )}

          {editorError && (
            <p className="launcher-status-text" style={{ color: "var(--danger)" }}>
              Editor error: {editorError}
            </p>
          )}

          {lastVideo && lastLog && !recording && (
            <button className="open-last-btn" onClick={() => onOpenEditor(lastVideo, lastLog)}>
              Open Last Recording
            </button>
          )}
        </div>

        {/* Right Sidebar: Device & Tool Panel */}
        <aside className="focusee-sidebar">
          <h3 className="sidebar-heading">Device &amp; Tool</h3>

          {/* Camera Dropdown */}
          <Dropdown
            value={selectedCamera}
            onChange={setSelectedCamera}
            icon={<Video size={16} />}
            options={[
              { value: "OBS Virtual Cam", label: "OBS Virtual Cam..." },
              { value: "Integrated Webcam", label: "Integrated Webcam" },
              { value: "Disabled", label: "No Camera" },
            ]}
          />

          {/* Microphone Dropdown */}
          <Dropdown
            value={selectedMic}
            onChange={setSelectedMic}
            icon={<Mic size={16} />}
            options={[
              { value: "default", label: "Microphone (Default)" },
              ...microphones.map((m) => ({ value: m.id, label: m.name })),
            ]}
          />

          {/* Speaker Dropdown */}
          <Dropdown
            value={selectedSpeaker}
            onChange={setSelectedSpeaker}
            icon={<Volume2 size={16} />}
            options={[
              { value: "default", label: "Headphones (System)" },
              ...speakers.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />

          {/* Teleprompter Button */}
          <button
            className="teleprompter-sidebar-btn"
            onClick={() => onOpenTeleprompter()}
          >
            <FileText size={15} />
            Teleprompter
          </button>
        </aside>
      </div>

      {/* ── Window Picker Modal ────────────────────────────────────── */}
      {showWindowPicker && (
        <div className="modal-overlay" onClick={() => setShowWindowPicker(false)}>
          <div className="focusee-modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Select Window to Record</h3>
            <p className="modal-sub">Pick an open application, game, or browser window</p>
            <div className="modal-window-list">
              {targets
                .filter((t) => t.target_type === "window")
                .map((t) => (
                  <button
                    key={t.id}
                    className="window-option-btn"
                    onClick={() => handlePickWindow(t.id)}
                  >
                    <AppWindow size={16} />
                    <span>{t.name}</span>
                  </button>
                ))}
            </div>
            <button className="modal-close-btn" onClick={() => setShowWindowPicker(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Region Selector Overlay ────────────────────────────────── */}
      {showRegionSelector && (
        <RegionSelector
          onSelect={handleRegionSelect}
          onCancel={() => setShowRegionSelector(false)}
        />
      )}

      {/* ── 3-2-1 Countdown Overlay (before recording starts) ────── */}
      {countdownValue !== null && (
        <div className="countdown-fullscreen-overlay">
          <div className="countdown-number">{countdownValue}</div>
        </div>
      )}

      {/* ── Settings Modal ──────────────────────────────────────── */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="focusee-modal-card settings-card" onClick={(e) => e.stopPropagation()}>
            <div className="settings-modal-header">
              <h3>Settings</h3>
              <button className="settings-close-btn" title="Close" onClick={() => setShowSettings(false)}>
                <X size={14} />
              </button>
            </div>

            <div className="settings-section">
              <span className="settings-label">Recording Border</span>
              <div className="segmented-control">
                {(["off", "red", "dashed"] as BorderStyle[]).map((s) => (
                  <button
                    key={s}
                    className={`segment ${settings.borderStyle === s ? "active" : ""}`}
                    onClick={() => setSettings({ ...settings, borderStyle: s })}
                  >
                    {s === "off" ? "Off" : s === "red" ? "Red" : "Dashed White"}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-section toggle-row">
              <span className="settings-label">3-2-1 Countdown</span>
              <div
                className={`toggle-switch ${settings.countdown ? "on" : ""}`}
                onClick={() => setSettings({ ...settings, countdown: !settings.countdown })}
                title={settings.countdown ? "Countdown on — disable to start instantly" : "Countdown off — starts immediately"}
              >
                <div className="toggle-knob" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── File Browser Modal ─────────────────────────────────────── */}
      {showFileBrowser && (
        <div className="modal-overlay" onClick={() => setShowFileBrowser(false)}>
          <div className="focusee-modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Open Recording</h3>
            <div className="modal-window-list">
              {fileList.map((f) => (
                <button
                  key={f.path}
                  className="window-option-btn"
                  onClick={() => openRecording(f.path)}
                >
                  <AppWindow size={16} />
                  <span>{f.name}</span>
                </button>
              ))}
            </div>
            <button className="modal-close-btn" onClick={() => setShowFileBrowser(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}