import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MorphIcon } from "morphicons/react";
import { Square as SquareIcon, Minimize2 as RestoreIcon } from "lucide";
import { ChevronLeft, Clock, ChevronDown, Upload, Minus, X, LayoutTemplate, MousePointer2, Type, Sparkles, AudioWaveform } from "lucide-react";
import Preview from "./Preview/index";
import Timeline from "./Timeline/index";
import Panels from "./Panels/index";
import ExportModal from "./ExportModal";
import type { EditorConfig, Keyframe, ExportSettings, Layer } from "../../lib/types";
import { DEFAULT_EDITOR_CONFIG } from "../../lib/types";
import { runCanvasExport } from "../../lib/canvasExport";
import "./Editor.css";

interface Props {
  videoPath: string;
  inputLogPath: string;
  onClose: () => void;
}

export type SidebarToolTab = "canvas" | "cursor" | "annotations" | "motion" | "audio";

const HOTSPOTS_STORAGE_KEY = "snap.cursorHotspots";

function loadCursorHotspots(): Record<string, { x: number; y: number }> {
  try {
    return JSON.parse(localStorage.getItem(HOTSPOTS_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

export default function Editor({ videoPath, inputLogPath, onClose }: Props) {
  const [config, setConfig] = useState<EditorConfig>(() => ({
    ...DEFAULT_EDITOR_CONFIG,
    cursorHotspots: loadCursorHotspots(),
  }));
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const [activeTool, setActiveTool] = useState<SidebarToolTab>("canvas");
  const [cropMode, setCropMode] = useState(false);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [zoomTargetMode, setZoomTargetMode] = useState(false);
  const [autoZoomRevision, setAutoZoomRevision] = useState(0);
  const [showExport, setShowExport] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [isMaximized, setIsMaximized] = useState(false);
  const [, setHistoryVersion] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const appWindow = getCurrentWindow();
  const historyRef = useRef<Array<{ config: EditorConfig; keyframes: Keyframe[] }>>([]);
  const futureRef = useRef<Array<{ config: EditorConfig; keyframes: Keyframe[] }>>([]);
  const lastSnapshotRef = useRef({ config, keyframes });
  const applyingHistoryRef = useRef(false);

  useEffect(() => {
    const current = { config, keyframes };
    if (applyingHistoryRef.current) {
      applyingHistoryRef.current = false;
      lastSnapshotRef.current = current;
      setHistoryVersion((value) => value + 1);
      return;
    }
    const previous = lastSnapshotRef.current;
    if (previous.config === config && previous.keyframes === keyframes) return;
    historyRef.current.push(previous);
    if (historyRef.current.length > 80) historyRef.current.shift();
    futureRef.current = [];
    lastSnapshotRef.current = current;
    setHistoryVersion((value) => value + 1);
  }, [config, keyframes]);

  const undo = useCallback(() => {
    const snapshot = historyRef.current.pop();
    if (!snapshot) return;
    futureRef.current.push({ config, keyframes });
    applyingHistoryRef.current = true;
    setConfig(snapshot.config);
    setKeyframes(snapshot.keyframes);
  }, [config, keyframes]);

  const redo = useCallback(() => {
    const snapshot = futureRef.current.pop();
    if (!snapshot) return;
    historyRef.current.push({ config, keyframes });
    applyingHistoryRef.current = true;
    setConfig(snapshot.config);
    setKeyframes(snapshot.keyframes);
  }, [config, keyframes]);

  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
    };
    window.addEventListener("keydown", handleHistoryShortcut);
    return () => window.removeEventListener("keydown", handleHistoryShortcut);
  }, [undo, redo]);

  // Persist per-pack cursor hotspot nudges across sessions
  useEffect(() => {
    try {
      localStorage.setItem(HOTSPOTS_STORAGE_KEY, JSON.stringify(config.cursorHotspots));
    } catch {
      // ignore storage errors
    }
  }, [config.cursorHotspots]);

  useEffect(() => {
    invoke("window_ready").catch((e) => {
      console.error("[Snap] window_ready failed — editor window will stay hidden:", e);
    });
  }, []);

  // Sync playing state with video element
  useEffect(() => {
    const el = document.querySelector<HTMLVideoElement>("video#preview-video");
    if (el) {
      videoRef.current = el;
      const onPlay = () => setPlaying(true);
      const onPause = () => setPlaying(false);
      el.addEventListener("play", onPlay);
      el.addEventListener("pause", onPause);
      return () => {
        el.removeEventListener("play", onPlay);
        el.removeEventListener("pause", onPause);
        videoRef.current = null;
      };
    }
  }, [videoPath]);

  const togglePlay = useCallback(() => {
    const el = videoRef.current ?? document.querySelector<HTMLVideoElement>("video#preview-video");
    if (!el) return;
    if (el.paused) {
      el.play()?.catch(() => {});
      setPlaying(true);
    } else {
      el.pause();
      setPlaying(false);
    }
  }, []);

  // Pause playback at the trim end / keep playhead inside the trim range
  useEffect(() => {
    const el = videoRef.current ?? document.querySelector("video");
    if (!el) return;
    const onTime = () => {
      const end = config.trimEnd || el.duration || 0;
      if (!el.paused && end > 0 && el.currentTime >= end) {
        el.pause();
        el.currentTime = end;
        setCurrentTime(end);
      }
    };
    el.addEventListener("timeupdate", onTime);
    return () => el.removeEventListener("timeupdate", onTime);
  }, [config.trimEnd, config.trimStart, videoPath]);

  const seekTo = useCallback(
    (t: number) => {
      const el = videoRef.current;
      if (!el) return;
      const end = config.trimEnd || el.duration || t;
      const clamped = Math.max(config.trimStart, Math.min(t, end));
      el.currentTime = clamped;
      setCurrentTime(clamped);
    },
    [config.trimStart, config.trimEnd]
  );

  const handleToggleCrop = useCallback(() => setCropMode((m) => !m), []);

  const handleCropApply = useCallback(
    (crop: { x: number; y: number; w: number; h: number } | null) => {
      setConfig((c) => ({ ...c, crop }));
      setCropMode(false);
    },
    []
  );

  const handleCropCancel = useCallback(() => setCropMode(false), []);

  const handleTrimStart = (t: number) => {
    setConfig({ ...config, trimStart: t });
    const el = videoRef.current;
    if (el && el.currentTime < t) {
      el.currentTime = t;
      setCurrentTime(t);
    }
  };

  const handleTrimEnd = (t: number) => {
    setConfig({ ...config, trimEnd: t });
    const el = videoRef.current;
    if (el && el.currentTime > t) {
      el.currentTime = t;
      setCurrentTime(t);
    }
  };

  const handleExport = async (settings: ExportSettings) => {
    setExportStatus("Exporting...");
    setExportProgress(0);
    try {
      const result = await runCanvasExport(
        videoPath,
        inputLogPath,
        keyframes,
        config,
        settings,
        config.trimStart,
        config.trimEnd > 0 ? config.trimEnd : duration,
        (p) => {
          if (p.phase === "recording") {
            setExportStatus(`Exporting... ${Math.round(p.progress * 100)}%`);
            setExportProgress(p.progress);
          } else if (p.phase === "finalizing") {
            setExportStatus("Finalizing...");
            setExportProgress(0.98);
          }
        }
      );
      setExportStatus(`Done: ${settings.outputPath}`);
      setExportProgress(1);
      void result;
    } catch (e) {
      setExportStatus(`Export failed: ${e}`);
    }
  };

  const addManualZoomAt = (point: { x: number; y: number }) => {
    const videoEndMs = Math.max(0, Math.round((config.trimEnd || duration) * 1000));
    const trimStartMs = Math.round(config.trimStart * 1000);
    const latestStartMs = Math.max(trimStartMs, videoEndMs - 600);
    const startMs = Math.min(latestStartMs, Math.max(trimStartMs, Math.round(currentTime * 1000)));
    const endMs = Math.min(videoEndMs, startMs + 3000);
    const available = Math.max(300, endMs - startMs);
    const transitionMs = Math.min(450, Math.max(150, Math.round(available * 0.18)));
    const zoomInMs = Math.min(endMs, startMs + transitionMs);
    const holdUntilMs = Math.max(zoomInMs, endMs - transitionMs);
    const zoomKf: Keyframe = {
      time: zoomInMs,
      duration: transitionMs,
      x: point.x,
      y: point.y,
      scale: config.zoomLevel || 2.0,
      easing: "ease-in-out",
    };
    const holdKf: Keyframe = { ...zoomKf, time: holdUntilMs, duration: 0 };
    const resetKf: Keyframe = {
      time: endMs,
      duration: transitionMs,
      x: 0.5,
      y: 0.5,
      scale: 1,
      easing: "ease-in-out",
    };
    const base = keyframes.length > 0
      ? keyframes.filter((frame) => frame.time < startMs || frame.time > endMs)
      : [{ time: 0, duration: 0, x: 0.5, y: 0.5, scale: 1, easing: "ease" as const }];
    const updated = [...base, zoomKf, holdKf, resetKf].sort((a, b) => a.time - b.time);
    setKeyframes(updated);
    setZoomTargetMode(false);
  };

  const handleAddManualZoom = () => setZoomTargetMode(true);

  useEffect(() => {
    if (!zoomTargetMode) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZoomTargetMode(false);
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [zoomTargetMode]);

  return (
    <div className="screenstudio-editor-layout">
      {/* ── Top Bar ────────────────────────────────────────────── */}
      <header className="ss-topbar" data-tauri-drag-region>
        <div className="ss-drag-area" data-tauri-drag-region />
        <div className="ss-topbar-left">
          {/* Back button */}
          <button className="ss-icon-btn back-btn" onClick={onClose} title="Close Editor">
            <ChevronLeft size={20} />
          </button>

          <span className="ss-file-title">
            {videoPath.split("\\").pop()}
          </span>
        </div>

        <div className="ss-topbar-center">
          {/* Quick Presets / Undo */}
          <div className="ss-presets-pill">
            <Clock size={16} />
            <span>Presets</span>
            <ChevronDown size={14} />
          </div>
        </div>

        <div className="ss-topbar-right">
          {/* PROMINENT TOP-RIGHT EXPORT BUTTON */}
          <button
            className="ss-topbar-export-btn"
            onClick={() => setShowExport(true)}
          >
            <Upload size={17} />
            Export
          </button>

          <div className="ss-window-controls">
            <button className="window-btn" title="Minimize" onClick={() => appWindow.minimize()}>
              <Minus size={15} />
            </button>
            <button className="window-btn" title={isMaximized ? "Restore" : "Maximize"} onClick={async () => {
              await appWindow.toggleMaximize();
              setIsMaximized(await appWindow.isMaximized());
            }}>
              <MorphIcon icon={isMaximized ? RestoreIcon : SquareIcon} spring="snappy" size={15} />
            </button>
            <button className="window-btn close-btn" title="Close" onClick={() => appWindow.close()}>
              <X size={15} />
            </button>
          </div>
        </div>
      </header>

      {/* ── Main Workspace: Sidebar + Preview + Panels ─────────── */}
      <div className="ss-editor-body">
        {/* Left Vertical Tool Bar (Screen Studio style) */}
        <aside className="ss-vertical-tool-palette">
          <button
            className={`ss-tool-icon-btn ${activeTool === "canvas" ? "active" : ""}`}
            onClick={() => setActiveTool("canvas")}
            title="Canvas & Background"
          >
            <LayoutTemplate size={21} />
          </button>

          <button
            className={`ss-tool-icon-btn ${activeTool === "cursor" ? "active" : ""}`}
            onClick={() => setActiveTool("cursor")}
            title="Cursor & Pointer Styling"
          >
            <MousePointer2 size={21} />
          </button>

          <button
            className={`ss-tool-icon-btn ${activeTool === "annotations" ? "active" : ""}`}
            onClick={() => setActiveTool("annotations")}
            title="Annotations & Layers"
          >
            <Type size={21} />
          </button>

          <button
            className={`ss-tool-icon-btn ${activeTool === "motion" ? "active" : ""}`}
            onClick={() => setActiveTool("motion")}
            title="Motion & Blur"
          >
            <Sparkles size={21} />
          </button>

          <button
            className={`ss-tool-icon-btn ${activeTool === "audio" ? "active" : ""}`}
            onClick={() => setActiveTool("audio")}
            title="Audio"
          >
            <AudioWaveform size={21} />
          </button>

        </aside>

        {/* Center Preview Workspace */}
        <div className="ss-preview-center-area">
          <Preview
            videoPath={videoPath}
            inputLogPath={inputLogPath}
            config={config}
            keyframes={keyframes}
            onKeyframesChange={setKeyframes}
            playing={playing}
            onTimeUpdate={setCurrentTime}
            onDuration={(d) => {
              setDuration(d);
              setConfig((c) => (c.trimEnd === 0 ? { ...c, trimEnd: d } : c));
            }}
            onClick={togglePlay}
            cropMode={cropMode}
            onCropApply={handleCropApply}
            onCropCancel={handleCropCancel}
            selectedLayerId={selectedLayerId}
            onLayerChange={(updated) => setConfig((c) => ({
              ...c,
              layers: c.layers.map((layer) => layer.id === updated.id ? updated : layer),
            }))}
            zoomTargetMode={zoomTargetMode}
            onZoomTargetPick={addManualZoomAt}
            autoZoomRevision={autoZoomRevision}
          />
        </div>

        {/* Right Tool Settings Panel Drawer */}
        <Panels
          config={config}
          onConfigChange={setConfig}
          duration={duration}
          currentTime={currentTime}
          keyframesCount={keyframes.length}
          layers={config.layers}
          selectedLayerId={selectedLayerId}
          onAddLayer={(layer: Layer) => setConfig((c) => ({ ...c, layers: [...c.layers, layer] }))}
          onSelectLayer={setSelectedLayerId}
          activeTab={activeTool}
          onAddManualZoom={handleAddManualZoom}
          onRegenerateAutoZoom={() => {
            setConfig((c) => ({ ...c, zoomMode: "auto" }));
            setAutoZoomRevision((value) => value + 1);
          }}
          onZoomModeChange={(mode) => {
            setConfig((c) => ({ ...c, zoomMode: mode }));
            setZoomTargetMode(false);
            if (mode === "auto") {
              setAutoZoomRevision((value) => value + 1);
            } else {
              setKeyframes([{ time: 0, duration: 0, x: 0.5, y: 0.5, scale: 1, easing: "ease" }]);
            }
          }}
        />
      </div>

      {/* ── Multi-Track Timeline (Screen Studio Style) ─────────────── */}
      <Timeline
        videoPath={videoPath}
        duration={duration}
        currentTime={currentTime}
        keyframes={keyframes}
        config={config}
        playing={playing}
        onTogglePlay={togglePlay}
        onSeek={seekTo}
        onTrimStartChange={handleTrimStart}
        onTrimEndChange={handleTrimEnd}
        onCutsChange={(newCuts: number[]) =>
            setConfig((c) => ({ ...c, cuts: newCuts }))
        }
        onAspectChange={(ar) => setConfig((c) => ({ ...c, aspectRatio: ar }))}
        onToggleCrop={handleToggleCrop}
        cropActive={cropMode || !!config.crop}
        canUndo={historyRef.current.length > 0}
        canRedo={futureRef.current.length > 0}
        onUndo={undo}
        onRedo={redo}
        onKeyframesChange={setKeyframes}
        onAudioMuteChange={(track, muted) => setConfig((current) => ({
          ...current,
          audio: {
            ...current.audio,
            ...(track === "system" ? { systemMuted: muted } : { micMuted: muted }),
          },
        }))}
      />
      {showExport && (
        <ExportModal
          videoPath={videoPath}
          duration={duration}
          config={config}
          status={exportStatus}
          progress={exportProgress}
          onClose={() => setShowExport(false)}
          onExport={handleExport}
        />
      )}
    </div>
  );
}
