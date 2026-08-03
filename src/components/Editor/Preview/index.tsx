import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { InputEvent, Keyframe, EditorConfig, CursorStyle } from "../../../lib/types";
import { generateKeyframes } from "../../../lib/autoZoom";
import "./Preview.css";

interface Props {
  videoPath: string;
  inputLogPath: string;
  config: EditorConfig;
  keyframes: Keyframe[];
  onKeyframesChange: (kf: Keyframe[]) => void;
  playing: boolean;
  onTimeUpdate: (t: number) => void;
  onDuration: (d: number) => void;
  onClick?: () => void;
}

export default function Preview({
  videoPath,
  inputLogPath,
  config,
  keyframes,
  onKeyframesChange,
  playing,
  onTimeUpdate,
  onDuration,
  onClick,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loadError, setLoadError] = useState("");
  const [videoReady, setVideoReady] = useState(false);
  const rafRef = useRef<number>(0);
  const mouseMoveEvents = useRef<InputEvent[]>([]);
  const allEvents = useRef<InputEvent[]>([]);
  const clickRipples = useRef<{ x: number; y: number; t: number; ts: number }[]>([]);
  const prevTimeRef = useRef(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 1280, h: 720 });
  const [eventsReady, setEventsReady] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(1.0);
  const videoMetaRef = useRef<{ w: number; h: number; d: number } | null>(null);
  const kfGenerated = useRef(false);

  // Reset event state when input log path changes
  useEffect(() => {
    setEventsReady(false);
    kfGenerated.current = false;
    mouseMoveEvents.current = [];
    allEvents.current = [];
  }, [inputLogPath]);

  // ── Load input log ──────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const text = await invoke<string>("read_text_file", { path: inputLogPath });
        const parsed: InputEvent[] = text
          .split("\n")
          .filter((l) => l.trim())
          .map((l) => JSON.parse(l));
        allEvents.current = parsed;
        mouseMoveEvents.current = parsed
          .filter((e) => e.type === "mousemove" && e.x != null && e.y != null)
          .sort((a, b) => a.ts - b.ts);
        clickRipples.current = [];
        setEventsReady(true);
      } catch (e) {
        setLoadError(`Failed to load: ${e}`);
      }
    })();
  }, [inputLogPath]);

  // ── Generate keyframes when both video + events are ready ──────────────
  useEffect(() => {
    if (!videoReady || !eventsReady || kfGenerated.current) return;
    const meta = videoMetaRef.current;
    if (!meta) return;
    kfGenerated.current = true;
    if (mouseMoveEvents.current.length > 0) {
      const kf = generateKeyframes(
        mouseMoveEvents.current,
        meta.w,
        meta.h,
        meta.d * 1000
      );
      onKeyframesChange(kf);
    }
  }, [videoReady, eventsReady, onKeyframesChange]);

  // ── Video metadata callback ────────────────────────────────────────────
  const onMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    const dur = video.duration;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    videoMetaRef.current = { w: vw, h: vh, d: dur };
    onDuration(dur);
    setVideoReady(true);
    computeCanvasSize(vw, vh);
  };

  const computeCanvasSize = useCallback(
    (vw: number, vh: number) => {
      const container = containerRef.current;
      if (!container) return;
      const maxW = container.clientWidth - 32;
      const maxH = container.clientHeight - 32;

      let outW: number, outH: number;

      if (config.aspectRatio && config.aspectRatio.width > 0) {
        const ar = config.aspectRatio.width / config.aspectRatio.height;
        if (maxW / maxH > ar) {
          outH = Math.min(maxH, vh + config.padding * 2);
          outW = outH * ar;
        } else {
          outW = Math.min(maxW, vw + config.padding * 2);
          outH = outW / ar;
        }
      } else {
        const scale = Math.min(maxW / vw, maxH / vh);
        outW = vw * scale;
        outH = vh * scale;
      }

      setCanvasSize({ w: Math.round(outW), h: Math.round(outH) });
    },
    [config.aspectRatio, config.padding]
  );

  useEffect(() => {
    const video = videoRef.current;
    if (video && videoReady) {
      computeCanvasSize(video.videoWidth, video.videoHeight);
    }
  }, [config.aspectRatio, config.padding, videoReady, computeCanvasSize]);

  // ── Interpolated cursor position (smooth, no jumping) ──────────────────
  const getCursorAt = useCallback((timestampMs: number): { x: number; y: number } | null => {
    const moves = mouseMoveEvents.current;
    if (moves.length === 0) return null;

    // Binary search for the last event at or before timestampMs
    let lo = 0, hi = moves.length - 1, idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (moves[mid].ts <= timestampMs) { idx = mid; lo = mid + 1; }
      else { hi = mid - 1; }
    }
    if (idx < 0) return null;

    // If there's a next event, interpolate between them for smooth motion
    const a = moves[idx];
    const b = idx + 1 < moves.length ? moves[idx + 1] : null;
    if (b && b.ts > a.ts) {
      const t = (timestampMs - a.ts) / (b.ts - a.ts);
      return {
        x: a.x! + (b.x! - a.x!) * Math.min(t, 1),
        y: a.y! + (b.y! - a.y!) * Math.min(t, 1),
      };
    }
    return { x: a.x!, y: a.y! };
  }, []);

  // ── Track click ripples ─────────────────────────────────────────────────
  const trackClicks = useCallback((ts: number) => {
    if (!config.cursorStyle.showClickRipples) return;
    const events = allEvents.current;
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type !== "mousedown") continue;
      if (e.ts > ts || e.ts < ts - 16) break;
      const ripple = clickRipples.current;
      const exists = ripple.find((r) => Math.abs(r.ts - e.ts) < 5);
      if (!exists && e.x != null && e.y != null) {
        ripple.push({ x: e.x, y: e.y, t: performance.now(), ts: e.ts });
        if (ripple.length > 10) ripple.shift();
      }
    }
  }, [config.cursorStyle.showClickRipples]);

  // ── Render ──────────────────────────────────────────────────────────────
  const render = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || canvasSize.w === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const ts = video.currentTime * 1000;
    const dur = video.duration * 1000;
    const { w: cw, h: ch } = canvasSize;
    const pad = config.padding;
    const br = config.borderRadius;
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    // Compute video area within padded canvas
    let videoW: number, videoH: number, offsetX: number, offsetY: number;
    if (config.aspectRatio && config.aspectRatio.width > 0) {
      const ar = config.aspectRatio.width / config.aspectRatio.height;
      const innerW = cw - pad * 2;
      const innerH = ch - pad * 2;
      if (innerW / innerH > ar) {
        videoH = innerH;
        videoW = videoH * ar;
      } else {
        videoW = innerW;
        videoH = videoW / ar;
      }
      offsetX = pad + (innerW - videoW) / 2;
      offsetY = pad + (innerH - videoH) / 2;
    } else {
      videoW = cw - pad * 2;
      videoH = ch - pad * 2;
      offsetX = pad;
      offsetY = pad;
    }

    // ── Interpolate zoom ──────────────────────────────────────────────────
    let zoomX = 0.5, zoomY = 0.5, zoomScale = 1.0;
    if (config.zoomEnabled && keyframes.length > 0) {
      let idx = 0;
      for (let i = keyframes.length - 1; i >= 0; i--) {
        if (keyframes[i].time <= ts) { idx = i; break; }
      }
      const kf = keyframes[idx];
      const next = idx + 1 < keyframes.length ? keyframes[idx + 1] : null;
      const startTime = kf.time;
      const endTime = next ? next.time : dur;
      const elapsed = ts - startTime;
      const total = endTime - startTime;
      let t = total > 0 ? Math.max(0, Math.min(1, elapsed / total)) : 1;
      t = easeInOut(t);
      zoomX = kf.x + ((next?.x ?? kf.x) - kf.x) * t;
      zoomY = kf.y + ((next?.y ?? kf.y) - kf.y) * t;
      zoomScale = kf.scale + ((next?.scale ?? kf.scale) - kf.scale) * t;
      const z = Math.round(zoomScale * 100) / 100;
      if (Math.abs(currentZoom - z) > 0.01) setCurrentZoom(z);
    }

    // ── Draw ──────────────────────────────────────────────────────────────
    ctx.clearRect(0, 0, cw, ch);
    canvas.width = cw;
    canvas.height = ch;

    // Background
    ctx.fillStyle = config.backgroundColor;
    ctx.beginPath();
    roundRect(ctx, 0, 0, cw, ch, br);
    ctx.fill();

    // Shadow
    if (config.shadow.enabled) {
      ctx.save();
      ctx.shadowColor = config.shadow.color;
      ctx.shadowBlur = config.shadow.blur;
      ctx.shadowOffsetX = config.shadow.offsetX;
      ctx.shadowOffsetY = config.shadow.offsetY;
      ctx.fillStyle = config.backgroundColor;
      ctx.beginPath();
      roundRect(ctx, 0, 0, cw, ch, br);
      ctx.fill();
      ctx.restore();
    }

    // Clip for video area
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, offsetX, offsetY, videoW, videoH, Math.max(0, br - pad));
    ctx.clip();

    // Video with zoom
    const srcX = vw * zoomX - (vw / zoomScale) / 2;
    const srcY = vh * zoomY - (vh / zoomScale) / 2;
    const srcW = vw / zoomScale;
    const srcH = vh / zoomScale;
    ctx.drawImage(
      video,
      Math.max(0, srcX), Math.max(0, srcY),
      Math.min(vw, srcW), Math.min(vh, srcH),
      offsetX, offsetY, videoW, videoH
    );

    // Cursor overlay
    if (config.showCursor) {
      const cursor = getCursorAt(ts);
      if (cursor) {
        const csx = videoW / vw;
        const csy = videoH / vh;
        let cx = cursor.x * csx + offsetX;
        let cy = cursor.y * csy + offsetY;
        drawCursor(ctx, cx, cy, config.cursorStyle);
      }
    }

    // Click ripples
    const now = performance.now();
    clickRipples.current = clickRipples.current.filter((r) => {
      const age = (now - r.t) / 1000;
      if (age > 1.0) return false;
      const csx = videoW / vw;
      const csy = videoH / vh;
      const rx = r.x * csx + offsetX;
      const ry = r.y * csy + offsetY;
      const alpha = 1 - age;
      const radius = age * 40 + 4;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = config.cursorStyle.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(rx, ry, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      return true;
    });

    ctx.restore();

    // Track clicks
    if (playing) {
      trackClicks(ts);
    }

    onTimeUpdate(video.currentTime);
    prevTimeRef.current = ts;
  }, [
    canvasSize, config, keyframes, playing,
    getCursorAt, onTimeUpdate, trackClicks,
  ]);

  // ── Render loop ─────────────────────────────────────────────────────────
  useEffect(() => {
    const loop = () => {
      render();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [render]);

  // ── Handle window resize ────────────────────────────────────────────────
  useEffect(() => {
    const onResize = () => {
      const video = videoRef.current;
      if (video && videoReady) computeCanvasSize(video.videoWidth, video.videoHeight);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [videoReady, computeCanvasSize]);

  const togglePlay = () => onClick?.();

  const videoUrl = convertFileSrc(videoPath);

  return (
    <div className="preview-container" ref={containerRef}>
      {loadError && <p className="preview-error">{loadError}</p>}
      <canvas
        ref={canvasRef}
        width={canvasSize.w}
        height={canvasSize.h}
        className="preview-canvas"
      />
      <div className="preview-controls" onClick={togglePlay}>
        <div className={`play-overlay ${playing ? "hidden" : ""}`}>
          <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </div>
      {config.zoomEnabled && keyframes.length > 0 && currentZoom > 1.02 && (
        <div className="zoom-badge">{Math.round(currentZoom * 100)}%</div>
      )}
      <video
        ref={videoRef}
        src={videoUrl}
        style={{ display: "none" }}
        onLoadedMetadata={onMetadata}
        crossOrigin="anonymous"
      />
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function drawCursor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  style: CursorStyle
) {
  const r = style.size;
  ctx.save();

  if (style.shape === "circle") {
    // Outer ring
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = style.color;
    ctx.globalAlpha = 0.35;
    ctx.fill();
    // Solid center
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = style.color;
    ctx.fill();
    // White stroke
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
  } else {
    // Arrow cursor
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-r * 1.4, -r);
    ctx.lineTo(-r * 1.2, -r * 0.3);
    ctx.lineTo(-r * 1.8, -r * 0.2);
    ctx.lineTo(-r * 1.6, -r * 0.7);
    ctx.lineTo(-r * 2.2, -r * 0.9);
    ctx.closePath();
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.strokeStyle = style.color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  if (r <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
