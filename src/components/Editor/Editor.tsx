import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Preview from "./Preview/index";
import Timeline from "./Timeline/index";
import Panels from "./Panels/index";
import type {
  EditorConfig,
  Keyframe,
  ExportSettings,
} from "../../lib/types";
import { DEFAULT_EDITOR_CONFIG } from "../../lib/types";
import "./Editor.css";

interface Props {
  videoPath: string;
  inputLogPath: string;
  onClose: () => void;
}

export default function Editor({ videoPath, inputLogPath, onClose }: Props) {
  const [config, setConfig] = useState<EditorConfig>(DEFAULT_EDITOR_CONFIG);
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
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

  return (
    <div className="editor-layout">
      {/* Top bar */}
      <header className="editor-topbar">
        <div
          className="editor-drag-area"
          onMouseDown={async (e) => {
            e.preventDefault();
            await appWindow.startDragging();
          }}
        />
        <div className="editor-topbar-left">
          <button className="editor-back-btn" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back
          </button>
          <span className="editor-filename">
            {videoPath.split("\\").pop()}
          </span>
        </div>
        <div className="editor-topbar-center">
          {exportStatus && (
            <span className="editor-export-status">{exportStatus}</span>
          )}
        </div>
        <div className="editor-topbar-right">
          <button className="window-btn" title="Minimize" onClick={() => appWindow.minimize()}>
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" width="12" height="12">
              <line x1="2" y1="6" x2="10" y2="6" />
            </svg>
          </button>
          <button className="window-btn" title="Maximize" onClick={() => appWindow.toggleMaximize()}>
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" width="12" height="12">
              <rect x="2" y="2" width="8" height="8" rx="1" />
            </svg>
          </button>
          <button className="window-btn close-btn" title="Close" onClick={() => appWindow.close()}>
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" width="12" height="12">
              <line x1="2" y1="2" x2="10" y2="10" />
              <line x1="10" y1="2" x2="2" y2="10" />
            </svg>
          </button>
        </div>
      </header>

      {/* Body: Panels (left) + Preview */}
      <div className="editor-body">
        <Panels
          config={config}
          onConfigChange={setConfig}
          videoPath={videoPath}
          duration={duration}
          currentTime={currentTime}
          keyframesCount={keyframes.length}
          onExport={handleExport}
        />
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

      {/* Timeline */}
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
      />
    </div>
  );
}
