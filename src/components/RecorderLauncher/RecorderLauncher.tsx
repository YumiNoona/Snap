import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import RegionSelector from "./RegionSelector";
import DeviceView from "./DeviceView";
import TeleprompterWindow from "../Teleprompter/TeleprompterWindow";
import FloatingToolbar from "./FloatingToolbar";
import "./RecorderLauncher.css";

// ── SVG Icons ───────────────────────────────────────────────────────────────

function SnapLogo() {
  return (
    <svg viewBox="0 0 32 32" fill="none" width="24" height="24">
      <circle cx="16" cy="16" r="14" fill="url(#snap_logo_grad)" />
      <circle cx="16" cy="16" r="6" fill="#0d0d12" />
      <path d="M16 6 A 10 10 0 0 1 26 16" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" />
      <defs>
        <linearGradient id="snap_logo_grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3b82f6" />
          <stop offset="0.5" stopColor="#a855f7" />
          <stop offset="1" stopColor="#ec4899" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function MinimizeIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <line x1="2" y1="6" x2="10" y2="6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <line x1="2" y1="2" x2="10" y2="10" />
      <line x1="10" y1="2" x2="2" y2="10" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <rect x="2" y="2" width="8" height="8" rx="1" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
      <rect x="2" y="5" width="15" height="14" rx="3" />
      <path d="M17 9l5-3v12l-5-3" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8" />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

function TeleprompterIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <line x1="7" y1="9" x2="17" y2="9" />
      <line x1="7" y1="13" x2="17" y2="13" />
    </svg>
  );
}

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
}

// ── Component ───────────────────────────────────────────────────────────────

export default function RecorderLauncher({ onOpenEditor }: Props) {
  const [targets, setTargets] = useState<DisplayTarget[]>([]);
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [_selectedTarget, setSelectedTarget] = useState("");
  const [selectedMic, setSelectedMic] = useState("default");
  const [selectedSpeaker, setSelectedSpeaker] = useState("default");
  const [selectedCamera, setSelectedCamera] = useState("OBS Virtual Camera");

  // Navigation / Views
  const [activeView, setActiveView] = useState<"launcher" | "device">("launcher");
  const [showTeleprompter, setShowTeleprompter] = useState(false);
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
  const appWindow = getCurrentWindow();

  // Countdown-then-record: shows 3→2→1 then starts actual recording
  const startWithCountdown = (targetId: string) => {
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

  // ── Recording Actions ──────────────────────────────────────────────────
  const startRecording = async (targetId: string) => {
    try {
      const videosDir = await invoke<string>("get_videos_dir");
      const stamp = Date.now();
      const videoPath = `${videosDir}\\snap_${stamp}.mp4`;
      const logPath = `${videosDir}\\snap_${stamp}.jsonl`;
      const audioDir = `${videosDir}\\snap_${stamp}`;

      setRecordStatus("Starting...");
      await invoke("start_recording", { targetId, outputPath: videoPath });
      await invoke("start_input_logging", { outputPath: logPath, sessionStartTime: "0" });
      try {
        await invoke("start_audio_capture", { micDeviceId: selectedMic, outputDir: audioDir });
      } catch (e) {
        console.error("Audio capture failed:", e);
      }

      setRecording(true);
      setIsPaused(false);
      setElapsed(0);
      setLastVideo(videoPath);
      setLastLog(logPath);

      elapsedRef.current = setInterval(() => setElapsed((p) => p + 1), 1000);
      setRecordStatus("Recording");
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

      // Open directly in Editor
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

  const handlePickWindow = async (id: string) => {
    setShowWindowPicker(false);
    setSelectedTarget(id);
    startWithCountdown(id);
  };

  const handleCustom = () => {
    setShowRegionSelector(true);
  };

  const handleRegionSelect = async (region: { x: number; y: number; w: number; h: number }) => {
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

  const microphones = audioDevices.filter((d) => d.device_type === "microphone");
  const speakers = audioDevices.filter((d) => d.device_type === "speaker");

  // Sub-view: Device Connection (image_1.png / image_2.png)
  if (activeView === "device") {
    return <DeviceView onBack={() => setActiveView("launcher")} />;
  }

  return (
    <div className="app-layout">
      {/* ── Topbar (FocuSee Header Style) ────────────────────────── */}
      <header className="titlebar">
        <div
          className="titlebar-drag-area"
          onMouseDown={async (e) => {
            e.preventDefault();
            await appWindow.startDragging();
          }}
        />
        <div className="titlebar-left">
          <div className="brand-logo-area">
            <SnapLogo />
            <span className="app-name">Snap</span>
          </div>

          <div className="menu-wrap">
            <span
              className="menu-item"
              onClick={(e) => { e.stopPropagation(); setShowFileMenu(!showFileMenu); }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
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
          <button className="titlebar-icon-btn" title="Settings">
            <SettingsIcon />
          </button>

          <div className="window-controls">
            <button className="window-btn" title="Minimize" onClick={() => appWindow.minimize()}>
              <MinimizeIcon />
            </button>
            <button className="window-btn" title="Maximize" onClick={() => appWindow.toggleMaximize()}>
              <MaximizeIcon />
            </button>
            <button className="window-btn close-btn" title="Close" onClick={() => appWindow.close()}>
              <CloseIcon />
            </button>
          </div>
        </div>
      </header>

      {/* ── Main Workspace ─────────────────────────────────────── */}
      <div className="main-content">
        {/* Left: Recording Modes Grid (image_0.png) */}
        <div className="recording-modes-area">
          <h2 className="section-heading">Please select the recording mode</h2>

          <div className="focusee-mode-cards-grid">
            {/* Card 1: Full Screen */}
            <div className="focusee-card" onClick={handleFullScreen}>
              <div className="card-thumb-frame">
                <div className="wallpaper-preview full-screen-preview" />
              </div>
              <span className="card-title-text">Full Screen</span>
            </div>

            {/* Card 2: Custom Region */}
            <div className="focusee-card" onClick={handleCustom}>
              <div className="card-thumb-frame">
                <div className="wallpaper-preview custom-region-preview">
                  <div className="cyan-crop-box" />
                </div>
              </div>
              <span className="card-title-text">Custom</span>
            </div>

            {/* Card 3: Window */}
            <div className="focusee-card" onClick={handleWindow}>
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
            <div className="focusee-card" onClick={handleDevice}>
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

          {lastVideo && lastLog && !recording && (
            <button className="open-last-btn" onClick={() => onOpenEditor(lastVideo, lastLog)}>
              Open Last Recording in Editor
            </button>
          )}
        </div>

        {/* Right Sidebar: Device & Tool Panel (image_0.png) */}
        <aside className="focusee-sidebar">
          <h3 className="sidebar-heading">Device &amp; Tool</h3>

          {/* Camera Dropdown */}
          <div className="focusee-device-select-row">
            <div className="device-icon-box">
              <CameraIcon />
            </div>
            <select
              value={selectedCamera}
              onChange={(e) => setSelectedCamera(e.target.value)}
              className="sidebar-select"
            >
              <option value="OBS Virtual Cam">OBS Virtual Cam...</option>
              <option value="Integrated Webcam">Integrated Webcam</option>
              <option value="Disabled">No Camera</option>
            </select>
            <div className="active-accent-bar blue" />
          </div>

          {/* Microphone Dropdown */}
          <div className="focusee-device-select-row">
            <div className="device-icon-box">
              <MicIcon />
            </div>
            <select
              value={selectedMic}
              onChange={(e) => setSelectedMic(e.target.value)}
              className="sidebar-select"
            >
              <option value="default">Microphone (System...)</option>
              {microphones.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <div className="active-accent-bar purple" />
          </div>

          {/* Speaker Dropdown */}
          <div className="focusee-device-select-row">
            <div className="device-icon-box">
              <SpeakerIcon />
            </div>
            <select
              value={selectedSpeaker}
              onChange={(e) => setSelectedSpeaker(e.target.value)}
              className="sidebar-select"
            >
              <option value="default">Headphones (System...)</option>
              {speakers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <div className="active-accent-bar purple" />
          </div>

          {/* Teleprompter Button */}
          <button
            className="teleprompter-sidebar-btn"
            onClick={() => setShowTeleprompter(true)}
          >
            <TeleprompterIcon />
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
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <line x1="3" y1="9" x2="21" y2="9" />
                    </svg>
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

      {/* ── Teleprompter Window Module ───────────────────────────── */}
      {showTeleprompter && (
        <TeleprompterWindow onClose={() => setShowTeleprompter(false)} />
      )}

      {/* ── 3-2-1 Countdown Overlay (before recording starts) ────── */}
      {countdownValue !== null && (
        <div className="countdown-fullscreen-overlay">
          <div className="countdown-number">{countdownValue}</div>
        </div>
      )}

      {/* ── Floating Recording Bar ─────────────────────────────────── */}
      {recording && (
        <FloatingToolbar
          elapsed={elapsed}
          onStop={stopRecording}
          onPauseToggle={() => setIsPaused(!isPaused)}
          isPaused={isPaused}
          onMicToggle={() => setMicMuted(!micMuted)}
          micMuted={micMuted}
        />
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
                  onClick={() => {
                    setShowFileBrowser(false);
                    onOpenEditor(f.path, f.path.replace(/\.mp4$/i, ".jsonl"));
                  }}
                >
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
