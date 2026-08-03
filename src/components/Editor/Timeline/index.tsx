import { useRef, useCallback, useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Keyframe, EditorConfig } from "../../../lib/types";
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
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<"playhead" | "trim-start" | "trim-end" | null>(null);
  const [hasAudio, setHasAudio] = useState(false);

  // Check for audio sidecar files
  useEffect(() => {
    (async () => {
      try {
        const dir = videoPath.substring(0, videoPath.lastIndexOf("\\"));
        const baseName = videoPath.split("\\").pop()?.replace(/\.[^.]+$/, "") ?? "";
        const audioDir = `${dir}\\${baseName}`;
        const files = await invoke<Array<{ name: string; path: string; is_dir: boolean; size: number }>>("list_directory", { path: dir });
        // Check in subdirectory first, then in parent
        let hasSys = files.some((f) => f.path === `${audioDir}\\system_audio.wav` && f.size > 0);
        let hasMic = files.some((f) => f.path === `${audioDir}\\mic_audio.wav` && f.size > 0);
        if (!hasSys && !hasMic) {
          try {
            const audioFiles = await invoke<Array<{ name: string; path: string; is_dir: boolean; size: number }>>("list_directory", { path: audioDir });
            hasSys = audioFiles.some((f) => f.name === "system_audio.wav" && f.size > 0);
            hasMic = audioFiles.some((f) => f.name === "mic_audio.wav" && f.size > 0);
          } catch { /* subdirectory may not exist */ }
        }
        setHasAudio(hasSys || hasMic);
      } catch { setHasAudio(false); }
    })();
  }, [videoPath]);

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

  return (
    <div className="timeline-container">
      {/* Time display */}
      <div className="timeline-left">
        <span className="timeline-time-current">{formatTime(currentTime)}</span>
        <span className="timeline-time-sep">/</span>
        <span className="timeline-time-total">{formatTime(duration)}</span>
      </div>

      {/* Track area */}
      <div className="timeline-track-area">
        {/* Time ruler */}
        <div className="timeline-ruler">
          {generateTickMarks(duration).map((tick, i) => (
            <div
              key={i}
              className={`ruler-tick ${tick.major ? "major" : ""}`}
              style={{ left: pct(tick.time) }}
            >
              {tick.major && <span className="ruler-label">{tick.label}</span>}
            </div>
          ))}
        </div>

        {/* Trim start handle */}
        <div
          className={`trim-handle trim-start ${dragging === "trim-start" ? "dragging" : ""}`}
          style={{ left: pct(config.trimStart) }}
          onMouseDown={handleMouseDown("trim-start")}
        >
          <div className="trim-grip" />
        </div>

        {/* Track */}
        <div
          className="timeline-track"
          ref={trackRef}
          onClick={(e) => {
            if (dragging) return;
            const t = getTimeFromEvent(e);
            onSeek(t);
          }}
        >
          {/* Trimmed region highlight */}
          <div
            className="trim-region"
            style={{
              left: pct(config.trimStart),
              width: `${duration > 0 ? ((config.trimEnd || duration) - config.trimStart) / duration * 100 : 100}%`,
            }}
          />

          {/* Zoom layer */}
          {config.zoomEnabled && keyframes.length > 0 && (
            <div className="zoom-layer">
              {keyframes.map((kf, i) => {
                const next = keyframes[i + 1];
                const isZoom = kf.scale > 1.02;
                const endPct = next ? (next.time / 1000) : duration;
                const durPct = `${(endPct - kf.time / 1000) / duration * 100}%`;
                return (
                  <div
                    key={i}
                    className={`zoom-segment ${isZoom ? "active" : ""}`}
                    style={{
                      left: pct(kf.time / 1000),
                      width: durPct,
                    }}
                  />
                );
              })}
              {keyframes
                .filter((kf) => kf.scale > 1.02)
                .map((kf, i) => (
                  <div
                    key={`dot-${i}`}
                    className="keyframe-dot zoom-dot"
                    style={{ left: pct(kf.time / 1000) }}
                    title={`${(kf.time / 1000).toFixed(1)}s — ${Math.round(kf.scale * 100)}%`}
                  />
                ))}
            </div>
          )}

          {/* Playhead */}
          <div
            className={`timeline-playhead ${dragging === "playhead" ? "dragging" : ""}`}
            style={{ left: pct(currentTime) }}
            onMouseDown={handleMouseDown("playhead")}
          />
        </div>

        {/* Audio layer */}
        <div className={`audio-track ${hasAudio ? "has-audio" : ""}`}>
          {hasAudio ? (
            <>
              <div className="audio-wave-label">Audio</div>
              <div className="audio-wave-bars">
                {Array.from({ length: 20 }).map((_, i) => (
                  <div key={i} className="audio-bar" style={{ height: `${6 + Math.sin(i * 1.7) * 5 + Math.random() * 3}px` }} />
                ))}
              </div>
            </>
          ) : (
            <div className="audio-wave-label no-audio">No audio track</div>
          )}
        </div>

        {/* Trim end handle */}
        <div
          className={`trim-handle trim-end ${dragging === "trim-end" ? "dragging" : ""}`}
          style={{ left: pct(config.trimEnd || duration) }}
          onMouseDown={handleMouseDown("trim-end")}
        >
          <div className="trim-grip" />
        </div>
      </div>

      {/* Info */}
      <div className="timeline-right">
        {keyframes.length > 0 && (
          <span className="timeline-badge">
            {keyframes.length} KF
          </span>
        )}
        {config.trimStart > 0 && (
          <span className="timeline-badge trim-badge">
            Trim: {formatTime(config.trimStart)}
          </span>
        )}
      </div>
    </div>
  );
}

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function generateTickMarks(duration: number): { time: number; major: boolean; label?: string }[] {
  const ticks: { time: number; major: boolean; label?: string }[] = [];
  if (duration <= 0) return ticks;

  let interval: number;
  if (duration <= 30) interval = 5;
  else if (duration <= 120) interval = 10;
  else if (duration <= 600) interval = 30;
  else interval = 60;

  for (let t = 0; t <= duration; t += interval) {
    ticks.push({ time: t, major: true, label: formatTime(t) });
    if (interval >= 10) {
      for (let sub = t + interval / 2; sub < t + interval && sub < duration; sub += interval / 2) {
        ticks.push({ time: sub, major: false });
      }
    }
  }
  return ticks;
}
