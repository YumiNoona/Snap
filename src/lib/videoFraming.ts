import type { EditorConfig } from "./types";

export interface FrameRect { x: number; y: number; w: number; h: number }
export type VideoFit = "contain" | "cover";
/** The actual visible source rectangle, shared by direct framing and rendering. */
export function visibleCrop(rect: FrameRect, vw: number, vh: number, ratio: number): FrameRect {
  const r = normalizedRect(rect);
  const f = fitRect({ x: r.x * vw, y: r.y * vh, w: r.w * vw, h: r.h * vh }, { x: 0, y: 0, w: ratio, h: 1 }, "cover").source;
  return { x: f.x / vw, y: f.y / vh, w: f.w / vw, h: f.h / vh };
}

/** Move the picture with the pointer while keeping the crop inside the source. */
export function panCrop(rect: FrameRect, dx: number, dy: number): FrameRect {
  return { ...rect, x: Math.max(0, Math.min(1 - rect.w, rect.x - dx * rect.w)), y: Math.max(0, Math.min(1 - rect.h, rect.y - dy * rect.h)) };
}
export interface SplitLayout {
  camera: FrameRect;
  content: FrameRect;
  fraction: number;
  contentFit: VideoFit;
  cameraFit?: VideoFit;
}

export function normalizedRect(rect: FrameRect): FrameRect {
  const finite = (n: number, fallback: number) => Number.isFinite(n) ? n : fallback;
  const x = Math.max(0, Math.min(.99, finite(rect.x, 0)));
  const y = Math.max(0, Math.min(.99, finite(rect.y, 0)));
  return { x, y, w: Math.max(.01, Math.min(1 - x, finite(rect.w, 1))), h: Math.max(.01, Math.min(1 - y, finite(rect.h, 1))) };
}

/** Uniform scaling only. Cover crops; contain preserves the entire source. */
export function fitRect(source: FrameRect, target: FrameRect, fit: VideoFit): { source: FrameRect; target: FrameRect } {
  if (![source.w, source.h, target.w, target.h].every(n => Number.isFinite(n) && n > 0)) {
    return { source: { x: 0, y: 0, w: 0, h: 0 }, target: { x: 0, y: 0, w: 0, h: 0 } };
  }
  const s = { ...source }, d = { ...target };
  if (fit === "cover") {
    if (s.w / s.h > d.w / d.h) { const w = s.h * d.w / d.h; s.x += (s.w - w) / 2; s.w = w; }
    else { const h = s.w * d.h / d.w; s.y += (s.h - h) / 2; s.h = h; }
  } else {
    const scale = Math.min(d.w / s.w, d.h / s.h);
    const w = s.w * scale, h = s.h * scale;
    d.x += (d.w - w) / 2; d.y += (d.h - h) / 2; d.w = w; d.h = h;
  }
  return { source: s, target: d };
}

/** Shared by preview and export, including original-ratio footage with padding. */
export function videoFrame(config: EditorConfig, cw: number, ch: number, vw: number, vh: number): FrameRect {
  // Appearance values use a 1920px design width, like caption typography.
  // Scaling with the backing canvas keeps half/quarter previews and exports equal.
  const pad = Math.max(0, Math.min(config.padding * cw / 1920, Math.min(cw, ch) / 2 - 1));
  const inner = { x: pad, y: pad, w: Math.max(1, cw - 2 * pad), h: Math.max(1, ch - 2 * pad) };
  if (config.splitLayout || config.videoFit === "cover") return inner;
  const crop = normalizedRect(config.crop ?? { x: 0, y: 0, w: 1, h: 1 });
  return fitRect({ x: 0, y: 0, w: vw * crop.w, h: vh * crop.h }, inner, "contain").target;
}

export function drawSplitFrame(ctx: CanvasRenderingContext2D, source: CanvasImageSource, vw: number, vh: number, target: FrameRect, layout: SplitLayout): void {
  const fraction = Math.max(.15, Math.min(.6, layout.fraction));
  const draw = (rect: FrameRect, dest: FrameRect, mode: VideoFit) => {
    const r = normalizedRect(rect);
    const fit = fitRect({ x: r.x * vw, y: r.y * vh, w: r.w * vw, h: r.h * vh }, dest, mode);
    if (!fit.source.w || !fit.target.w) return;
    ctx.drawImage(source, fit.source.x, fit.source.y, fit.source.w, fit.source.h, fit.target.x, fit.target.y, fit.target.w, fit.target.h);
  };
  ctx.save(); ctx.beginPath(); ctx.rect(target.x, target.y, target.w, target.h); ctx.clip();
  ctx.fillStyle = "#0b0d12"; ctx.fillRect(target.x, target.y, target.w, target.h);
  draw(layout.camera, { ...target, h: target.h * fraction }, layout.cameraFit ?? "contain");
  draw(layout.content, { ...target, y: target.y + target.h * fraction, h: target.h * (1 - fraction) }, layout.contentFit);
  ctx.restore();
}
