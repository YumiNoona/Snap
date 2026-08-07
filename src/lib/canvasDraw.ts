import { convertFileSrc } from "@tauri-apps/api/core";
import type { CursorStyle } from "./types";

export function assetSrc(path: string): string {
  // Web-root-relative paths (/Wallpapers/.., /Cursors/..) are served by Vite /
  // the bundled frontend — no asset protocol needed. Absolute filesystem paths
  // (e.g. recorded video) go through the Tauri asset protocol.
  return path.startsWith("/") ? path : convertFileSrc(path);
}

export function loadCachedImage(path: string, cache: Map<string, HTMLImageElement>): HTMLImageElement {
  const cached = cache.get(path);
  if (cached) return cached;
  // Evict oldest entries if cache grows too large
  if (cache.size > 20) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = assetSrc(path);
  cache.set(path, img);
  return img;
}

export function paintGradient(
  ctx: CanvasRenderingContext2D,
  preset: { type: "linear" | "radial"; angle: number; colors: { color: string; offset: number }[] },
  w: number,
  h: number
) {
  if (preset.type === "radial") {
    const radius = Math.max(w, h) / 2;
    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, radius);
    preset.colors.forEach((c) => grad.addColorStop(Math.min(1, Math.max(0, c.offset / 100)), c.color));
    ctx.fillStyle = grad;
  } else {
    const rad = (preset.angle * Math.PI) / 180;
    const len = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
    const dx = (Math.cos(rad) * len) / 2;
    const dy = (Math.sin(rad) * len) / 2;
    const grad = ctx.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy);
    preset.colors.forEach((c) => grad.addColorStop(Math.min(1, Math.max(0, c.offset / 100)), c.color));
    ctx.fillStyle = grad;
  }
  ctx.fillRect(0, 0, w, h);
}

export function paintImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number
) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (iw === 0 || ih === 0) return;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

export function drawCursor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  style: CursorStyle
) {
  const r = style.size;
  ctx.save();
  if (style.shape === "circle") {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = style.color;
    ctx.globalAlpha = 0.35;
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = style.color;
    ctx.fill();
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
  } else {
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

export function roundRect(
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

export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * "Cover" fit a source rect into a destination box, centered — crops
 * instead of stretching when the two aspect ratios differ.
 */
export function computeCoverRect(
  effX: number, effY: number, effW: number, effH: number,
  destW: number, destH: number
): { x: number; y: number; w: number; h: number } {
  if (effW <= 0.5 || effH <= 0.5 || destW <= 0.5 || destH <= 0.5) {
    return { x: effX, y: effY, w: effW, h: effH };
  }
  const destAr = destW / destH;
  const srcAr = effW / effH;
  let x = effX, y = effY, w = effW, h = effH;
  if (srcAr > destAr) {
    w = effH * destAr;
    x = effX + (effW - w) / 2;
  } else if (srcAr < destAr) {
    h = effW / destAr;
    y = effY + (effH - h) / 2;
  }
  return { x, y, w, h };
}

/** One step of exponential-decay smoothing toward a target position. */
export function smoothTowards(
  prev: { x: number; y: number; ts: number } | null,
  target: { x: number; y: number },
  ts: number,
  durationMs: number
): { x: number; y: number; ts: number } {
  if (!prev || Math.abs(ts - prev.ts) > 300) {
    // First sample or a seek/jump — snap instead of easing from stale data.
    return { x: target.x, y: target.y, ts };
  }
  const dt = Math.max(0, ts - prev.ts);
  const factor = 1 - Math.exp(-dt / Math.max(1, durationMs));
  return {
    x: prev.x + (target.x - prev.x) * factor,
    y: prev.y + (target.y - prev.y) * factor,
    ts,
  };
}

/**
 * Resolve the current pan/zoom target from keyframes at time `ts` (ms).
 * Mirrors the Preview's zoom-interpolation exactly, including Fixed Zoom
 * Part (lock the pan target to one fixed point instead of tracking every
 * keyframe's click position — only scale still animates).
 */
export function resolveZoom(
  keyframes: { time: number; duration: number; x: number; y: number; scale: number }[],
  ts: number,
  zoomEnabled: boolean,
  fixedZoomPart: boolean
): { x: number; y: number; scale: number } {
  if (!zoomEnabled || keyframes.length === 0) {
    return { x: 0.5, y: 0.5, scale: 1.0 };
  }
  let idx = 0;
  for (let i = keyframes.length - 1; i >= 0; i--) {
    if (keyframes[i].time <= ts) { idx = i; break; }
  }
  const kf = keyframes[idx];
  const next = idx + 1 < keyframes.length ? keyframes[idx + 1] : null;

  let x: number, y: number, scale: number;
  if (next && next.time > kf.time) {
    const segEnd = next.time;
    const transStart = segEnd - Math.max(0, next.duration || 0);
    const from = Math.max(kf.time, transStart);
    const span = Math.max(1, segEnd - from);
    const eased = ts < from ? 0 : easeInOut(Math.min(1, Math.max(0, (ts - from) / span)));
    x = kf.x + (next.x - kf.x) * eased;
    y = kf.y + (next.y - kf.y) * eased;
    scale = kf.scale + (next.scale - kf.scale) * eased;
  } else {
    x = kf.x;
    y = kf.y;
    scale = kf.scale;
  }

  if (fixedZoomPart) {
    const target = keyframes.find((k) => k.scale > 1.02) ?? keyframes[0];
    x = target.x;
    y = target.y;
  }

  return { x, y, scale };
}
