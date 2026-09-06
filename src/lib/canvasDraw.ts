import { convertFileSrc } from "@tauri-apps/api/core";
import type { CaptionTrack, ClickEffect, CursorStyle, MaskLayer, MotionBlurConfig, ShapeLayer, TextLayer } from "./types";
import { captionAnimationFrame, captionRenderText, effectiveCaptionEntrance } from "./captionAnimation";

export function drawCaptionTrack(
  ctx: CanvasRenderingContext2D,
  track: CaptionTrack,
  timeMs: number,
  frame: { x: number; y: number; w: number; h: number }
): void {
  if (!track.visible) return;
  const segment = track.segments.find((item) => timeMs >= item.startMs && timeMs < item.endMs);
  if (!segment?.text.trim()) return;
  const style = track.style;
  const requestedAnimation = style.animation ?? "none";
  // A short phrase must still reach its stable/readable state well before it
  // leaves the screen. Otherwise reveal animations make the final words appear
  // missing even though the caption timing itself is correct.
  const segmentDuration = segment.endMs - segment.startMs;
  const { animation, durationMs: entranceDuration } = effectiveCaptionEntrance(
    requestedAnimation,
    segmentDuration,
    style.animationDurationMs ?? 420,
  );
  const entrance = captionAnimationFrame(animation, timeMs - segment.startMs, entranceDuration);
  const { layoutText, visibleText } = captionRenderText(segment.text, animation, entrance.reveal);
  if (!layoutText || !visibleText) return;
  const fontSize = Math.max(12, style.fontSize * frame.w / 1920);
  const maxWidth = Math.max(80, frame.w * style.maxWidth);
  ctx.save();
  ctx.font = `${style.fontStyle ?? "normal"} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${style.letterSpacing ?? 0}px`;
  ctx.textAlign = style.align;
  ctx.textBaseline = "middle";
  const words = layoutText.split(/\s+/u);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) { lines.push(line); line = word; }
    else line = candidate;
  }
  if (line) lines.push(line);
  const lineHeight = fontSize * (style.lineHeight ?? 1.22);
  const paddingScale = style.backgroundPadding ?? .4;
  const paddingX = fontSize * paddingScale;
  const paddingY = fontSize * paddingScale * .6;
  const widest = Math.min(maxWidth, Math.max(...lines.map((value) => ctx.measureText(value).width), 1));
  const centerX = frame.x + frame.w * style.x;
  const centerY = frame.y + frame.h * style.y;

  // Paint the box once at its final geometry. Applying entrance opacity,
  // blur, or partially-revealed text to this translucent background caused
  // it to pulse like a dark tint on WebView2 at every caption boundary.
  ctx.fillStyle = style.backgroundColor;
  // Canvas paths are not part of save()/restore(). Without beginPath(), this
  // fill can also repaint an old full-frame clip or shape with the caption's
  // translucent black background, producing a one-frame video-wide tint.
  ctx.beginPath();
  roundRect(ctx, centerX - widest / 2 - paddingX, centerY - lines.length * lineHeight / 2 - paddingY, widest + paddingX * 2, lines.length * lineHeight + paddingY * 2, fontSize * (style.backgroundRadius ?? .18));
  ctx.fill();

  const textCenterX = centerX + entrance.slide * fontSize * 1.25;
  const textCenterY = centerY + entrance.rise * fontSize * .55;
  ctx.save();
  ctx.globalAlpha *= entrance.alpha;
  if (entrance.scale !== 1) {
    ctx.translate(textCenterX, textCenterY);
    ctx.scale(entrance.scale, entrance.scale);
    ctx.translate(-textCenterX, -textCenterY);
  }

  // Preserve final line positions during a typewriter reveal. This avoids
  // text and its shadow jumping when a second line begins.
  let remainingCharacters = Array.from(visibleText).length;
  lines.forEach((fullLine, index) => {
    const characters = Array.from(fullLine);
    const value = characters.slice(0, Math.max(0, remainingCharacters)).join("");
    remainingCharacters -= characters.length;
    if (remainingCharacters > 0) remainingCharacters -= 1; // wrapped space
    if (!value) return;
    const y = textCenterY + (index - (lines.length - 1) / 2) * lineHeight;
    if (style.shadow) { ctx.shadowColor = "rgba(0,0,0,.7)"; ctx.shadowBlur = fontSize * (style.shadowBlur ?? .18); ctx.shadowOffsetY = fontSize * 0.08; }
    if (style.outlineWidth > 0) { ctx.strokeStyle = style.outlineColor; ctx.lineWidth = style.outlineWidth * 2; ctx.lineJoin = "round"; ctx.strokeText(value, textCenterX, y, maxWidth); }
    ctx.fillStyle = style.color;
    ctx.fillText(value, textCenterX, y, maxWidth);
  });
  ctx.restore();
  ctx.restore();
}

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
    ctx.fillStyle = style.color;
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
  const family = layer.fontFamily === "serif" ? "Georgia, serif" : layer.fontFamily === "mono" ? "ui-monospace, Consolas, monospace" : "system-ui, sans-serif";
  ctx.font = `${layer.fontWeight ?? 600} ${fontSize}px ${family}`;
  ctx.letterSpacing = `${layer.letterSpacing ?? 0}px`;
  const padding = Math.max(0, Math.min(layer.padding ?? 12, w / 4));
  const available = Math.max(1, w - padding * 2);
  const lines: string[] = [];
  for (const paragraph of layer.content.split("\n")) {
    let line = "";
    for (const character of paragraph) {
      if (line && ctx.measureText(line + character).width > available) { lines.push(line); line = character; }
      else line += character;
    }
    lines.push(line);
  }
  const lineHeight = fontSize * (layer.lineHeight ?? 1.3);
  const boxW = Math.min(w, Math.max(fontSize, ...lines.map(line => ctx.measureText(line).width)) + padding * 2);
  const boxH = Math.min(h, lines.length * lineHeight + padding * 2);
  const align = layer.align ?? "center";
  const boxX = align === "left" ? x : align === "right" ? x + w - boxW : x + (w - boxW) / 2;
  const boxY = y + (h - boxH) / 2;
  if (layer.style !== "plain") {
    ctx.fillStyle = layer.backgroundColor ?? "#171717";
    ctx.beginPath();
    roundRect(ctx, boxX, boxY, boxW, boxH, layer.style === "pill" ? boxH / 2 : Math.min(layer.cornerRadius ?? 8, boxH / 2, boxW / 2));
    ctx.fill();
  }
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = layer.color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  const textX = align === "left" ? boxX + padding : align === "right" ? boxX + boxW - padding : boxX + boxW / 2;
  const top = y + (h - lines.length * lineHeight) / 2 + lineHeight / 2;
  lines.forEach((line, index) => ctx.fillText(line, textX, top + index * lineHeight, available));
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
  const baseAlpha = ctx.globalAlpha;
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
    ctx.globalAlpha = baseAlpha * (strokeOpacity);
    ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x + w, cy); ctx.stroke();
    if (layer.shape === "arrow") {
      const ah = Math.min(22, Math.max(8, h * 0.25));
      ctx.globalAlpha = baseAlpha * (Math.max(fillOpacity, strokeOpacity));
      ctx.beginPath(); ctx.moveTo(x + w, cy); ctx.lineTo(x + w - ah, cy - ah * 0.62); ctx.lineTo(x + w - ah * 0.72, cy); ctx.lineTo(x + w - ah, cy + ah * 0.62); ctx.closePath(); ctx.fill();
    }
  } else if (layer.shape === "rectangle" || layer.shape === "roundedRect") {
    const radius = layer.shape === "roundedRect" ? Math.min(layer.cornerRadius ?? 18, h / 2, w / 2) : 0;
    ctx.beginPath(); roundRect(ctx, x, y, w, h, radius);
    if (fillOpacity > 0) { ctx.globalAlpha = baseAlpha * (fillOpacity); ctx.fill(); }
    ctx.globalAlpha = baseAlpha * (strokeOpacity); ctx.stroke();
  } else if (layer.shape === "circle") {
    ctx.beginPath(); ctx.ellipse(cx, cy, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
    if (fillOpacity > 0) { ctx.globalAlpha = baseAlpha * (fillOpacity); ctx.fill(); }
    ctx.globalAlpha = baseAlpha * (strokeOpacity); ctx.stroke();
  } else if (layer.shape === "triangle" || layer.shape === "diamond" || layer.shape === "star") {
    const points = layer.shape === "triangle" ? 3 : layer.shape === "diamond" ? 4 : 10;
    ctx.beginPath();
    for (let i = 0; i < points; i++) {
      const angle = -Math.PI / 2 + i / points * Math.PI * 2;
      const radius = layer.shape === "star" && i % 2 ? .44 : 1;
      const px = cx + Math.cos(angle) * w / 2 * radius;
      const py = cy + Math.sin(angle) * h / 2 * radius;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.globalAlpha = baseAlpha * fillOpacity; ctx.fill();
    ctx.globalAlpha = baseAlpha * strokeOpacity; ctx.stroke();
  } else if (layer.shape === "blob") {
    ctx.globalAlpha = baseAlpha * (fillOpacity);
    ctx.beginPath();
    ctx.moveTo(x + w * 0.12, cy); ctx.bezierCurveTo(x, y, x + w * 0.62, y - h * 0.08, x + w * 0.9, y + h * 0.25);
    ctx.bezierCurveTo(x + w * 1.08, y + h * 0.72, x + w * 0.55, y + h * 1.08, x + w * 0.2, y + h * 0.86);
    ctx.bezierCurveTo(x - w * 0.05, y + h * 0.72, x, y + h * 0.35, x + w * 0.12, cy); ctx.closePath(); ctx.fill(); ctx.globalAlpha = baseAlpha * strokeOpacity; ctx.stroke();
  } else if (layer.shape === "downArrow") {
    ctx.globalAlpha = baseAlpha * (fillOpacity);
    ctx.beginPath(); ctx.moveTo(cx - w * 0.13, y); ctx.quadraticCurveTo(cx - w * 0.16, y, cx - w * 0.16, y + h * 0.56); ctx.lineTo(x + w * 0.2, y + h * 0.56); ctx.lineTo(cx, y + h); ctx.lineTo(x + w * 0.8, y + h * 0.56); ctx.lineTo(cx + w * 0.16, y + h * 0.56); ctx.lineTo(cx + w * 0.16, y); ctx.closePath(); ctx.fill(); ctx.globalAlpha = baseAlpha * strokeOpacity; ctx.stroke();
  } else {
    // Clean cursor-pointer silhouette with a compact stem instead of the old
    // jagged polygon that distorted badly at non-square sizes.
    ctx.globalAlpha = baseAlpha * (fillOpacity);
    ctx.translate(x + w * 0.12, y + h * 0.08);
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(w * 0.62, h * 0.48); ctx.lineTo(w * 0.38, h * 0.54);
    ctx.lineTo(w * 0.55, h * 0.86); ctx.lineTo(w * 0.37, h * 0.96);
    ctx.lineTo(w * 0.2, h * 0.62); ctx.lineTo(0, h * 0.8); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = baseAlpha * (strokeOpacity); ctx.stroke();
  }
  ctx.restore();
}

const maskBuffers = new WeakMap<CanvasRenderingContext2D, HTMLCanvasElement>();

export function drawMaskLayer(
  ctx: CanvasRenderingContext2D, layer: MaskLayer, video: CanvasImageSource,
  source: { x: number; y: number; w: number; h: number },
  dest: { x: number; y: number; w: number; h: number },
  rect: { x: number; y: number; w: number; h: number }
) {
  const { x, y, w, h } = rect;
  if (w <= 0 || h <= 0 || dest.w <= 0 || dest.h <= 0) return;
  let buffer = maskBuffers.get(ctx);
  if (!buffer) { buffer = document.createElement("canvas"); maskBuffers.set(ctx, buffer); }
  if (buffer.width !== ctx.canvas.width || buffer.height !== ctx.canvas.height) { buffer.width = ctx.canvas.width; buffer.height = ctx.canvas.height; }
  const g = buffer.getContext("2d")!;
  g.clearRect(0, 0, buffer.width, buffer.height);
  const feather = Math.max(0, Math.min(layer.feather ?? 8, Math.min(w, h) / 4));
  const path = (target: CanvasRenderingContext2D) => {
    target.beginPath();
    if (layer.shape === "rectangle") roundRect(target, x, y, w, h, Math.min(12, w / 2, h / 2));
    else target.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  };
  g.save();
  if (layer.mask === "spotlight") {
    g.fillStyle = `rgba(0,0,0,${Math.min(0.95, 0.3 + layer.intensity * 0.2)})`;
    g.fillRect(0, 0, buffer.width, buffer.height);
    g.globalCompositeOperation = "destination-out";
    g.filter = `blur(${feather}px)`;
    g.fillStyle = "#000"; path(g); g.fill();
  } else {
    g.save(); path(g); g.clip();
    if (layer.mask === "blur") {
      g.filter = `blur(${Math.max(1, layer.intensity)}px)`;
      g.drawImage(video, source.x, source.y, source.w, source.h, dest.x, dest.y, dest.w, dest.h);
    } else {
      const zoom = Math.max(1.1, Math.min(8, layer.intensity));
      const sw = Math.min(source.w, w / dest.w * source.w / zoom);
      const sh = Math.min(source.h, h / dest.h * source.h / zoom);
      const centerX = source.x + (x + w / 2 - dest.x) / dest.w * source.w;
      const centerY = source.y + (y + h / 2 - dest.y) / dest.h * source.h;
      const sx = Math.max(source.x, Math.min(source.x + source.w - sw, centerX - sw / 2));
      const sy = Math.max(source.y, Math.min(source.y + source.h - sh, centerY - sh / 2));
      g.drawImage(video, sx, sy, sw, sh, x, y, w, h);
    }
    g.restore();
    if (layer.mask === "magnifier" && (layer.borderWidth ?? 3) > 0) {
      path(g); g.strokeStyle = layer.borderColor ?? "#ffffff"; g.lineWidth = layer.borderWidth ?? 3;
      g.shadowColor = "rgba(0,0,0,.2)"; g.shadowBlur = feather; g.stroke();
    }
  }
  g.restore();
  ctx.save(); ctx.globalAlpha *= Math.max(0, Math.min(1, layer.opacity ?? 1));
  ctx.drawImage(buffer, 0, 0); ctx.restore();
}

export function drawVideoWithMotionBlur(
  ctx: CanvasRenderingContext2D,
  video: CanvasImageSource,
  source: { x: number; y: number; w: number; h: number },
  dest: { x: number; y: number; w: number; h: number },
  motion: MotionBlurConfig,
  delta: { x: number; y: number; scale: number } | null
) {
  const distance = delta ? Math.hypot(delta.x, delta.y) : 0;
  if (!motion.enabled || !delta || distance > Math.max(dest.w, dest.h) / 3 || Math.abs(delta.scale) > 0.3) {
    ctx.drawImage(video, source.x, source.y, source.w, source.h, dest.x, dest.y, dest.w, dest.h); return;
  }
  const pan = Math.min(24, distance * motion.panAmount / 100);
  const zoom = Math.min(0.04, Math.abs(delta.scale) * motion.zoomAmount / 100);
  ctx.drawImage(video, source.x, source.y, source.w, source.h, dest.x, dest.y, dest.w, dest.h);
  if (pan < .1 && zoom < .0001) return;
  for (let i = 1; i <= 4; i++) {
    const t = i / 4;
    const dx = -delta.x / Math.max(1, distance) * pan * t;
    const dy = -delta.y / Math.max(1, distance) * pan * t;
    const grow = zoom * t;
    ctx.save(); ctx.globalAlpha *= 0.14;
    ctx.drawImage(video, source.x, source.y, source.w, source.h, dest.x + dx - dest.w * grow / 2, dest.y + dy - dest.h * grow / 2, dest.w * (1 + grow), dest.h * (1 + grow));
    ctx.restore();
  }
}

/** Draw the optional webcam track as a lightweight bottom-right picture-in-picture. */
export function drawCameraBubble(
  ctx: CanvasRenderingContext2D,
  camera: HTMLVideoElement,
  area: { x: number; y: number; w: number; h: number },
) {
  if (camera.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || camera.videoWidth <= 0) return;
  const width = Math.min(area.w * 0.24, 320);
  const aspect = camera.videoWidth / Math.max(1, camera.videoHeight);
  const height = Math.min(width / aspect, area.h * 0.34);
  const actualWidth = height * aspect;
  const margin = Math.max(10, Math.min(area.w, area.h) * 0.025);
  const x = area.x + area.w - actualWidth - margin;
  const y = area.y + area.h - height - margin;
  const radius = Math.min(18, actualWidth * 0.08, height * 0.16);
  const source = computeCoverRect(0, 0, camera.videoWidth, camera.videoHeight, actualWidth, height);

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.42)";
  ctx.shadowBlur = Math.max(8, actualWidth * 0.04);
  ctx.beginPath();
  roundRect(ctx, x, y, actualWidth, height, radius);
  ctx.fillStyle = "#05070a";
  ctx.fill();
  ctx.clip();
  ctx.drawImage(camera, source.x, source.y, source.w, source.h, x, y, actualWidth, height);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,.7)";
  ctx.lineWidth = Math.max(1, actualWidth / 180);
  ctx.beginPath();
  roundRect(ctx, x, y, actualWidth, height, radius);
  ctx.stroke();
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

export function motionEase(t: number, curve: string = "ease-in-out"): number {
  t = Math.max(0, Math.min(1, t));
  if (curve === "linear") return t;
  if (curve === "ease-in") return t * t * t;
  if (curve === "ease-out") return 1 - (1 - t) ** 3;
  if (curve === "sine") return (1 - Math.cos(Math.PI * t)) / 2;
  if (curve === "smoother") return t * t * t * (t * (6 * t - 15) + 10);
  return easeInOut(t);
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
  keyframes: { time: number; duration: number; x: number; y: number; scale: number; easing?: string }[],
  ts: number,
  zoomEnabled: boolean,
  fixedZoomPart: boolean,
  curve?: string
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
    const eased = ts < from ? 0 : motionEase(Math.min(1, Math.max(0, (ts - from) / span)), curve && curve !== "keyframes" ? curve : next.easing);
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
