import { useRef, useCallback, useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Keyframe, EditorConfig } from "../../../lib/types";
import { ASPECT_RATIOS } from "../../../lib/types";
import "./Timeline.css";

interface Props {
  videoPath: string;
  duration: number;
  currentTime: number;
  keyframes: Keyframe[];
  config: EditorConfig;
  onSeek: (t: number) => void;
  onTrimStartChange: (t: number) => void;
  onTrimEndChange: (t: number) => void;
  onCutsChange: (cuts: number[]) => void;
  onAspectChange: (ar: { width: number; height: number } | null) => void;
}

export default function Timeline({
  videoPath,
  duration,
  currentTime,
  keyframes,
  config,
  onSeek,
  onTrimStartChange,
  onTrimEndChange,
  onCutsChange,
  onAspectChange,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<"playhead" | "trim-start" | "trim-end" | null>(null);
  const [_hasAudio, setHasAudio] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const [showAspectMenu, setShowAspectMenu] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const lastSlash = Math.max(videoPath.lastIndexOf("\\"), videoPath.lastIndexOf("/"));
        const dir = lastSlash >= 0 ? videoPath.substring(0, lastSlash) : ".";
        const fileName = lastSlash >= 0 ? videoPath.substring(lastSlash + 1) : videoPath;
        const baseName = fileName.replace(/\.[^.]+$/, "");
        const audioDir = `${dir}\\${baseName}`;
        const files = await invoke<Array<{ name: string; path: string; is_dir: boolean; size: number }>>("list_directory", { path: dir });
        let hasSys = files.some((f) => f.path === `${audioDir}\\system_audio.wav` && f.size > 0);
        let hasMic = files.some((f) => f.path === `${audioDir}\\mic_audio.wav` && f.size > 0);
        setHasAudio(hasSys || hasMic);
      } catch { setHasAudio(false); }
    })();
  }, [videoPath]);

  // Scissor cut
  const handleScissorCut = () => {
    if (duration <= 0) return;
    const cutPoint = Math.round(currentTime * 100) / 100;
    if (cutPoint <= config.trimStart || cutPoint >= (config.trimEnd || duration)) return;
    if (config.cuts.includes(cutPoint)) return;

    const newCuts = [...config.cuts, cutPoint].sort((a, b) => a - b);
    onCutsChange(newCuts);
  };

  const getTimeFromEvent = useCallback(
    (e: MouseEvent | React.MouseEvent): number => {
      const track = trackRef.current;
      if (!track || duration <= 0) return 0;
      const rect = track.getBoundingClientRect();
      const x = e.clientX - rect.left;
      return Math.max(0, Math.min(duration, (x / rect.width) * duration));
    },
    [duration]
  );

  const handleMouseDown = (type: "playhead" | "trim-start" | "trim-end") => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDragging(type);

    const onMove = (ev: MouseEvent) => {
      const t = getTimeFromEvent(ev as unknown as React.MouseEvent);
      if (type === "playhead") onSeek(t);
      else if (type === "trim-start") onTrimStartChange(Math.min(t, (config.trimEnd || duration) - 0.1));
      else onTrimEndChange(Math.max(t, config.trimStart + 0.1));
    };
    const onUp = () => {
      setDragging(null);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const pct = (t: number) => `${duration > 0 ? (t / duration) * 100 : 0}%`;
  const currentAspectLabel = ASPECT_RATIOS.find((ar) =>
    (config.aspectRatio === null && ar.width === 0) ||
    (config.aspectRatio?.width === ar.width && config.aspectRatio?.height === ar.height)
  )?.label || "Wide 16:9";

  return (
    <div className="ss-timeline-container">
      {/* ── Screen Studio Toolbar ──────────────────────────────────── */}
      <div className="ss-timeline-toolbar">
        <div className="tb-left-group">
          {/* Aspect Ratio Selector */}
          <div className="aspect-menu-wrap">
            <button
              className="ss-tb-btn aspect-btn"
              onClick={() => setShowAspectMenu(!showAspectMenu)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <rect x="2" y="4" width="20" height="16" rx="2" />
              </svg>
              <span>{currentAspectLabel}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {showAspectMenu && (
              <div className="aspect-dropdown-menu">
                {ASPECT_RATIOS.map((ar) => (
                  <button
                    key={ar.label}
                    className="aspect-item"
                    onClick={() => {
                      onAspectChange(ar.width > 0 ? { width: ar.width, height: ar.height } : null);
                      setShowAspectMenu(false);
                    }}
                  >
                    {ar.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button className="ss-tb-btn crop-btn" title="Crop Canvas Region">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <path d="M6 2v14a2 2 0 0 0 2 2h14" />
              <path d="M18 22V8a2 2 0 0 0-2-2H2" />
            </svg>
            <span>Crop</span>
          </button>
        </div>

        {/* Center Transport Controls & Timecode */}
        <div className="tb-center-group">
          <span className="tb-timecode-text">{formatTimecode(currentTime)}</span>

          <div className="tb-transport-buttons">
            <button className="tb-transport-btn" onClick={() => onSeek(0)} title="Jump to Start">
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
              </svg>
            </button>

            <button className="tb-play-circle-btn" onClick={() => onSeek(currentTime)} title="Play / Pause">
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
                <polygon points="10,8 16,12 10,16" />
              </svg>
            </button>

            <button className="tb-transport-btn" onClick={() => onSeek(duration)} title="Jump to End">
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
              </svg>
            </button>
          </div>

          <span className="tb-timecode-text total">{formatTimecode(duration)}</span>
        </div>

        {/* Right Tools (Scissor cut & Zoom scale) */}
        <div className="tb-right-group">
          <button className="ss-tb-btn primary-scissor-btn" onClick={handleScissorCut} title="Split Clip at Playhead (C)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <circle cx="6" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <line x1="20" y1="4" x2="8.12" y2="15.88" />
              <line x1="14.47" y1="14.48" x2="20" y2="20" />
              <line x1="8.12" y1="8.12" x2="12" y2="12" />
            </svg>
          </button>

          <div className="timeline-zoom-slider-wrap">
            <button className="zoom-step-btn" onClick={() => setZoomScale(Math.max(1, zoomScale - 0.5))}>−</button>
            <input
              type="range"
              min={1}
              max={4}
              step={0.5}
              value={zoomScale}
              onChange={(e) => setZoomScale(Number(e.target.value))}
            />
            <button className="zoom-step-btn" onClick={() => setZoomScale(Math.min(4, zoomScale + 0.5))}>+</button>
          </div>
        </div>
      </div>

      {/* ── Multi-Track Area (Clip & Zoom Tracks) ───────────────────── */}
      <div className="ss-tracks-wrapper" ref={trackRef} onClick={(e) => { if (!dragging) onSeek(getTimeFromEvent(e)); }}>
        {/* Clip Track (Amber / Gold Bar) */}
        <div className="ss-track-row clip-track-row">
          <div
            className="amber-clip-block"
            style={{
              left: pct(config.trimStart),
              width: `${duration > 0 ? ((config.trimEnd || duration) - config.trimStart) / duration * 100 : 100}%`,
            }}
          >
            <div className="clip-tag-content">
              <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
                <rect x="4" y="4" width="16" height="16" rx="2" />
              </svg>
              <span>Clip</span>
              <span className="clip-info">{Math.round(duration)}s • 1x</span>
            </div>
          </div>

          {/* Cut Line Markers */}
          {config.cuts.map((cutTime, i) => (
            <div key={i} className="cut-marker-line" style={{ left: pct(cutTime) }}>
              <div className="cut-marker-head" />
            </div>
          ))}
        </div>

        {/* Zoom Track (Purple Bar) */}
        <div className="ss-track-row zoom-track-row">
          <div
            className="purple-zoom-block"
            style={{
              left: pct(config.trimStart),
              width: `${duration > 0 ? ((config.trimEnd || duration) - config.trimStart) / duration * 100 : 100}%`,
            }}
          >
            <div className="zoom-tag-content">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <span>Zoom</span>
              <span className="zoom-info">🔍 {config.zoomLevel || 2.0}x • {config.zoomMode === "auto" ? "Auto" : "Manual"} ({keyframes.length} KFs)</span>
            </div>
          </div>
        </div>

        {/* Trim Handles */}
        <div
          className={`ss-trim-handle in-handle ${dragging === "trim-start" ? "dragging" : ""}`}
          style={{ left: pct(config.trimStart) }}
          onMouseDown={handleMouseDown("trim-start")}
        />
        <div
          className={`ss-trim-handle out-handle ${dragging === "trim-end" ? "dragging" : ""}`}
          style={{ left: pct(config.trimEnd || duration) }}
          onMouseDown={handleMouseDown("trim-end")}
        />

        {/* Playhead Needle */}
        <div
          className={`ss-playhead-needle ${dragging === "playhead" ? "dragging" : ""}`}
          style={{ left: pct(currentTime) }}
          onMouseDown={handleMouseDown("playhead")}
        >
          <div className="playhead-purple-cap" />
          <div className="playhead-line" />
        </div>
      </div>
    </div>
  );
}

function formatTimecode(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00.00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 100);
  return `${m}:${sec.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}
