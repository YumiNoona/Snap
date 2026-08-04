import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Preview from "./Preview/index";
import Timeline from "./Timeline/index";
import Panels from "./Panels/index";
import type { EditorConfig, Keyframe, ExportSettings } from "../../lib/types";
import { DEFAULT_EDITOR_CONFIG } from "../../lib/types";
import "./Editor.css";

interface Props {
  videoPath: string;
  inputLogPath: string;
  onClose: () => void;
}

export type SidebarToolTab = "background" | "zoom" | "cursor" | "audio" | "shadow" | "export";

export default function Editor({ videoPath, inputLogPath, onClose }: Props) {
  const [config, setConfig] = useState<EditorConfig>(DEFAULT_EDITOR_CONFIG);
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const [activeTool, setActiveTool] = useState<SidebarToolTab>("background");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const appWindow = getCurrentWindow();

  // Sync playing state with video element
  useEffect(() => {
    const el = document.querySelector("video");
    if (el) {
      videoRef.current = el;
      const onPlay = () => setPlaying(true);
      const onPause = () => setPlaying(false);
      el.addEventListener("play", onPlay);
      el.addEventListener("pause", onPause);
      return () => {
        el.removeEventListener("play", onPlay);
        el.removeEventListener("pause", onPause);
      };
    }
  }, []);

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      el.play();
      setPlaying(true);
    } else {
      el.pause();
      setPlaying(false);
    }
  }, []);

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

  // Add a manual zoom keyframe at playhead position
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
      <header className="ss-topbar">
        <div
          className="ss-drag-area"
          onMouseDown={async (e) => {
            e.preventDefault();
            await appWindow.startDragging();
          }}
        />

        <div className="ss-topbar-left">
          {/* Back button */}
          <button className="ss-icon-btn back-btn" onClick={onClose} title="Back to Launcher">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          <span className="ss-file-title">
            {videoPath.split("\\").pop()}
          </span>
        </div>

        <div className="ss-topbar-center">
          {/* Quick Presets / Undo */}
          <div className="ss-presets-pill">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4l3 3" />
            </svg>
            <span>Presets</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        </div>

        <div className="ss-topbar-right">
          {/* PROMINENT TOP-RIGHT EXPORT BUTTON */}
          <button
            className="ss-topbar-export-btn"
            onClick={() => setActiveTool("export")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Export
          </button>

          <div className="ss-window-controls">
            <button className="window-btn" title="Minimize" onClick={() => appWindow.minimize()}>
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" width="12" height="12">
                <line x1="2" y1="6" x2="10" y2="6" />
              </svg>
            </button>
            <button className="window-btn" title="Maximize" onClick={() => appWindow.toggleMaximize()}>
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" width="12" height="12">
                <rect x="2" y="2" width="8" height="8" rx="1" />
              </svg>
            </button>
            <button className="window-btn close-btn" title="Close" onClick={() => appWindow.close()}>
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" width="12" height="12">
                <line x1="2" y1="2" x2="10" y2="10" />
                <line x1="10" y1="2" x2="2" y2="10" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* ── Main Workspace: Sidebar + Preview + Panels ─────────── */}
      <div className="ss-editor-body">
        {/* Left Vertical Tool Bar (Screen Studio style) */}
        <aside className="ss-vertical-tool-palette">
          <button
            className={`ss-tool-icon-btn ${activeTool === "background" ? "active" : ""}`}
            onClick={() => setActiveTool("background")}
            title="Background & Wallpaper"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </button>

          <button
            className={`ss-tool-icon-btn ${activeTool === "zoom" ? "active" : ""}`}
            onClick={() => setActiveTool("zoom")}
            title="Zoom & Pan Motion"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>

          <button
            className={`ss-tool-icon-btn ${activeTool === "cursor" ? "active" : ""}`}
            onClick={() => setActiveTool("cursor")}
            title="Cursor & Pointer Styling"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M3 3l7 18 3-7 7-3L3 3z" />
            </svg>
          </button>

          <button
            className={`ss-tool-icon-btn ${activeTool === "shadow" ? "active" : ""}`}
            onClick={() => setActiveTool("shadow")}
            title="Shadow & Corners"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <rect x="4" y="4" width="16" height="16" rx="3" />
            </svg>
          </button>

          <button
            className={`ss-tool-icon-btn ${activeTool === "export" ? "active" : ""}`}
            onClick={() => setActiveTool("export")}
            title="Render & Export Settings"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
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
              if (config.trimEnd === 0) {
                setConfig({ ...config, trimEnd: d });
              }
            }}
            onClick={togglePlay}
          />
        </div>

        {/* Right Tool Settings Panel Drawer */}
        <Panels
          config={config}
          onConfigChange={setConfig}
          videoPath={videoPath}
          duration={duration}
          keyframesCount={keyframes.length}
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
        onSeek={(t: number) => {
          const el = videoRef.current;
          if (el) {
            el.currentTime = t;
            setCurrentTime(t);
          }
        }}
        onTrimStartChange={(t: number) =>
          setConfig({ ...config, trimStart: t })
        }
        onTrimEndChange={(t: number) =>
          setConfig({ ...config, trimEnd: t })
        }
        onCutsChange={(newCuts: number[]) =>
          setConfig({ ...config, cuts: newCuts })
        }
        onAspectChange={(ar) => setConfig({ ...config, aspectRatio: ar })}
      />
    </div>
  );
}
