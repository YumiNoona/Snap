import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronLeft, Clock, ChevronDown, Upload, Minus, Square, X, LayoutTemplate, MousePointer2, Type, Sparkles, AudioWaveform, Download } from "lucide-react";
import Preview from "./Preview/index";
import Timeline from "./Timeline/index";
import Panels from "./Panels/index";
import type { EditorConfig, Keyframe, ExportSettings, Layer } from "../../lib/types";
import { DEFAULT_EDITOR_CONFIG } from "../../lib/types";
import "./Editor.css";

interface Props {
  videoPath: string;
  inputLogPath: string;
  onClose: () => void;
}

export type SidebarToolTab = "canvas" | "cursor" | "annotations" | "motion" | "audio" | "export";

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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const appWindow = getCurrentWindow();

  // Persist per-pack cursor hotspot nudges across sessions
  useEffect(() => {
    try {
      localStorage.setItem(HOTSPOTS_STORAGE_KEY, JSON.stringify(config.cursorHotspots));
    } catch {
      // ignore storage errors
    }
  }, [config.cursorHotspots]);

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
    try {
      await invoke("export_video", {
        inputVideo: videoPath,
        inputLog: inputLogPath,
        config: {
          ...config,
          keyframes,
        },
        exportSettings: settings,
      });
      setExportStatus(`Done: ${settings.outputPath}`);
    } catch (e) {
      setExportStatus(`Export failed: ${e}`);
    }
  };

  const handleAddManualZoom = () => {
    const tMs = Math.round(currentTime * 1000);
    const newKf: Keyframe = {
      time: tMs,
      duration: 400,
      x: 0.5,
      y: 0.5,
      scale: config.zoomLevel || 2.0,
      easing: "ease-in-out",
    };
    const updated = [...keyframes.filter((k) => Math.abs(k.time - tMs) > 100), newKf].sort((a, b) => a.time - b.time);
    setKeyframes(updated);
  };

  return (
    <div className="screenstudio-editor-layout">
      {/* ── Top Bar ────────────────────────────────────────────── */}
      <header className="ss-topbar" data-tauri-drag-region>
        <div
          className="ss-drag-area"
          data-tauri-drag-region
          onMouseDown={async (e) => {
            e.preventDefault();
            await appWindow.startDragging();
          }}
        />

        <div className="ss-topbar-left">
          {/* Back button */}
          <button className="ss-icon-btn back-btn" onClick={onClose} title="Close Editor">
            <ChevronLeft size={16} />
          </button>

          <span className="ss-file-title">
            {videoPath.split("\\").pop()}
          </span>
        </div>

        <div className="ss-topbar-center">
          {/* Quick Presets / Undo */}
          <div className="ss-presets-pill">
            <Clock size={13} />
            <span>Presets</span>
            <ChevronDown size={12} />
          </div>
        </div>

        <div className="ss-topbar-right">
          {/* PROMINENT TOP-RIGHT EXPORT BUTTON */}
          <button
            className="ss-topbar-export-btn"
            onClick={() => setActiveTool("export")}
          >
            <Upload size={14} />
            Export
          </button>

          <div className="ss-window-controls">
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

      {/* ── Main Workspace: Sidebar + Preview + Panels ─────────── */}
      <div className="ss-editor-body">
        {/* Left Vertical Tool Bar (Screen Studio style) */}
        <aside className="ss-vertical-tool-palette">
          <button
            className={`ss-tool-icon-btn ${activeTool === "canvas" ? "active" : ""}`}
            onClick={() => setActiveTool("canvas")}
            title="Canvas & Background"
          >
            <LayoutTemplate size={18} />
          </button>

          <button
            className={`ss-tool-icon-btn ${activeTool === "cursor" ? "active" : ""}`}
            onClick={() => setActiveTool("cursor")}
            title="Cursor & Pointer Styling"
          >
            <MousePointer2 size={18} />
          </button>

          <button
            className={`ss-tool-icon-btn ${activeTool === "annotations" ? "active" : ""}`}
            onClick={() => setActiveTool("annotations")}
            title="Annotations & Layers"
          >
            <Type size={18} />
          </button>

          <button
            className={`ss-tool-icon-btn ${activeTool === "motion" ? "active" : ""}`}
            onClick={() => setActiveTool("motion")}
            title="Motion & Blur"
          >
            <Sparkles size={18} />
          </button>

          <button
            className={`ss-tool-icon-btn ${activeTool === "audio" ? "active" : ""}`}
            onClick={() => setActiveTool("audio")}
            title="Audio"
          >
            <AudioWaveform size={18} />
          </button>

          <button
            className={`ss-tool-icon-btn ${activeTool === "export" ? "active" : ""}`}
            onClick={() => setActiveTool("export")}
            title="Render & Export Settings"
          >
            <Download size={18} />
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
          />
        </div>

        {/* Right Tool Settings Panel Drawer */}
        <Panels
          config={config}
          onConfigChange={setConfig}
          videoPath={videoPath}
          duration={duration}
          currentTime={currentTime}
          keyframesCount={keyframes.length}
          layers={config.layers}
          selectedLayerId={selectedLayerId}
          onAddLayer={(layer: Layer) => setConfig((c) => ({ ...c, layers: [...c.layers, layer] }))}
          onSelectLayer={setSelectedLayerId}
          onExport={handleExport}
          exportStatus={exportStatus}
          activeTab={activeTool}
          onAddManualZoom={handleAddManualZoom}
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
      />
    </div>
  );
}
