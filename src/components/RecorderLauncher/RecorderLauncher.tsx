import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Settings,
  Minus,
  Square,
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
import TeleprompterWindow from "../Teleprompter/TeleprompterWindow";
import FloatingToolbar from "./FloatingToolbar";
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
          <button className="titlebar-icon-btn" title="Settings">
            <Settings size={15} />
          </button>

          <div className="window-controls">
            <button className="window-btn" title="Minimize" onClick={() => appWindow.minimize()}>
              <Minus size={12} />
            </button>
            <button className="window-btn" title="Maximize" onClick={() => appWindow.toggleMaximize()}>
              <Square size={10} />
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
          <p className="section-sub">Selecting a mode starts recording after a 3, 2, 1 countdown</p>

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
          <div className="focusee-device-select-row">
            <div className="device-icon-box">
              <Video size={16} />
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
          </div>

          {/* Microphone Dropdown */}
          <div className="focusee-device-select-row">
            <div className="device-icon-box">
              <Mic size={16} />
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
          </div>

          {/* Speaker Dropdown */}
          <div className="focusee-device-select-row">
            <div className="device-icon-box">
              <Volume2 size={16} />
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
          </div>

          {/* Teleprompter Button */}
          <button
            className="teleprompter-sidebar-btn"
            onClick={() => setShowTeleprompter(true)}
          >
            <FileText size={15} />
            Teleprompter
          </button>

          <p className="sidebar-hint">
            Modes start recording immediately after a countdown. Use the floating
            dock at the bottom to pause, mute, or stop.
          </p>
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

      {/* ── Floating Recording Dock (separate, center-bottom) ─────── */}
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