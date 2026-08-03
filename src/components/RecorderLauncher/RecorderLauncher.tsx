import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import RegionSelector from "./RegionSelector";
import "./RecorderLauncher.css";

// ── SVG Icons ───────────────────────────────────────────────────────────────

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

function FullScreenIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="6" width="40" height="28" rx="3" />
      <line x1="8" y1="38" x2="40" y2="38" />
      <line x1="24" y1="38" x2="24" y2="42" />
      <line x1="14" y1="42" x2="34" y2="42" />
    </svg>
  );
}

function CustomIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="10" y="8" width="28" height="32" rx="2" />
      <line x1="10" y1="16" x2="20" y2="8" />
      <line x1="18" y1="38" x2="28" y2="14" />
      <line x1="38" y1="16" x2="38" y2="40" />
      <circle cx="30" cy="26" r="2" fill="currentColor" />
      <circle cx="16" cy="30" r="2" fill="currentColor" />
    </svg>
  );
}

function WindowIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="8" width="38" height="32" rx="3" />
      <line x1="5" y1="18" x2="43" y2="18" />
      <circle cx="13" cy="13" r="1.5" fill="currentColor" />
      <circle cx="18.5" cy="13" r="1.5" fill="currentColor" />
      <circle cx="24" cy="13" r="1.5" fill="currentColor" />
    </svg>
  );
}

function DeviceIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="10" width="32" height="24" rx="3" />
      <circle cx="20" cy="22" r="3" />
      <path d="M20 22 L20 10" />
      <rect x="16" y="36" width="8" height="2" rx="1" />
      <rect x="38" y="14" width="6" height="16" rx="1" />
      <line x1="41" y1="18" x2="41" y2="26" strokeWidth="3" />
    </svg>
  );
}

function DebugIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  );
}

// ── Mode card ───────────────────────────────────────────────────────────────

interface ModeCardProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

function ModeCard({ icon, label, onClick }: ModeCardProps) {
  return (
    <button className="mode-card" onClick={onClick}>
      <div className="mode-card-icon">{icon}</div>
      <span className="mode-card-label">{label}</span>
    </button>
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

// ── Main component ──────────────────────────────────────────────────────────

export default function RecorderLauncher({ onOpenEditor }: Props) {
  const [targets, setTargets] = useState<DisplayTarget[]>([]);
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [selectedTarget, setSelectedTarget] = useState("");
  const [selectedMic, setSelectedMic] = useState("default");
  const [selectedSpeaker, setSelectedSpeaker] = useState("default");

  // UI state
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [showWindowPicker, setShowWindowPicker] = useState(false);
  const [showRegionSelector, setShowRegionSelector] = useState(false);
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [fileList, setFileList] = useState<{ name: string; path: string }[]>([]);
  const [browseDir, setBrowseDir] = useState("");
  const [settingsOutputDir, setSettingsOutputDir] = useState("");

  // Recording state
  const [recording, setRecording] = useState(false);
  const [recordStatus, setRecordStatus] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [lastVideo, setLastVideo] = useState("");
  const [lastLog, setLastLog] = useState("");
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appWindow = getCurrentWindow();

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
      try {
        const dir = await invoke<string>("get_videos_dir");
        setSettingsOutputDir(dir);
      } catch { /* ignore */ }
    })();
  }, []);

  // ── Start recording ────────────────────────────────────────────────────
  const startRecording = async (targetId: string) => {
    try {
      const videosDir = settingsOutputDir || (await invoke<string>("get_videos_dir"));
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
        console.error("Audio capture start failed:", e);
      }

      setRecording(true);
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
      try { await invoke("stop_audio_capture"); } catch { /* audio may not have started */ }
      setRecording(false);
      setRecordStatus(`Done — ${count} events captured`);
    } catch (e) {
      setRecording(false);
      setRecordStatus(`Stop error: ${e}`);
    }
  };

  // ── Mode handlers ──────────────────────────────────────────────────────
  const handleFullScreen = async () => {
    const monitor = targets.find((t) => t.target_type === "monitor");
    if (!monitor) { setRecordStatus("No monitor found"); return; }
    await startRecording(monitor.id);
  };

  const handleWindow = () => {
    const windows = targets.filter((t) => t.target_type === "window");
    if (windows.length === 0) { setRecordStatus("No windows found"); return; }
    setShowWindowPicker(true);
  };

  const handlePickWindow = async (id: string) => {
    setShowWindowPicker(false);
    setSelectedTarget(id);
    await startRecording(id);
  };

  const handleCustom = () => {
    setShowRegionSelector(true);
  };

  const handleRegionSelect = async (region: { x: number; y: number; w: number; h: number }) => {
    setShowRegionSelector(false);
    const monitor = targets.find((t) => t.target_type === "monitor");
    if (!monitor) { setRecordStatus("No monitor found"); return; }
    // Store region info for future export cropping; record full monitor for now
    setRecordStatus(`Recording region ${region.w}x${region.h}`);
    await startRecording(monitor.id);
  };

  const handleDevice = () => {
    document.getElementById("video-device")?.focus();
  };

  // File menu handlers
  const handleOpenRecording = async () => {
    setShowFileMenu(false);
    try {
      const dir = settingsOutputDir || (await invoke<string>("get_videos_dir"));
      const files = await invoke<Array<{ name: string; path: string; is_dir: boolean; size: number }>>("list_directory", { path: dir });
      const recordings = files
        .filter((f) => !f.is_dir && (f.name.endsWith(".mp4") || f.name.endsWith(".jsonl")))
        .map((f) => ({ name: f.name, path: f.path }));
      setFileList(recordings);
      setBrowseDir(dir);
      setShowFileBrowser(true);
    } catch (e) {
      setRecordStatus(`Cannot browse: ${e}`);
    }
  };

  const handleOpenOutputFolder = () => {
    setShowFileMenu(false);
    (async () => {
      try {
        const dir = settingsOutputDir || (await invoke<string>("get_videos_dir"));
        await invoke("open_explorer", { path: dir });
      } catch (e) {
        setRecordStatus(`Cannot open folder: ${e}`);
      }
    })();
  };

  const handleOpenFile = (videoPath: string) => {
    const logPath = videoPath.replace(/\.mp4$/i, ".jsonl");
    setShowFileBrowser(false);
    setShowFileMenu(false);
    onOpenEditor(videoPath, logPath);
  };

  // ── Keyboard: Space to stop ────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " && recording && !(e.target as HTMLElement)?.closest("input,select,textarea")) {
        e.preventDefault();
        stopRecording();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recording]);

  // ── Close menus on click outside ───────────────────────────────────────
  useEffect(() => {
    if (!showFileMenu) return;
    const onClick = () => setShowFileMenu(false);
    setTimeout(() => document.addEventListener("click", onClick), 50);
    return () => document.removeEventListener("click", onClick);
  }, [showFileMenu]);

  const microphones = audioDevices.filter((d) => d.device_type === "microphone");
  const speakers = audioDevices.filter((d) => d.device_type === "speaker");

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="app-layout">
      {/* ── Titlebar ───────────────────────────────────────────────── */}
      <header className="titlebar">
        <div
          className="titlebar-drag-area"
          onMouseDown={async (e) => {
            e.preventDefault();
            await appWindow.startDragging();
          }}
        />
        <div className="titlebar-left">
          <span className="app-name">Snap</span>
          <div className="menu-wrap">
            <span
              className="menu-item"
              onClick={(e) => { e.stopPropagation(); setShowFileMenu(!showFileMenu); }}
            >
              File <ChevronDown />
            </span>
            {showFileMenu && (
              <div className="dropdown-menu" onClick={(e) => e.stopPropagation()}>
                <button className="dropdown-item" onClick={handleOpenRecording}>
                  Open Recording...
                </button>
                <button className="dropdown-item" onClick={handleOpenOutputFolder}>
                  Output Folder
                </button>
                <div className="dropdown-divider" />
                <button className="dropdown-item danger" onClick={() => { setShowFileMenu(false); appWindow.close(); }}>
                  Exit
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="titlebar-right">
          <button
            className={`titlebar-icon ${showDebug ? "active" : ""}`}
            title="Debug"
            onClick={() => setShowDebug(!showDebug)}
          >
            <DebugIcon />
          </button>
          <button
            className={`titlebar-icon ${showSettings ? "active" : ""}`}
            title="Settings"
            onClick={() => setShowSettings(!showSettings)}
          >
            <SettingsIcon />
          </button>
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
      </header>

      {/* ── Settings panel ─────────────────────────────────────────── */}
      {showSettings && (
        <div className="settings-panel">
          <div className="settings-row">
            <label>Output Directory</label>
            <input
              type="text"
              className="field-input"
              value={settingsOutputDir}
              onChange={(e) => setSettingsOutputDir(e.target.value)}
            />
          </div>
          <p className="settings-hint">Recordings are saved to this folder.</p>
        </div>
      )}

      {/* ── Main content ───────────────────────────────────────────── */}
      <div className="main-content">
        <div className="recording-modes">
          {!recording ? (
            <>
              <h2>Please select the recording mode</h2>
              <div className="mode-cards">
                <ModeCard icon={<FullScreenIcon />} label="Full Screen" onClick={handleFullScreen} />
                <ModeCard icon={<CustomIcon />} label="Custom" onClick={handleCustom} />
                <ModeCard icon={<WindowIcon />} label="Window" onClick={handleWindow} />
                <ModeCard icon={<DeviceIcon />} label="Device" onClick={handleDevice} />
              </div>
              {recordStatus && (
                <p className="record-status-msg">{recordStatus}</p>
              )}
            </>
          ) : (
            <div className="recording-active">
              <div className="recording-indicator">
                <span className="rec-dot" />
                <span className="rec-text">REC</span>
                <span className="rec-time">{formatTime(elapsed)}</span>
              </div>
              <p className="rec-target">
                {targets.find((t) => t.id === selectedTarget)?.name ?? selectedTarget}
              </p>
              <button className="stop-btn" onClick={stopRecording}>
                <StopIcon />
                Stop Recording
              </button>
              <p className="rec-hint">Press Space to stop</p>
            </div>
          )}

          {/* Recorded: open editor */}
          {!recording && lastVideo && lastLog && (
            <div className="open-editor-wrap">
              <p className="record-status-msg">{recordStatus}</p>
              <button className="open-editor-btn" onClick={() => onOpenEditor(lastVideo, lastLog)}>
                Open in Editor
              </button>
            </div>
          )}

          {/* ── Debug test buttons ─────────────────────────────────── */}
          {showDebug && !recording && (
            <div className="debug-panel">
              <h4>Debug Tools</h4>
              <div className="debug-buttons">
                <DebugBtn label="Test Record 5s" onClick={handleTestRecord} />
                <DebugBtn label="Test Audio 5s" onClick={handleTestAudio} />
                <DebugBtn label="Test Input 5s" onClick={handleTestInput} />
                <DebugBtn label="Test Combined 5s" onClick={handleTestCombined} />
              </div>
            </div>
          )}
        </div>

        {/* ── Device panel ────────────────────────────────────────── */}
        <aside className="device-panel">
          <h3>Device &amp; Tool</h3>

          <div className="device-field">
            <label htmlFor="video-device">Video Device</label>
            <select
              id="video-device"
              value={selectedTarget}
              onChange={(e) => setSelectedTarget(e.target.value)}
            >
              <option value="" disabled>Select a video device</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.target_type})</option>
              ))}
            </select>
          </div>

          <div className="device-field">
            <label htmlFor="microphone">Microphone</label>
            <select
              id="microphone"
              value={selectedMic}
              onChange={(e) => setSelectedMic(e.target.value)}
            >
              <option value="default">Default Microphone</option>
              {microphones.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          <div className="device-field">
            <label htmlFor="speaker">Speaker Output</label>
            <select
              id="speaker"
              value={selectedSpeaker}
              onChange={(e) => setSelectedSpeaker(e.target.value)}
            >
              <option value="default">Default Speaker</option>
              {speakers.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          <button
            className="teleprompter-btn"
            onClick={() => console.log("Teleprompter clicked")}
          >
            Teleprompter
          </button>
        </aside>
      </div>

      {/* ── Window picker modal ───────────────────────────────────── */}
      {showWindowPicker && (
        <div className="modal-overlay" onClick={() => setShowWindowPicker(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Select a Window</h3>
            <div className="modal-list">
              {targets
                .filter((t) => t.target_type === "window")
                .map((t) => (
                  <button key={t.id} className="modal-item" onClick={() => handlePickWindow(t.id)}>
                    {t.name}
                  </button>
                ))}
            </div>
            <button className="modal-cancel" onClick={() => setShowWindowPicker(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Region selector ────────────────────────────────────────── */}
      {showRegionSelector && (
        <RegionSelector
          onSelect={handleRegionSelect}
          onCancel={() => setShowRegionSelector(false)}
        />
      )}

      {/* ── File browser modal ─────────────────────────────────────── */}
      {showFileBrowser && (
        <div className="modal-overlay" onClick={() => setShowFileBrowser(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Open Recording</h3>
            <p className="modal-subtitle">{browseDir}</p>
            <div className="modal-list">
              {fileList.length === 0 && (
                <p className="modal-empty">No recordings found</p>
              )}
              {fileList
                .filter((f) => f.name.endsWith(".mp4"))
                .map((f) => (
                  <button
                    key={f.path}
                    className="modal-item"
                    onClick={() => handleOpenFile(f.path)}
                  >
                    {f.name}
                  </button>
                ))}
            </div>
            <button className="modal-cancel" onClick={() => setShowFileBrowser(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // ── Debug test handlers ──────────────────────────────────────────────────
  async function handleTestRecord() {
    setRecordStatus("Test recording...");
    await startRecording(
      targets.find((t) => t.target_type === "monitor")?.id ?? ""
    );
    await new Promise((r) => setTimeout(r, 5000));
    await stopRecording();
  }

  async function handleTestAudio() {
    setRecordStatus("Test audio...");
    try {
      const dir = settingsOutputDir || (await invoke<string>("get_videos_dir"));
      const out = `${dir}\\snap_audio_test_${Date.now()}`;
      await invoke("start_audio_capture", { micDeviceId: selectedMic, outputDir: out });
      await new Promise((r) => setTimeout(r, 5000));
      await invoke("stop_audio_capture");
      setRecordStatus(`Audio saved to ${out}`);
    } catch (e) {
      setRecordStatus(`Audio error: ${e}`);
    }
  }

  async function handleTestInput() {
    setRecordStatus("Test input...");
    try {
      const dir = settingsOutputDir || (await invoke<string>("get_videos_dir"));
      const path = `${dir}\\input_log_${Date.now()}.jsonl`;
      await invoke("start_input_logging", { outputPath: path, sessionStartTime: "0" });
      await new Promise((r) => setTimeout(r, 5000));
      const count = await invoke<number>("stop_input_logging");
      setRecordStatus(`${count} events → ${path}`);
    } catch (e) {
      setRecordStatus(`Input error: ${e}`);
    }
  }

  async function handleTestCombined() {
    setRecordStatus("Test combined...");
    await startRecording(
      targets.find((t) => t.target_type === "monitor")?.id ?? ""
    );
    await new Promise((r) => setTimeout(r, 5000));
    await stopRecording();
  }
}

// ── Debug button helper ────────────────────────────────────────────────────
function DebugBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="debug-btn" onClick={onClick}>
      {label}
    </button>
  );
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
