import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { MorphIcon } from "morphicons/react";
import { ChevronDown as ChevronDownIcon, ChevronUp as ChevronUpIcon } from "lucide";
import {
  Settings,
  Minus,
  X,
  Folder,
  Mic,
  Volume2,
  FileText,
  Search,
  ChevronRight,
  Download,
  Video,
  FileVideo2,
  FolderOpen,
  LogOut,
  LoaderCircle,
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

interface RecordingSessionSnapshot {
  sessionId: string;
  phase: "preparing" | "armed" | "countingDown" | "starting" | "recording" | "pausing" | "paused" | "resuming" | "stopping" | "finalizing" | "completed" | "cancelled" | "failed";
  countdown?: number | null;
  error?: string | null;
}

interface Props {
  onOpenEditor: (videoPath: string, logPath: string) => void | Promise<void>;
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
  const [updateState, setUpdateState] = useState<UpdateState>("idle");
  const [updateVersion, setUpdateVersion] = useState("");
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const pendingUpdateRef = useRef<Awaited<ReturnType<typeof check>>>(null);
  const updateCheckRef = useRef(false);

  // Navigation / Views
  const [activeView, setActiveView] = useState<"launcher" | "device">("launcher");
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [recordingSearch, setRecordingSearch] = useState("");
  const [showRegionSelector, setShowRegionSelector] = useState(false);
  const [regionScreen, setRegionScreen] = useState({ x: 0, y: 0, scale: 1 });
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [fileList, setFileList] = useState<{ name: string; path: string; size: number }[]>([]);

  // Recording
  const [recording, setRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [recordStatus, setRecordStatus] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [processingRecording, setProcessingRecording] = useState(false);
  const [processingMessage, setProcessingMessage] = useState("Closing capture streams…");
  
  const lastVideoRef = useRef(localStorage.getItem("snap.lastVideo") || "");
  const lastLogRef = useRef(localStorage.getItem("snap.lastLog") || "");
  const lastDataDirRef = useRef("");
  const [lastVideo, setLastVideo] = useState(lastVideoRef.current);
  const [lastLog, setLastLog] = useState(lastLogRef.current);

  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const regionRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const pausedRef = useRef(false);
  const startingRef = useRef(false);
  const pauseTransitionRef = useRef(false);
  const activeSessionIdRef = useRef("");
  const windowTargetHandlerRef = useRef<(targetId: string) => void>(() => {});

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
    const unlisten = listen<RecordingSessionSnapshot>("recording-session-state", ({ payload }) => {
      if (payload.sessionId !== activeSessionIdRef.current) return;
      if (payload.phase === "countingDown") setRecordStatus(`Recording in ${payload.countdown ?? "…"}`);
      else if (payload.phase === "starting") setRecordStatus("Starting capture…");
      else if (payload.phase === "pausing") setRecordStatus("Pausing…");
      else if (payload.phase === "resuming") setRecordStatus("Resuming…");
      else if (payload.phase === "stopping") {
        setProcessingRecording(true);
        setProcessingMessage("Closing video and audio streams…");
      } else if (payload.phase === "finalizing") {
        setProcessingRecording(true);
        setProcessingMessage("Building a smooth editor-ready video…");
      }
      else if (payload.phase === "failed" && payload.error) setRecordStatus(`Error: ${payload.error}`);
    });
    return () => { unlisten.then((stop) => stop()); };
  }, []);

  useEffect(() => {
    const unlisten = listen<string>("window-target-selected", ({ payload }) => windowTargetHandlerRef.current(payload));
    return () => { unlisten.then((stop) => stop()); };
  }, []);

  useEffect(() => {
    void invoke<Array<{ videoPath: string; status: string; message: string }>>("recover_recording_sessions")
      .then((sessions) => {
        if (sessions.length === 0) return;
        const usable = sessions.filter((session) => session.status === "incomplete").length;
        setRecordStatus(usable > 0
          ? `Recovered ${usable} interrupted recording${usable === 1 ? "" : "s"}. Open the recording library to inspect them.`
          : "An interrupted recording session was found, but it did not contain usable video.");
      })
      .catch((error) => console.warn("[Snap] Recording recovery scan failed:", error));
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

  // Rust owns both countdown and media startup. React sends one intent so a
  // delayed timer or duplicate click cannot start the sources independently.
  const startWithCountdown = (targetId: string, captureRegion: { x: number; y: number; w: number; h: number } | null = null) => {
    void startRecording(targetId, captureRegion);
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
        setSelectedMic((current) => microphones.some((device) => device.id === current) ? current : "default");
        setSelectedSpeaker((current) => speakers.some((device) => device.id === current) ? current : "default");
      } catch (e) {
        console.error("Failed to enumerate audio devices:", e);
      }
    })();
  }, []);

  const [shutterFlash, setShutterFlash] = useState(false);

  // ── Recording Actions ──────────────────────────────────────────────────
  const startRecording = async (targetId: string, captureRegion: { x: number; y: number; w: number; h: number } | null = null) => {
    if (startingRef.current || recording) return;
    startingRef.current = true;
    lastDataDirRef.current = "";
    try {
      // The editor owns a continuously rendered preview canvas. Keep it out of
      // the capture hot path even if the user left that window open.
      await invoke("set_editor_suspended_for_recording", { suspended: true });
      const videosDir = await invoke<string>("get_videos_dir");
      const stamp = Date.now();
      const sessionId = `desktop-${stamp}`;
      activeSessionIdRef.current = sessionId;
      const videoPath = `${videosDir}\\snap_${stamp}.mp4`;
      try {
        await invoke("recording_preflight", { outputPath: videoPath, expectedSeconds: 3600 });
      } catch (preflightError) {
        if (!String(preflightError).includes("FFmpeg is unavailable")) throw preflightError;
        setRecordStatus("Installing the required FFmpeg video engine…");
        await invoke("install_ffmpeg");
        await invoke("recording_preflight", { outputPath: videoPath, expectedSeconds: 3600 });
      }
      const preferredPaths = recordingDataPaths(videoPath);
      const prepared = await invoke<{ dataDir: string; logPath: string }>("prepare_recording_data", {
        videoPath,
        showSupportFiles: settings.showRecordingDataFiles,
      });
      const logPath = prepared.logPath || preferredPaths.logPath;
      const audioDir = prepared.dataDir || preferredPaths.dataDir;
      lastDataDirRef.current = audioDir;
      await invoke("update_recording_session", { dataDir: audioDir, videoPath, status: "starting", error: null });

      lastVideoRef.current = videoPath;
      lastLogRef.current = logPath;
      setLastVideo(videoPath);
      setLastLog(logPath);
      try {
        localStorage.setItem("snap.lastVideo", videoPath);
        localStorage.setItem("snap.lastLog", logPath);
      } catch {}

      setRecordStatus("Preparing recording…");
      let region: { x: number; y: number; w: number; h: number } | null = null;
      if (captureRegion) {
        region = captureRegion;
      } else try {
        region = await invoke<{ x: number; y: number; w: number; h: number }>("get_target_bounds", { targetId });
      } catch {
        // region unknown — editor falls back to full-desktop mapping
      }
      regionRef.current = region;
      await invoke<RecordingSessionSnapshot>("start_recording_session", {
        request: {
          sessionId,
          targetId,
          videoPath,
          logPath,
          audioDir,
          micDeviceId: selectedMic,
          speakerDeviceId: selectedSpeaker,
          region: captureRegion,
          inputRegion: region,
          countdownSeconds: settings.countdown ? 3 : 0,
        },
      });

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
      startingRef.current = false;
      await invoke("update_recording_session", { dataDir: audioDir, videoPath, status: "recording", error: null }).catch(() => {});

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
      startingRef.current = false;
      activeSessionIdRef.current = "";
      console.error("[Snap] startRecording failed:", e);
      setRecordStatus(`Error: ${e}`);
      if (lastDataDirRef.current && lastVideoRef.current) {
        await invoke("update_recording_session", { dataDir: lastDataDirRef.current, videoPath: lastVideoRef.current, status: "failed", error: String(e) }).catch(() => {});
      }
      await invoke("set_editor_suspended_for_recording", { suspended: false }).catch(() => {});
    }
  };

  const stopRecording = async () => {
    if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
    setRecordStatus("");
    setProcessingRecording(true);
    setProcessingMessage("Closing video and audio streams…");

    // A stop click must have immediate visual acknowledgement. The native
    // finalization can take a few seconds, but leaving the recording dock and
    // red border visible makes the session look as though it is still live.
    // The launcher processing surface now owns feedback until the editor opens.
    await Promise.allSettled([
      invoke("set_dock_visible", { visible: false }),
      invoke("set_recording_overlay", { enabled: false, style: "off", region: null }),
      invoke("set_overlay_paused", { paused: false }),
    ]);

    const failures: string[] = [];
    try {
      await invoke<RecordingSessionSnapshot>("stop_recording_session", {
        sessionId: activeSessionIdRef.current,
      });
      setProcessingMessage("Checking audio sync and project data…");
    } catch (error) {
      failures.push(String(error));
    }

    setRecording(false);
    setIsPaused(false);
    pausedRef.current = false;
    pauseTransitionRef.current = false;
    activeSessionIdRef.current = "";
    setRecordStatus(failures.length > 0 ? `Recording needs attention: ${failures.join(" · ")}` : "");
    if (lastDataDirRef.current && lastVideoRef.current) {
      await invoke("update_recording_session", {
        dataDir: lastDataDirRef.current,
        videoPath: lastVideoRef.current,
        status: failures.length > 0 ? "incomplete" : "complete",
        error: failures.length > 0 ? failures.join("; ") : null,
      }).catch(() => {});
    }

    // Open the recording in its own editor window
    const targetVideo = lastVideoRef.current || lastVideo;
    const targetLog = lastLogRef.current || lastLog;
    try {
      if (failures.length === 0 && settings.autoOpenEditor && targetVideo && targetLog) {
        setProcessingMessage("Opening your recording in the editor…");
        await onOpenEditor(targetVideo, targetLog);
      } else {
        await invoke("set_editor_suspended_for_recording", { suspended: false }).catch(() => {});
      }
    } catch (error) {
      setRecordStatus(`Recording saved, but the editor could not open: ${error}`);
      await invoke("set_editor_suspended_for_recording", { suspended: false }).catch(() => {});
    } finally {
      setProcessingRecording(false);
    }
  };

  const handleFullScreen = async () => {
    const monitor = targets.find((t) => t.target_type === "monitor");
    if (!monitor) { setRecordStatus("No monitor found"); return; }
    setSelectedTarget(monitor.id);
    startWithCountdown(monitor.id);
  };

  const handleWindow = () => {
    invoke("open_window_picker_window").catch((error) => setRecordStatus(`Cannot open window picker: ${error}`));
  };

  const handlePickWindow = (id: string) => {
    setSelectedTarget(id);
    startWithCountdown(id);
  };
  windowTargetHandlerRef.current = handlePickWindow;

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
    invoke("open_device_window").catch((error) => setRecordStatus(`Cannot open device capture: ${error}`));
  };

  const handleOpenRecording = async () => {
    setShowFileMenu(false);
    try {
      await invoke("open_library_window");
      return;
    } catch (e) {
      setRecordStatus(`Cannot open media library: ${e}`);
      return;
    }
    /* Legacy inline picker retained as a fallback implementation. */
    // eslint-disable-next-line no-unreachable
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
  const togglePause = async () => {
    if (pauseTransitionRef.current || !activeSessionIdRef.current) return;
    pauseTransitionRef.current = true;
    const next = !isPaused;
    try {
      await invoke<RecordingSessionSnapshot>("set_recording_session_paused", {
        sessionId: activeSessionIdRef.current,
        paused: next,
      });
      setIsPaused(next);
      pausedRef.current = next;
      setRecordStatus(next ? "Paused" : "Recording");
    } catch (error) {
      setRecordStatus(`Pause failed: ${error}`);
    } finally {
      pauseTransitionRef.current = false;
    }
  };

  // Keep the floating dock window in sync with recording state.
  useEffect(() => {
    if (!recording) return;
    invoke("update_dock_state", {
      snapshot: { recording: true, elapsed, paused: isPaused, mic_muted: micMuted },
    }).catch(() => {});
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
            <div className="focusee-mode-cards-grid">
            {/* Card 1: Full Screen */}
            <div className="focusee-card" onClick={handleFullScreen}>
              <div className="card-thumb-frame">
                <div className="wallpaper-preview full-screen-preview" />
              </div>
              <span className="card-title-text"><strong>Full Screen</strong></span>
            </div>

            {/* Card 2: Custom Region */}
            <div className="focusee-card" onClick={handleCustom}>
              <div className="card-thumb-frame">
                <div className="wallpaper-preview custom-region-preview">
                  <div className="cyan-crop-box" />
                </div>
              </div>
              <span className="card-title-text"><strong>Custom</strong></span>
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
              <span className="card-title-text"><strong>Window</strong></span>
            </div>

            {/* Card 4: Device */}
            <div className="focusee-card" onClick={handleDevice}>
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
          <div className="setup-field" aria-label="Camera"><span className="setup-field-icon" title="Camera"><Video size={18} /></span>{cameraDevices.length > 0 ? <Dropdown value={selectedCamera} onChange={setSelectedCamera} options={cameraDevices.map((camera) => ({ value: camera.id, label: camera.name }))} /> : <div className="device-unavailable-row"><span>Connect a camera</span></div>}</div>

          {/* Microphone Dropdown */}
          <div className="setup-field" aria-label="Microphone"><span className="setup-field-icon" title="Microphone"><Mic size={18} /></span>{microphones.length > 0 ? <Dropdown value={selectedMic} onChange={setSelectedMic} options={microphones.map((microphone) => ({ value: microphone.id, label: microphone.name }))} /> : <div className="device-unavailable-row"><span>Connect a microphone</span></div>}</div>

          {/* Speaker Dropdown */}
          <div className="setup-field" aria-label="Desktop audio"><span className="setup-field-icon" title="Desktop audio"><Volume2 size={18} /></span>{speakers.length > 0 ? <Dropdown value={selectedSpeaker} onChange={setSelectedSpeaker} options={speakers.map((speaker) => ({ value: speaker.id, label: speaker.name }))} /> : <div className="device-unavailable-row"><span>Connect an output</span></div>}</div>

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

      {processingRecording && (
        <div className="recording-processing-overlay" role="dialog" aria-modal="true" aria-labelledby="recording-processing-title">
          <div className="recording-processing-card">
            <span className="recording-processing-icon"><LoaderCircle size={22} /></span>
            <div className="recording-processing-copy">
              <strong id="recording-processing-title">Preparing your recording</strong>
              <span>{processingMessage}</span>
            </div>
            <div className="recording-processing-track" aria-hidden="true"><i /></div>
            <small>Snap is smoothing playback and aligning the recording before the editor opens.</small>
          </div>
        </div>
      )}

      {recordStatus && recordStatus !== "Recording" && (
        <div className={`recording-status-toast ${recordStatus.startsWith("Error:") || recordStatus.includes("failed") ? "error" : ""}`} role="status">
          <span>{recordStatus}</span>
          {!recording && <button onClick={() => setRecordStatus("")} aria-label="Dismiss status"><X size={13} /></button>}
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
