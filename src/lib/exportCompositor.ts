import { convertFileSrc } from "@tauri-apps/api/core";
import type { EditorConfig, Keyframe } from "./types";
import { getMovementDuration } from "./types";
import { getGradientPreset } from "./wallpapers";
import { loadInputLog, getCursorAt as getCursorAtRaw, screenToVideo as screenToVideoRaw } from "./inputLog";
import {
  loadCachedImage, paintGradient, paintImageCover, drawCursor, roundRect,
  computeCoverRect, resolveZoom, smoothTowards,
} from "./canvasDraw";

export interface ExportCompositor {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  destroy: () => void;
}

/**
 * Mirrors Preview/index.tsx's render() loop exactly (same shared zoom/cover-
 * crop/cursor-smoothing math from lib/canvasDraw, same event data from
 * lib/inputLog) so the export is a true frame-for-frame match of what the
 * canvas preview shows — background, pan/zoom, custom cursor or default
 * cursor or none, click ripples, and blur mask layers. Kept intentionally
 * close to Preview's render() body; if that function changes, mirror the
 * change here too.
 */
export async function createExportCompositor(
  videoPath: string,
  inputLogPath: string,
  keyframes: Keyframe[],
  config: EditorConfig,
  outputW: number,
  outputH: number
): Promise<ExportCompositor> {
  const video = document.createElement("video");
  video.src = convertFileSrc(videoPath);
  video.muted = true; // audio is muxed from the original sidecar wav files, not captured here
  video.playsInline = true;
  video.preload = "auto";
  video.style.position = "fixed";
  video.style.left = "-99999px";
  video.style.top = "0px";
  document.body.appendChild(video);

  const canvas = document.createElement("canvas");
  canvas.width = outputW;
  canvas.height = outputH;
  canvas.style.position = "fixed";
  canvas.style.left = "-99999px";
  canvas.style.top = "0px";
  document.body.appendChild(canvas);

  const ctx2d = canvas.getContext("2d", { alpha: false });
  if (!ctx2d) {
    video.remove();
    canvas.remove();
    throw new Error("Could not get a 2D canvas context for export");
  }
  // Re-bind to a definitely-non-null const — TS doesn't retain the null
  // check's narrowing across the `drawFrame` closure defined below.
  const ctx: CanvasRenderingContext2D = ctx2d;

  const { mouseMoveEvents, clickEvents, region } = await loadInputLog(inputLogPath);

  await new Promise<void>((resolve, reject) => {
    video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    video.addEventListener("error", () => reject(new Error("Failed to load the recording for export")), { once: true });
  });

  const getCursorAt = (ts: number) => getCursorAtRaw(mouseMoveEvents, ts);
  const screenToVideo = (sx: number, sy: number, vw: number, vh: number) => screenToVideoRaw(region, sx, sy, vw, vh);

  // Per-run state mirroring Preview's component refs.
  const wallpaperImages = new Map<string, HTMLImageElement>();
  const cursorImages = new Map<string, HTMLImageElement>();
  let wallpaperState: { path: string; img: HTMLImageElement } | null = null;
  const fadeStart = performance.now();
  let lastPack: { path: string; img: HTMLImageElement } | null = null;
  let smoothedCursor: { x: number; y: number; ts: number } | null = null;
  let clickIdx = 0;
  let clickRipples: { x: number; y: number; t: number; ts: number }[] = [];
  let prevTs = -1;

  function spawnClickRipples(prevMs: number, curMs: number, vw: number, vh: number) {
    if (!config.cursorStyle.showClickRipples) return;
    let i = clickIdx;
    while (i < clickEvents.length && clickEvents[i].ts <= curMs) {
      const c = clickEvents[i];
      if (c.ts > prevMs && c.x != null && c.y != null) {
        const p = screenToVideo(c.x, c.y, vw, vh);
        clickRipples.push({ x: p.x, y: p.y, t: performance.now(), ts: c.ts });
        if (clickRipples.length > 12) clickRipples.shift();
      }
      i++;
    }
    clickIdx = i;
  }

  let destroyed = false;
  let rafId = 0;

  function drawFrame() {
    if (destroyed) return;
    const ts = video.currentTime * 1000;
    const cw = outputW, ch = outputH;
    const pad = config.padding;
    const br = config.borderRadius;
    const vw = video.videoWidth || 1;
    const vh = video.videoHeight || 1;

    let videoW: number, videoH: number, offsetX: number, offsetY: number;
    if (config.aspectRatio && config.aspectRatio.width > 0) {
      const ar = config.aspectRatio.width / config.aspectRatio.height;
      const innerW = Math.max(20, cw - pad * 2);
      const innerH = Math.max(20, ch - pad * 2);
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
      videoW = Math.max(20, cw - pad * 2);
      videoH = Math.max(20, ch - pad * 2);
      offsetX = pad;
      offsetY = pad;
    }

    const crop = config.crop;
    const baseX = crop ? crop.x * vw : 0;
    const baseY = crop ? crop.y * vh : 0;
    const baseW = crop ? crop.w * vw : vw;
    const baseH = crop ? crop.h * vh : vh;

    const clipR = Math.max(0, Math.min(br, videoW / 2, videoH / 2));

    const zoom = resolveZoom(keyframes, ts, config.zoomEnabled, config.fixedZoomPart);
    const zoomX = zoom.x, zoomY = zoom.y, zoomScale = Math.max(0.0001, zoom.scale);

    // Background — same bgType-driven priority as Preview (see lib/canvasDraw
    // usage in Preview/index.tsx for why this must key off bgType, not a
    // stale wallpaperUrl gradient lookup).
    const bgIsImage = config.bgType === "image";
    const bgIsGradient = config.bgType === "gradient" || config.bgType === "wallpaper";
    const bgGradient = bgIsGradient ? getGradientPreset(config.wallpaperUrl) : undefined;
    const FADE_MS = 200;
    ctx.save();
    if (bgIsImage && config.bgBlur > 0) {
      ctx.filter = `blur(${Math.min(config.bgBlur, 100)}px)`;
    }
    if (bgIsImage) {
      const img = loadCachedImage(config.wallpaperUrl, wallpaperImages);
      const imgReady = img && img.complete && img.naturalWidth > 0;
      const last = wallpaperState;
      if (imgReady) {
        if (last && last.path !== config.wallpaperUrl && last.img.complete && last.img.naturalWidth > 0) {
          const t = Math.min(1, (performance.now() - fadeStart) / FADE_MS);
          ctx.globalAlpha = 1 - t;
          paintImageCover(ctx, last.img, cw, ch);
          ctx.globalAlpha = t;
          paintImageCover(ctx, img, cw, ch);
          ctx.globalAlpha = 1;
          if (t >= 1) wallpaperState = { path: config.wallpaperUrl, img };
        } else {
          paintImageCover(ctx, img, cw, ch);
          wallpaperState = { path: config.wallpaperUrl, img };
        }
      } else if (last && last.img.complete && last.img.naturalWidth > 0) {
        paintImageCover(ctx, last.img, cw, ch);
      } else {
        ctx.fillStyle = config.backgroundColor;
        ctx.fillRect(0, 0, cw, ch);
      }
    } else if (bgGradient) {
      paintGradient(ctx, bgGradient, cw, ch);
    } else {
      ctx.fillStyle = config.backgroundColor;
      ctx.fillRect(0, 0, cw, ch);
    }
    ctx.restore();

    // Shadow
    if (config.shadow.enabled) {
      ctx.save();
      ctx.shadowColor = config.shadow.color;
      ctx.shadowBlur = config.shadow.blur;
      ctx.shadowOffsetX = config.shadow.offsetX;
      ctx.shadowOffsetY = config.shadow.offsetY;
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      roundRect(ctx, offsetX, offsetY, videoW, videoH, clipR);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.beginPath();
    roundRect(ctx, offsetX, offsetY, videoW, videoH, clipR);
    ctx.clip();

    const srcX = baseX + zoomX * baseW - (baseW / zoomScale) / 2;
    const srcY = baseY + zoomY * baseH - (baseH / zoomScale) / 2;
    const srcW = baseW / zoomScale;
    const srcH = baseH / zoomScale;
    const effX = Math.max(baseX, srcX);
    const effY = Math.max(baseY, srcY);
    const effW = Math.min(baseX + baseW, srcX + srcW) - effX;
    const effH = Math.min(baseY + baseH, srcY + srcH) - effY;

    const cover = computeCoverRect(effX, effY, effW, effH, videoW, videoH);
    const coverX = cover.x, coverY = cover.y, coverW = cover.w, coverH = cover.h;

    if (coverW > 0.5 && coverH > 0.5) {
      ctx.drawImage(video, coverX, coverY, coverW, coverH, offsetX, offsetY, videoW, videoH);
    }

    // Cursor overlay — custom pack, default styled cursor, or none, exactly
    // per config.showCursor / config.cursorStyle.pack, same as Preview.
    if (config.showCursor) {
      const rawCursor = getCursorAt(ts);
      let cursor = rawCursor;
      if (rawCursor && config.cursorMovement.enabled) {
        const durationMs = Math.max(50, getMovementDuration(config.cursorMovement));
        smoothedCursor = smoothTowards(smoothedCursor, rawCursor, ts, durationMs);
        cursor = smoothedCursor;
      } else {
        smoothedCursor = null;
      }
      if (cursor) {
        const c = screenToVideo(cursor.x, cursor.y, vw, vh);
        const zoomedCursorX = (c.x - coverX) / coverW * videoW + offsetX;
        const zoomedCursorY = (c.y - coverY) / coverH * videoH + offsetY;
        if (zoomedCursorX >= offsetX && zoomedCursorX <= offsetX + videoW &&
            zoomedCursorY >= offsetY && zoomedCursorY <= offsetY + videoH) {
          const pack = config.cursorStyle.pack;
          if (pack) {
            const img = loadCachedImage(pack.imageUrl, cursorImages);
            if (img && img.complete && img.naturalWidth > 0) {
              lastPack = { path: pack.imageUrl, img };
              const hs = config.cursorHotspots[pack.id] ?? { x: 10, y: 10 };
              const drawX = zoomedCursorX - (Math.min(100, Math.max(0, hs.x)) / 100) * img.naturalWidth;
              const drawY = zoomedCursorY - (Math.min(100, Math.max(0, hs.y)) / 100) * img.naturalHeight;
              ctx.drawImage(img, drawX, drawY);
            } else if (lastPack) {
              const prev = lastPack.img;
              const hs = config.cursorHotspots[pack.id] ?? { x: 10, y: 10 };
              const drawX = zoomedCursorX - (Math.min(100, Math.max(0, hs.x)) / 100) * prev.naturalWidth;
              const drawY = zoomedCursorY - (Math.min(100, Math.max(0, hs.y)) / 100) * prev.naturalHeight;
              ctx.drawImage(prev, drawX, drawY);
            } else {
              drawCursor(ctx, zoomedCursorX, zoomedCursorY, config.cursorStyle);
            }
          } else {
            drawCursor(ctx, zoomedCursorX, zoomedCursorY, config.cursorStyle);
          }
        }
      }
    }

    // Click ripples
    const now = performance.now();
    clickRipples = clickRipples.filter((r) => {
      const age = (now - r.t) / 1000;
      if (age > 1.0) return false;
      const rx = (r.x - coverX) / coverW * videoW + offsetX;
      const ry = (r.y - coverY) / coverH * videoH + offsetY;
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

    // Mask layers (blur)
    const videoTs = video.currentTime;
    for (const layer of config.layers) {
      if (layer.type !== "mask") continue;
      if (videoTs < layer.start || videoTs > layer.end) continue;
      const lx = offsetX + layer.x * videoW;
      const ly = offsetY + layer.y * videoH;
      const lw = layer.w * videoW;
      const lh = layer.h * videoH;
      if (layer.mask === "blur") {
        ctx.save();
        ctx.beginPath();
        ctx.rect(lx, ly, lw, lh);
        ctx.clip();
        ctx.filter = `blur(${layer.intensity}px)`;
        ctx.drawImage(video, coverX, coverY, coverW, coverH, offsetX, offsetY, videoW, videoH);
        ctx.filter = "none";
        ctx.fillStyle = "rgba(0,0,0,0.12)";
        ctx.fillRect(lx, ly, lw, lh);
        ctx.restore();
      }
      // Spotlight / magnifier masks aren't implemented in the canvas
      // renderer yet (Preview doesn't draw them either), so export matches.
    }

    // Click-ripple spawning — export always plays forward in real time, so
    // this mirrors Preview's "playing" branch (never the seek/scrub branch).
    const prev = prevTs < 0 ? ts : prevTs;
    prevTs = ts;
    const jumped = Math.abs(ts - prev) > 300;
    spawnClickRipples(jumped ? ts : prev, ts, vw, vh);

    rafId = requestAnimationFrame(drawFrame);
  }

  rafId = requestAnimationFrame(drawFrame);

  return {
    video,
    canvas,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(rafId);
      video.pause();
      video.remove();
      canvas.remove();
    },
  };
}
