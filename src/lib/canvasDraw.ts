import { convertFileSrc } from "@tauri-apps/api/core";
import type { ClickEffect, CursorStyle, MaskLayer, MotionBlurConfig, ShapeLayer, TextLayer } from "./types";

export function assetSrc(path: string): string {
  // Web-root-relative paths (/Wallpapers/.., /Cursors/..) are served by Vite /
  // the bundled frontend — no asset protocol needed. Absolute filesystem paths
  // (e.g. recorded video) go through the Tauri asset protocol.
  return path.startsWith("/") ? path : convertFileSrc(path);
}

const sharedImageCache = new Map<string, HTMLImageElement>();

export function preloadImageAsset(path: string): HTMLImageElement {
  const src = assetSrc(path);
  const cached = sharedImageCache.get(src);
  if (cached) return cached;

  if (sharedImageCache.size > 48) {
    const first = sharedImageCache.keys().next().value;
    if (first) sharedImageCache.delete(first);
  }

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.src = src;
  sharedImageCache.set(src, img);
  return img;
}

export function loadCachedImage(path: string, cache: Map<string, HTMLImageElement>): HTMLImageElement {
  const cached = cache.get(path);
  if (cached) return cached;
  // Evict oldest entries if cache grows too large
  if (cache.size > 20) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  const img = preloadImageAsset(path);
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
    const s = Math.max(6, r);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, s * 1.55);
    ctx.lineTo(s * 0.38, s * 1.18);
    ctx.lineTo(s * 0.72, s * 1.92);
    ctx.lineTo(s * 1.08, s * 1.74);
    ctx.lineTo(s * 0.73, s * 1.02);
    ctx.lineTo(s * 1.25, s * 0.98);
    ctx.closePath();
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.9)";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1.25, s * 0.09);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawCursorImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  size: number,
  hotspot: { x: number; y: number },
  alpha = 1
) {
  if (!img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) return;
  const scale = Math.max(0.1, size / 32);
  const drawW = img.naturalWidth * scale;
  const drawH = img.naturalHeight * scale;
  const hx = Math.min(100, Math.max(0, hotspot.x)) / 100;
  const hy = Math.min(100, Math.max(0, hotspot.y)) / 100;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.drawImage(img, x - hx * drawW, y - hy * drawH, drawW, drawH);
  ctx.restore();
}

function seeded(seed: number, index: number): number {
  const x = Math.sin(seed * 0.013 + index * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function clickEffectDuration(effect: ClickEffect): number {
  if (effect === "spotlight") return 1.25;
  if (effect === "firework" || effect === "christmas") return 1.1;
  return 0.85;
}

/** Draw one deterministic click animation. `age` is in seconds. */
export function drawClickEffect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  age: number,
  color: string,
  effect: ClickEffect,
  seed = 0
) {
  const duration = clickEffectDuration(effect);
  if (effect === "none" || age < 0 || age > duration) return;
  const t = Math.min(1, age / duration);
  const fade = 1 - t;
  ctx.save();
  ctx.translate(x, y);

  if (effect === "default") {
    ctx.globalAlpha = fade;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, 7 + t * 3, 0, Math.PI * 2);
    ctx.fill();
  } else if (effect === "ripple") {
    ctx.globalAlpha = fade;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 4 + t * 40, 0, Math.PI * 2);
    ctx.stroke();
  } else if (effect === "ring") {
    ctx.globalAlpha = Math.sin(Math.PI * t) * 0.95;
    ctx.strokeStyle = color;
    ctx.lineWidth = 4 - t * 2;
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.stroke();
  } else if (effect === "diffusion" || effect === "spotlight") {
    const radius = effect === "spotlight" ? 62 + t * 18 : 12 + t * 50;
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    grad.addColorStop(0, effect === "spotlight" ? "rgba(255,255,255,0.5)" : color);
    grad.addColorStop(0.35, effect === "spotlight" ? "rgba(255,255,255,0.18)" : `${color}55`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalAlpha = fade * (effect === "spotlight" ? 0.8 : 0.65);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
  } else if (effect === "sparkle") {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.globalAlpha = fade;
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI * 2 * i) / 6;
      const inner = 7 + t * 13;
      const outer = inner + 7 * fade;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
      ctx.stroke();
    }
  } else {
    const count = effect === "christmas" ? 12 : 10;
    const colors = effect === "christmas" ? ["#ef4444", "#22c55e", "#fbbf24"] : [color];
    for (let i = 0; i < count; i++) {
      const a = seeded(seed, i) * Math.PI * 2;
      const speed = 22 + seeded(seed + 11, i) * 35;
      const px = Math.cos(a) * speed * t;
      const py = Math.sin(a) * speed * t + 32 * t * t;
      ctx.globalAlpha = fade;
      ctx.fillStyle = colors[i % colors.length];
      ctx.beginPath();
      ctx.arc(px, py, 2 + seeded(seed + 23, i) * 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

export function cursorIdleOpacity(
  moves: { ts: number }[],
  timestampMs: number,
  enabled: boolean
): number {
  if (!enabled || moves.length === 0) return 1;
  let lo = 0, hi = moves.length - 1, idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (moves[mid].ts <= timestampMs) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (idx < 0) return 0;
  const idleMs = timestampMs - moves[idx].ts;
  if (idleMs <= 1200) return 1;
  return Math.max(0, 1 - (idleMs - 1200) / 200);
}

export function drawTextLayer(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  x: number,
  y: number,
  w: number,
  h: number
) {
  ctx.save();
  const fontSize = Math.max(8, layer.fontSize);
  const family = layer.fontFamily === "serif"
    ? "Georgia, serif"
    : layer.fontFamily === "mono" ? "ui-monospace, Consolas, monospace" : "system-ui, sans-serif";
  ctx.font = `${layer.fontWeight ?? 600} ${fontSize}px ${family}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = layer.align ?? "center";
  const cx = x + w / 2, cy = y + h / 2;
  const measured = Math.min(w, ctx.measureText(layer.content).width + fontSize);
  const boxW = Math.max(fontSize * 1.5, measured);
  const boxH = Math.min(h, fontSize * 1.75);
  if (layer.style !== "plain") {
    ctx.fillStyle = layer.backgroundColor ?? (layer.style === "boxed" ? "rgba(15,23,42,0.82)" : layer.color);
    ctx.beginPath();
    if (layer.style === "badge") {
      ctx.arc(cx, cy, Math.min(boxH, boxW) / 2, 0, Math.PI * 2);
    } else {
      roundRect(ctx, cx - boxW / 2, cy - boxH / 2, boxW, boxH, layer.style === "pill" ? boxH / 2 : 8);
    }
    ctx.fill();
  }
  ctx.fillStyle = layer.style === "plain" || layer.style === "boxed" ? layer.color : "#ffffff";
  const textX = layer.align === "left" ? x + 12 : layer.align === "right" ? x + w - 12 : cx;
  ctx.fillText(layer.content, textX, cy, Math.max(1, w - 16));
  ctx.restore();
}

export function drawShapeLayer(
  ctx: CanvasRenderingContext2D,
  layer: ShapeLayer,
  x: number,
  y: number,
  w: number,
  h: number
) {
  const sw = Math.max(1, layer.strokeWidth);
  ctx.save();
  ctx.strokeStyle = layer.color;
  ctx.fillStyle = layer.fillColor ?? layer.color;
  ctx.lineWidth = sw;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const inset = Math.max(sw * 1.5, Math.min(w, h) * 0.045);
  x += inset; y += inset; w = Math.max(1, w - inset * 2); h = Math.max(1, h - inset * 2);
  const cx = x + w / 2, cy = y + h / 2;
  const fillOpacity = Math.max(0, Math.min(1, layer.fillOpacity ?? (layer.shape === "blob" || layer.shape === "downArrow" || layer.shape === "pointer" ? 0.86 : 0)));
  const strokeOpacity = Math.max(0, Math.min(1, layer.strokeOpacity ?? 1));
  if (layer.shape === "line" || layer.shape === "dashedLine" || layer.shape === "arrow") {
    if (layer.shape === "dashedLine") ctx.setLineDash([sw * 3, sw * 2]);
    ctx.globalAlpha = strokeOpacity;
    ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x + w, cy); ctx.stroke();
    if (layer.shape === "arrow") {
      const ah = Math.min(22, Math.max(8, h * 0.25));
      ctx.globalAlpha = Math.max(fillOpacity, strokeOpacity);
      ctx.beginPath(); ctx.moveTo(x + w, cy); ctx.lineTo(x + w - ah, cy - ah * 0.62); ctx.lineTo(x + w - ah * 0.72, cy); ctx.lineTo(x + w - ah, cy + ah * 0.62); ctx.closePath(); ctx.fill();
    }
  } else if (layer.shape === "rectangle" || layer.shape === "roundedRect") {
    const radius = layer.shape === "roundedRect" ? Math.min(layer.cornerRadius ?? 18, h / 2, w / 2) : 0;
    ctx.beginPath(); roundRect(ctx, x, y, w, h, radius);
    if (fillOpacity > 0) { ctx.globalAlpha = fillOpacity; ctx.fill(); }
    ctx.globalAlpha = strokeOpacity; ctx.stroke();
  } else if (layer.shape === "circle") {
    ctx.beginPath(); ctx.ellipse(cx, cy, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
    if (fillOpacity > 0) { ctx.globalAlpha = fillOpacity; ctx.fill(); }
    ctx.globalAlpha = strokeOpacity; ctx.stroke();
  } else if (layer.shape === "blob") {
    ctx.globalAlpha = fillOpacity;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.12, cy); ctx.bezierCurveTo(x, y, x + w * 0.62, y - h * 0.08, x + w * 0.9, y + h * 0.25);
    ctx.bezierCurveTo(x + w * 1.08, y + h * 0.72, x + w * 0.55, y + h * 1.08, x + w * 0.2, y + h * 0.86);
    ctx.bezierCurveTo(x - w * 0.05, y + h * 0.72, x, y + h * 0.35, x + w * 0.12, cy); ctx.fill();
  } else if (layer.shape === "downArrow") {
    ctx.globalAlpha = fillOpacity;
    ctx.beginPath(); ctx.moveTo(cx - w * 0.13, y); ctx.quadraticCurveTo(cx - w * 0.16, y, cx - w * 0.16, y + h * 0.56); ctx.lineTo(x + w * 0.2, y + h * 0.56); ctx.lineTo(cx, y + h); ctx.lineTo(x + w * 0.8, y + h * 0.56); ctx.lineTo(cx + w * 0.16, y + h * 0.56); ctx.lineTo(cx + w * 0.16, y); ctx.closePath(); ctx.fill();
  } else {
    // Clean cursor-pointer silhouette with a compact stem instead of the old
    // jagged polygon that distorted badly at non-square sizes.
    ctx.globalAlpha = fillOpacity;
    ctx.translate(x + w * 0.12, y + h * 0.08);
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(w * 0.62, h * 0.48); ctx.lineTo(w * 0.38, h * 0.54);
    ctx.lineTo(w * 0.55, h * 0.86); ctx.lineTo(w * 0.37, h * 0.96);
    ctx.lineTo(w * 0.2, h * 0.62); ctx.lineTo(0, h * 0.8); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = strokeOpacity; ctx.stroke();
  }
  ctx.restore();
}

export function drawMaskLayer(
  ctx: CanvasRenderingContext2D,
  layer: MaskLayer,
  video: CanvasImageSource,
  source: { x: number; y: number; w: number; h: number },
  dest: { x: number; y: number; w: number; h: number },
  rect: { x: number; y: number; w: number; h: number }
) {
  const { x, y, w, h } = rect;
  ctx.save();
  ctx.globalAlpha = Math.max(0.05, Math.min(1, layer.opacity ?? 1));
  if (layer.mask === "blur") {
    ctx.beginPath(); roundRect(ctx, x, y, w, h, Math.min(layer.feather ?? 8, w / 2, h / 2)); ctx.clip();
    ctx.filter = `blur(${Math.max(1, layer.intensity)}px)`;
    ctx.drawImage(video, source.x, source.y, source.w, source.h, dest.x, dest.y, dest.w, dest.h);
    ctx.filter = "none";
    ctx.fillStyle = "rgba(0,0,0,0.12)"; ctx.fillRect(x, y, w, h);
  } else if (layer.mask === "spotlight") {
    ctx.fillStyle = `rgba(0,0,0,${Math.min(0.85, 0.3 + layer.intensity * 0.2)})`;
    ctx.beginPath(); ctx.rect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill("evenodd");
  } else {
    const zoom = Math.max(1.1, layer.intensity);
    const sx = source.x + ((x - dest.x) / dest.w) * source.w;
    const sy = source.y + ((y - dest.y) / dest.h) * source.h;
    const sw = (w / dest.w) * source.w / zoom;
    const sh = (h / dest.h) * source.h / zoom;
    ctx.shadowColor = "rgba(96,165,250,.38)";
    ctx.shadowBlur = layer.feather ?? 8;
    ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(video, sx + ((w / dest.w) * source.w - sw) / 2, sy + ((h / dest.h) * source.h - sh) / 2, sw, sh, x, y, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 3; ctx.stroke();
  }
  ctx.restore();
}

export function drawVideoWithMotionBlur(
  ctx: CanvasRenderingContext2D,
  video: CanvasImageSource,
  source: { x: number; y: number; w: number; h: number },
  dest: { x: number; y: number; w: number; h: number },
  motion: MotionBlurConfig,
  delta: { x: number; y: number; scale: number } | null
) {
  if (motion.enabled && delta) {
    const panStrength = Math.min(18, Math.hypot(delta.x, delta.y) * motion.panAmount * 0.05);
    const zoomStrength = Math.min(0.025, Math.abs(delta.scale) * motion.zoomAmount * 0.002);
    for (let i = 3; i >= 1; i--) {
      const f = i / 3;
      const dx = delta.x === 0 && delta.y === 0 ? 0 : (-delta.x / Math.max(1, Math.hypot(delta.x, delta.y))) * panStrength * f;
      const dy = delta.x === 0 && delta.y === 0 ? 0 : (-delta.y / Math.max(1, Math.hypot(delta.x, delta.y))) * panStrength * f;
      const grow = zoomStrength * f;
      ctx.save(); ctx.globalAlpha = 0.1;
      ctx.drawImage(video, source.x, source.y, source.w, source.h, dest.x + dx - dest.w * grow / 2, dest.y + dy - dest.h * grow / 2, dest.w * (1 + grow), dest.h * (1 + grow));
      ctx.restore();
    }
  }
  ctx.drawImage(video, source.x, source.y, source.w, source.h, dest.x, dest.y, dest.w, dest.h);
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
  // Treat duration as the time to substantially settle, not a trailing time
  // constant. The old formula stayed visibly behind the source cursor.
  const factor = 1 - Math.exp(-dt / Math.max(1, durationMs / 6));
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
