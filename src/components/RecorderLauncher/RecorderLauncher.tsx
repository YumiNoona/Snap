import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { MorphIcon } from "morphicons/react";
import { ChevronDown as ChevronDownIcon, ChevronUp as ChevronUpIcon, Square as SquareIcon, Minimize2 as RestoreIcon } from "lucide";
import {
  Settings,
  Minus,
  X,
  Folder,
  Mic,
  Volume2,
  FileText,
  AppWindow,
  Search,
  ChevronRight,
  Download,
  Video,
  FileVideo2,
  FolderOpen,
  LogOut,
} from "lucide-react";
import RegionSelector from "./RegionSelector";
import DeviceView from "./DeviceView";
import Dropdown from "../shared/Dropdown";
import DonateButton from "../shared/DonateButton";
import { type AppSettings, readAppSettings, writeAppSettings } from "../../lib/appSettings";
import { recordingDataPaths } from "../../lib/recordingPaths";
import snapAppIcon from "../../../src-tauri/icons/snap.png";
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

interface CameraDevice {
  id: string;
  name: string;
}

interface Props {
  onOpenEditor: (videoPath: string, logPath: string) => void;
  onOpenTeleprompter: () => void;
  onOpenSettings: () => void;
  editorError?: string | null;
}

type UpdateState = "idle" | "checking" | "available" | "current" | "downloading" | "installing" | "error";

function formatRecordingSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "MP4 recording";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB · MP4`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB · MP4`;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function RecorderLauncher({ onOpenEditor, onOpenTeleprompter, onOpenSettings }: Props) {
  const [targets, setTargets] = useState<DisplayTarget[]>([]);
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [cameraDevices, setCameraDevices] = useState<CameraDevice[]>([]);
  const [_selectedTarget, setSelectedTarget] = useState("");
  const [selectedCamera, setSelectedCamera] = useState(() => localStorage.getItem("snap.selectedCamera") || "");
  const [selectedMic, setSelectedMic] = useState(() => localStorage.getItem("snap.selectedMic") || "");
  const [selectedSpeaker, setSelectedSpeaker] = useState(() => localStorage.getItem("snap.selectedSpeaker") || "");

  // Settings (persisted)
  const [settings, setSettings] = useState<AppSettings>(readAppSettings);
  const [isMaximized, setIsMaximized] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateState>("idle");
  const [updateVersion, setUpdateVersion] = useState("");
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const pendingUpdateRef = useRef<Awaited<ReturnType<typeof check>>>(null);
  const updateCheckRef = useRef(false);

  // Navigation / Views
  const [activeView, setActiveView] = useState<"launcher" | "device">("launcher");
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [showWindowPicker, setShowWindowPicker] = useState(false);
  const [windowSearch, setWindowSearch] = useState("");
  const [recordingSearch, setRecordingSearch] = useState("");
  const [showRegionSelector, setShowRegionSelector] = useState(false);
  const [regionScreen, setRegionScreen] = useState({ x: 0, y: 0, scale: 1 });
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [fileList, setFileList] = useState<{ name: string; path: string; size: number }[]>([]);

  // Recording
  const [recording, setRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [, setRecordStatus] = useState("");
  const [elapsed, setElapsed] = useState(0);
  
  const lastVideoRef = useRef(localStorage.getItem("snap.lastVideo") || "");
  const lastLogRef = useRef(localStorage.getItem("snap.lastLog") || "");
  const [lastVideo, setLastVideo] = useState(lastVideoRef.current);
  const [lastLog, setLastLog] = useState(lastLogRef.current);

  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const regionRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const pausedRef = useRef(false);

  // Keep the ref in sync so the elapsed interval can pause without re-creating.
  useEffect(() => {
    pausedRef.current = isPaused;
  }, [isPaused]);

  // Persist settings
  useEffect(() => {
    try {
      writeAppSettings(settings);
    } catch {
      // ignore storage errors
    }
  }, [settings]);

  useEffect(() => {
    invoke("organize_recording_data", { showSupportFiles: settings.showRecordingDataFiles }).catch((error) => {
      console.error("Unable to organize recording support data:", error);
    });
  }, [settings.showRecordingDataFiles]);

  useEffect(() => {
    const unlisten = listen<AppSettings>("settings-changed", (event) => setSettings(event.payload));
    return () => { unlisten.then((stop) => stop()); };
  }, []);

  useEffect(() => {
    try { localStorage.setItem("snap.selectedCamera", selectedCamera); } catch {}
  }, [selectedCamera]);

  useEffect(() => {
    try { localStorage.setItem("snap.selectedMic", selectedMic); } catch {}
  }, [selectedMic]);

  useEffect(() => {
    try { localStorage.setItem("snap.selectedSpeaker", selectedSpeaker); } catch {}
  }, [selectedSpeaker]);

  const checkForUpdates = async (manual = true) => {
    if (updateCheckRef.current || updateState === "downloading" || updateState === "installing") return;
    updateCheckRef.current = true;
    setUpdateState("checking");
    try {
      const update = await check({ timeout: 20_000 });
      pendingUpdateRef.current = update;
      if (update) {
        setUpdateVersion(update.version);
        setUpdateState("available");
        if (!manual) setShowUpdatePrompt(true);
      } else {
        setUpdateVersion("");
        setUpdateState("current");
      }
    } catch (error) {
      pendingUpdateRef.current = null;
      if (manual) {
        setUpdateState("error");
      } else {
        setUpdateState("idle");
      }
    } finally {
      updateCheckRef.current = false;
    }
  };

  const downloadAndInstallUpdate = async () => {
    const update = pendingUpdateRef.current;
    if (!update) {
      await checkForUpdates(true);
      return;
    }

    let downloaded = 0;
    let total = 0;
    setShowUpdatePrompt(false);
    setUpdateState("downloading");
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength || 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          void total;
          void downloaded;
        } else if (event.event === "Finished") {
          setUpdateState("installing");
        }
      });
      await relaunch();
    } catch (error) {
      setUpdateState("error");
    }
  };

  useEffect(() => {
    if (!settings.autoCheckUpdates) return;
    const timer = setTimeout(() => { void checkForUpdates(false); }, 2500);
    return () => clearTimeout(timer);
    // Run only when the persisted preference changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.autoCheckUpdates]);

  // Countdown-then-record: shows 3→2→1 then starts actual recording.
  // Respects the "countdown" setting — off starts immediately.
  const startWithCountdown = (targetId: string, captureRegion: { x: number; y: number; w: number; h: number } | null = null) => {
    if (!settings.countdown) {
      startRecording(targetId, captureRegion);
      return;
    }
    invoke("set_countdown", { value: 3 }).catch(() => {});
    let count = 3;
    const tick = () => {
      count -= 1;
      if (count > 0) {
        invoke("set_countdown", { value: count }).catch(() => {});
        countdownRef.current = setTimeout(tick, 1000);
      } else {
        invoke("set_countdown", { value: null }).catch(() => {});
        startRecording(targetId, captureRegion);
      }
    };
    countdownRef.current = setTimeout(tick, 1000);
  };

  // ── Load devices ───────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const cameras = await invoke<CameraDevice[]>("enumerate_video_devices");
        setCameraDevices(cameras);
        setSelectedCamera((current) => cameras.some((camera) => camera.id === current) ? current : cameras[0]?.id || "");
      } catch (e) {
        console.error("Failed to enumerate cameras:", e);
      }
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
        const microphones = d.filter((device) => device.device_type === "microphone");
        const speakers = d.filter((device) => device.device_type === "speaker");
        setSelectedMic((current) => microphones.some((device) => device.id === current) ? current : microphones[0]?.id || "");
        setSelectedSpeaker((current) => speakers.some((device) => device.id === current) ? current : speakers[0]?.id || "");
      } catch (e) {
        console.error("Failed to enumerate audio devices:", e);
      }
    })();
  }, []);

  const [shutterFlash, setShutterFlash] = useState(false);

  // ── Recording Actions ──────────────────────────────────────────────────
  const startRecording = async (targetId: string, captureRegion: { x: number; y: number; w: number; h: number } | null = null) => {
    try {
      const videosDir = await invoke<string>("get_videos_dir");
      const stamp = Date.now();
      const videoPath = `${videosDir}\\snap_${stamp}.mp4`;
      const preferredPaths = recordingDataPaths(videoPath);
      const prepared = await invoke<{ dataDir: string; logPath: string }>("prepare_recording_data", {
        videoPath,
        showSupportFiles: settings.showRecordingDataFiles,
      });
      const logPath = prepared.logPath || preferredPaths.logPath;
      const audioDir = prepared.dataDir || preferredPaths.dataDir;

      lastVideoRef.current = videoPath;
      lastLogRef.current = logPath;
      setLastVideo(videoPath);
      setLastLog(logPath);
      try {
        localStorage.setItem("snap.lastVideo", videoPath);
        localStorage.setItem("snap.lastLog", logPath);
      } catch {}

      setRecordStatus("Starting...");
      let region: { x: number; y: number; w: number; h: number } | null = null;
      if (captureRegion) {
        region = captureRegion;
      } else try {
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
        await invoke("start_recording", { targetId, outputPath: videoPath, region: captureRegion });
      } catch (error) {
        await invoke("stop_input_logging").catch(() => {});
        throw error;
      }
      try {
        await invoke("start_audio_capture", { micDeviceId: selectedMic, speakerDeviceId: selectedSpeaker, outputDir: audioDir });
      } catch (e) {
        console.error("Audio capture failed:", e);
      }

      // Single 120ms soft amber shutter pulse micro-interaction when recording starts
      setShutterFlash(true);
      setTimeout(() => setShutterFlash(false), 120);

      setRecording(true);
      setIsPaused(false);
      setElapsed(0);

      elapsedRef.current = setInterval(
        () => setElapsed((p) => (pausedRef.current ? p : p + 1)),
        1000
      );
      setRecordStatus("Recording");

      // Optionally move the launcher out of the way while recording.
      if (settings.minimizeWhileRecording) getCurrentWindow().minimize().catch(() => {});

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
      console.error("[Snap] startRecording failed:", e);
      setRecordStatus(`Error: ${e}`);
    }
  };

  const stopRecording = async () => {
    if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
    if (countdownRef.current) { clearTimeout(countdownRef.current); countdownRef.current = null; }
    setRecordStatus("Stopping...");

    let count = 0;
    try { await invoke("stop_recording"); } catch (e) { console.error("stop_recording failed:", e); }
    try { count = await invoke<number>("stop_input_logging"); } catch { /* input logging may not have started */ }
    try { await invoke("stop_audio_capture"); } catch { /* audio capture may not have started */ }

    setRecording(false);
    setIsPaused(false);
    pausedRef.current = false;
    setRecordStatus(`Done — ${count} events captured`);

    // Hide the floating dock window + recording border overlay.
    invoke("set_dock_visible", { visible: false }).catch(() => {});
    invoke("set_recording_overlay", { enabled: false, style: "off", region: null }).catch(() => {});
    invoke("set_overlay_paused", { paused: false }).catch(() => {});

    // Open the recording in its own editor window
    const targetVideo = lastVideoRef.current || lastVideo;
    const targetLog = lastLogRef.current || lastLog;
    if (settings.autoOpenEditor && targetVideo && targetLog) {
      onOpenEditor(targetVideo, targetLog);
    }
  };

  const handleFullScreen = async () => {
    const monitor = targets.find((t) => t.target_type === "monitor");
    if (!monitor) { setRecordStatus("No monitor found"); return; }
    setSelectedTarget(monitor.id);
    startWithCountdown(monitor.id);
  };

  const handleWindow = () => {
    setWindowSearch("");
    setShowWindowPicker(true);
  };

  const handlePickWindow = (id: string) => {
    setShowWindowPicker(false);
    setSelectedTarget(id);
    startWithCountdown(id);
  };

  const handleCustom = async () => {
    try {
      const bounds = await invoke<{ x: number; y: number; w: number; h: number }>("begin_region_selection");
      setRegionScreen({ x: bounds.x, y: bounds.y, scale: window.devicePixelRatio || 1 });
      setShowRegionSelector(true);
    } catch (e) {
      setRecordStatus(`Cannot open region selector: ${e}`);
    }
  };

  const handleRegionSelect = async (region: { x: number; y: number; w: number; h: number }) => {
    setShowRegionSelector(false);
    await invoke("end_region_selection").catch(() => {});
    const selectedRegion = {
      x: Math.round(regionScreen.x + region.x * regionScreen.scale),
      y: Math.round(regionScreen.y + region.y * regionScreen.scale),
      w: Math.max(2, Math.round(region.w * regionScreen.scale)),
      h: Math.max(2, Math.round(region.h * regionScreen.scale)),
    };
    if (selectedRegion.w < 256 || selectedRegion.h < 144) {
      setRecordStatus("Region must be at least 256 x 144 pixels");
      return;
    }
    const monitors = targets.filter((t) => t.target_type === "monitor");
    let monitor = monitors[0];
    const cx = selectedRegion.x + selectedRegion.w / 2;
    const cy = selectedRegion.y + selectedRegion.h / 2;
    for (const candidate of monitors) {
      try {
        const bounds = await invoke<{ x: number; y: number; w: number; h: number }>("get_target_bounds", { targetId: candidate.id });
        if (cx >= bounds.x && cx < bounds.x + bounds.w && cy >= bounds.y && cy < bounds.y + bounds.h) {
          monitor = candidate;
          break;
        }
      } catch {}
    }
    if (!monitor) return;
    setSelectedTarget(monitor.id);
    setRecordStatus(`Recording region ${selectedRegion.w}x${selectedRegion.h}`);
    startWithCountdown(monitor.id, selectedRegion);
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
        .map((f) => ({ name: f.name, path: f.path, size: f.size }))
        .sort((a, b) => b.name.localeCompare(a.name));
      setFileList(recordings);
      setRecordingSearch("");
      setShowFileBrowser(true);
    } catch (e) {
      setRecordStatus(`Cannot browse: ${e}`);
    }
  };

  const openRecording = async (videoPath: string) => {
    setShowFileBrowser(false);
    const fallback = recordingDataPaths(videoPath).logPath;
    const logPath = await invoke<string>("resolve_recording_log_path", { videoPath }).catch(() => fallback);
    onOpenEditor(videoPath, logPath);
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
    // Update the capture border immediately instead of waiting for the next
    // elapsed-time dock sync tick.
    invoke("set_overlay_paused", { paused: next }).catch(() => {});
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
  const actionHandlersRef = useRef<{ stop: () => void; pause: () => void }>({
    stop: () => {},
    pause: () => {},
  });
  useEffect(() => {
    actionHandlersRef.current = { stop: stopRecording, pause: togglePause };
  });

  useEffect(() => {
    const un = listen<string>("dock-action", (e) => {
      if (e.payload === "stop") {
        actionHandlersRef.current.stop();
      } else if (e.payload === "pause") {
        actionHandlersRef.current.pause();
      } else if (e.payload === "mic") {
        setMicMuted((m) => {
          const next = !m;
          invoke("set_microphone_muted", { muted: next }).catch(() => {});
          return next;
        });
      }
    });
    return () => {
      un.then((fn) => fn());
    };
  }, []); // mount once, ref accessed via actionHandlersRef

  // Clear local timers on unmount. Dock visibility is owned by the recording
  // lifecycle in Rust; hiding it here races React StrictMode/HMR remounts and
  // can make the controls disappear during an active recording.
  useEffect(() => {
    return () => {
      if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
      if (countdownRef.current) { clearTimeout(countdownRef.current); countdownRef.current = null; }
    };
  }, []);

  // Sub-view: Device Connection (image_1.png / image_2.png)
  if (activeView === "device") {
    return <DeviceView onBack={() => setActiveView("launcher")} onOpenEditor={onOpenEditor} />;
  }

  return (
    <div className={`app-layout ${shutterFlash ? "shutter-flash-active" : ""}`} onClick={() => { if (showFileMenu) setShowFileMenu(false); }}>
      {/* ── Topbar ────────────────────────── */}
      <header className="titlebar" data-tauri-drag-region>
        <div className="titlebar-drag-area" data-tauri-drag-region />
        <div className="titlebar-left">
          <div className="brand-logo-area">
            <img className="brand-logo-icon" src={snapAppIcon} alt="" aria-hidden="true" />
            <span className="app-name">Snap</span>
          </div>

          <div className="menu-wrap">
            <button
              className={`menu-item ${showFileMenu ? "open" : ""}`}
              onClick={(e) => { e.stopPropagation(); setShowFileMenu(!showFileMenu); }}
              aria-expanded={showFileMenu}
              aria-haspopup="menu"
            >
              <Folder size={17} />
              File
              <MorphIcon icon={showFileMenu ? ChevronUpIcon : ChevronDownIcon} spring="snappy" size={14} />
            </button>
            {showFileMenu && (
              <div className="dropdown-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                <button className="dropdown-item" onClick={handleOpenRecording}>
                  <FileVideo2 size={16} /><span>Open recording…</span>
                </button>
                <button className="dropdown-item" onClick={async () => {
                  setShowFileMenu(false);
                  const dir = await invoke<string>("get_videos_dir");
                  await invoke("open_explorer", { path: dir });
                }}>
                  <FolderOpen size={16} /><span>Output folder</span>
                </button>
                <div className="dropdown-divider" />
                <button className="dropdown-item danger" onClick={() => getCurrentWindow().close()}>
                  <LogOut size={16} /><span>Exit Snap</span>
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="titlebar-right">
          <DonateButton />
          <button className="titlebar-icon-btn" title="Settings" onClick={onOpenSettings}>
            <Settings size={18} />
          </button>

          <div className="window-controls">
            <button className="window-btn" title="Minimize" onClick={() => getCurrentWindow().minimize()}>
              <Minus size={15} />
            </button>
            <button className="window-btn" title={isMaximized ? "Restore" : "Maximize"} onClick={async () => {
              await getCurrentWindow().toggleMaximize();
              setIsMaximized(await getCurrentWindow().isMaximized());
            }}>
              <MorphIcon icon={isMaximized ? RestoreIcon : SquareIcon} spring="snappy" size={15} />
            </button>
            <button className="window-btn close-btn" title="Close" onClick={() => getCurrentWindow().close()}>
              <X size={15} />
            </button>
          </div>
        </div>
      </header>

      {/* ── Main Workspace ─────────────────────────────────────── */}
      <div className="main-content">
        {/* Left: Recording Modes Grid */}
        <div className="recording-modes-area">
          <div className="recording-mode-stack">
            <div className="recording-modes-heading">
              <h2 className="section-heading">Select a recording mode</h2>
              <p className="section-subheading">Choose the part of your screen you want to capture</p>
            </div>

            <div className="focusee-mode-cards-grid">
            {/* Card 1: Full Screen */}
            <div className="focusee-card" onClick={handleFullScreen} title="Record Full Screen">
              <div className="card-thumb-frame">
                <div className="wallpaper-preview full-screen-preview" />
              </div>
              <span className="card-title-text"><strong>Full Screen</strong></span>
            </div>

            {/* Card 2: Custom Region */}
            <div className="focusee-card" onClick={handleCustom} title="Record a Custom Region">
              <div className="card-thumb-frame">
                <div className="wallpaper-preview custom-region-preview">
                  <div className="cyan-crop-box" />
                </div>
              </div>
              <span className="card-title-text"><strong>Custom</strong></span>
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
              <span className="card-title-text"><strong>Window</strong></span>
            </div>

            {/* Card 4: Device */}
            <div className="focusee-card" onClick={handleDevice} title="Record a Mobile Device">
              <div className="card-thumb-frame">
                <div className="wallpaper-preview device-preview">
                  <span className="phone-illustration" aria-hidden="true">
                    <span className="phone-screen" />
                    <span className="phone-speaker" />
                    <span className="phone-camera" />
                    <span className="phone-home-indicator" />
                  </span>
                </div>
              </div>
              <span className="card-title-text"><strong>Device</strong></span>
            </div>
            </div>
          </div>
        </div>

        {/* Right Sidebar: Device & Tool Panel */}
        <aside className="focusee-sidebar">
          {/* Camera Dropdown */}
          <div className="setup-field"><label>Camera</label>{cameraDevices.length > 0 ? <Dropdown value={selectedCamera} onChange={setSelectedCamera} icon={<Video size={18} />} options={cameraDevices.map((camera) => ({ value: camera.id, label: camera.name }))} /> : <div className="device-unavailable-row"><Video size={18} /><span>Connect a camera</span></div>}</div>

          {/* Microphone Dropdown */}
          <div className="setup-field"><label>Microphone</label>{microphones.length > 0 ? <Dropdown value={selectedMic} onChange={setSelectedMic} icon={<Mic size={18} />} options={microphones.map((microphone) => ({ value: microphone.id, label: microphone.name }))} /> : <div className="device-unavailable-row"><Mic size={18} /><span>Connect a microphone</span></div>}</div>

          {/* Speaker Dropdown */}
          <div className="setup-field"><label>Desktop audio</label>{speakers.length > 0 ? <Dropdown value={selectedSpeaker} onChange={setSelectedSpeaker} icon={<Volume2 size={18} />} options={speakers.map((speaker) => ({ value: speaker.id, label: speaker.name }))} /> : <div className="device-unavailable-row"><Volume2 size={18} /><span>Connect an output</span></div>}</div>

          {/* Teleprompter Button */}
          <button
            className="teleprompter-sidebar-btn"
            onClick={() => onOpenTeleprompter()}
          >
            <FileText size={18} />
            Teleprompter
          </button>
        </aside>
      </div>

      {/* ── Window Picker Modal ────────────────────────────────────── */}
      {showWindowPicker && (
        <div className="modal-overlay" onClick={() => setShowWindowPicker(false)}>
          <div className="focusee-modal-card window-picker-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-heading-row">
              <div className="modal-title-icon"><AppWindow size={18} /></div>
              <div className="modal-title-copy">
                <h3>Select a window</h3>
                <p className="modal-sub">Choose an application to capture</p>
              </div>
              <button className="settings-close-btn" title="Close" onClick={() => setShowWindowPicker(false)}><X size={14} /></button>
            </div>
            <label className="window-search-field">
              <Search size={15} />
              <input value={windowSearch} onChange={(event) => setWindowSearch(event.target.value)} placeholder="Search open windows" autoFocus />
            </label>
            <div className="modal-window-list">
              {targets
                .filter((t) => t.target_type === "window" && t.name.toLowerCase().includes(windowSearch.trim().toLowerCase()))
                .map((t) => (
                  <button
                    key={t.id}
                    className="window-option-btn"
                    onClick={() => handlePickWindow(t.id)}
                  >
                    <span className="window-option-icon"><AppWindow size={15} /></span>
                    <span className="window-option-copy"><strong>{t.name}</strong><small>Application window</small></span>
                    <ChevronRight size={15} className="window-option-arrow" />
                  </button>
                ))}
              {targets.filter((t) => t.target_type === "window" && t.name.toLowerCase().includes(windowSearch.trim().toLowerCase())).length === 0 && (
                <div className="window-empty-state"><Search size={20} /><span>No matching windows</span></div>
              )}
            </div>
            <div className="modal-footer-row"><span>{targets.filter((t) => t.target_type === "window").length} windows available</span><button className="modal-close-btn" onClick={() => setShowWindowPicker(false)}>Cancel</button></div>
          </div>
        </div>
      )}

      {/* ── Region Selector Overlay ────────────────────────────────── */}
      {showRegionSelector && (
        <RegionSelector
          onSelect={handleRegionSelect}
          onCancel={() => {
            setShowRegionSelector(false);
            invoke("end_region_selection").catch(() => {});
          }}
        />
      )}

      {showUpdatePrompt && updateState === "available" && (
        <div className="update-available-popup" role="dialog" aria-label="Snap update available">
          <span className="update-popup-icon"><Download size={19} /></span>
          <div className="update-popup-copy"><strong>Snap {updateVersion} is available</strong><small>Download and install it without leaving the app.</small></div>
          <button className="update-popup-install" onClick={() => void downloadAndInstallUpdate()}>Update now</button>
          <button className="update-popup-dismiss" title="Remind me later" onClick={() => setShowUpdatePrompt(false)}><X size={13} /></button>
        </div>
      )}

      {/* ── File Browser Modal ─────────────────────────────────────── */}
      {showFileBrowser && (
        <div className="modal-overlay" onClick={() => setShowFileBrowser(false)}>
          <div className="focusee-modal-card recording-picker-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-heading-row">
              <div className="modal-title-icon"><FolderOpen size={18} /></div>
              <div className="modal-title-copy">
                <h3>Open recording</h3>
                <p className="modal-sub">Choose a recent Snap project to edit</p>
              </div>
              <button className="settings-close-btn" title="Close" onClick={() => setShowFileBrowser(false)}><X size={14} /></button>
            </div>
            <label className="window-search-field recording-search-field">
              <Search size={15} />
              <input value={recordingSearch} onChange={(event) => setRecordingSearch(event.target.value)} placeholder="Search recordings" autoFocus />
            </label>
            <div className="modal-window-list recording-list">
              {fileList.filter((file) => file.name.toLowerCase().includes(recordingSearch.trim().toLowerCase())).map((f) => (
                <button
                  key={f.path}
                  className="window-option-btn recording-option-btn"
                  onClick={() => openRecording(f.path)}
                >
                  <span className="window-option-icon"><FileVideo2 size={16} /></span>
                  <span className="window-option-copy"><strong>{f.name.replace(/\.mp4$/i, "")}</strong><small>{formatRecordingSize(f.size)}</small></span>
                  <ChevronRight size={15} className="window-option-arrow" />
                </button>
              ))}
              {fileList.filter((file) => file.name.toLowerCase().includes(recordingSearch.trim().toLowerCase())).length === 0 && (
                <div className="window-empty-state"><FileVideo2 size={22} /><span>No matching recordings</span></div>
              )}
            </div>
            <div className="modal-footer-row"><span>{fileList.length} recording{fileList.length === 1 ? "" : "s"}</span><button className="modal-close-btn" onClick={() => setShowFileBrowser(false)}>Cancel</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
