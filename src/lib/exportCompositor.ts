import { convertFileSrc } from "@tauri-apps/api/core";
import type { CaptionTrack, EditorConfig, Keyframe } from "./types";
import { getMovementDuration } from "./types";
import { getGradientPreset, getWallpaperPreset } from "./wallpapers";
import { loadInputLog, getCursorAt as getCursorAtRaw, screenToVideo as screenToVideoRaw, hasClickNear } from "./inputLog";
import {
  loadCachedImage, paintGradient, paintImageCover, drawCursor, drawCursorImage, roundRect,
  computeCoverRect, resolveZoom, smoothTowards, drawClickEffect, clickEffectDuration,
  cursorIdleOpacity, drawTextLayer, drawShapeLayer, drawMaskLayer, drawVideoWithMotionBlur, drawCaptionTrack,
} from "./canvasDraw";

export interface ExportCompositor {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  clickTimesMs: number[];
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
  captionTracks: CaptionTrack[],
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
  const maskSource = document.createElement("canvas");
  maskSource.width = outputW;
  maskSource.height = outputH;
  const maskSourceCtx = maskSource.getContext("2d");

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
  let clickRipples: { x: number; y: number; ts: number }[] = [];
  let prevTs = -1;
  let previousZoom: { x: number; y: number; scale: number; ts: number } | null = null;
  let previousCursorDraw: { x: number; y: number } | null = null;

  function spawnClickRipples(prevMs: number, curMs: number, vw: number, vh: number) {
    if (!config.cursorStyle.showClickRipples || config.cursorStyle.clickEffect === "none") return;
    let i = clickIdx;
    while (i < clickEvents.length && clickEvents[i].ts <= curMs) {
      const c = clickEvents[i];
      if (c.ts > prevMs && c.x != null && c.y != null) {
        const p = screenToVideo(c.x, c.y, vw, vh);
        clickRipples.push({ x: p.x, y: p.y, ts: c.ts });
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
      const img = loadCachedImage(getWallpaperPreset(config.wallpaperUrl)?.url ?? config.wallpaperUrl, wallpaperImages);
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
      const zoomDelta = previousZoom && ts >= previousZoom.ts && ts - previousZoom.ts < 100
        ? { x: (zoomX - previousZoom.x) * videoW, y: (zoomY - previousZoom.y) * videoH, scale: zoomScale - previousZoom.scale }
        : null;
      drawVideoWithMotionBlur(
        ctx, video,
        { x: coverX, y: coverY, w: coverW, h: coverH },
        { x: offsetX, y: offsetY, w: videoW, h: videoH },
        config.motionBlur, zoomDelta
      );
      previousZoom = { x: zoomX, y: zoomY, scale: zoomScale, ts };
    }

    if (config.inset > 0) {
      ctx.save(); ctx.strokeStyle = config.insetColor; ctx.lineWidth = config.inset * 2;
      ctx.beginPath(); roundRect(ctx, offsetX, offsetY, videoW, videoH, clipR); ctx.stroke(); ctx.restore();
    }

    // Cursor overlay — custom pack, default styled cursor, or none, exactly
    // per config.showCursor / config.cursorStyle.pack, same as Preview.
    if (config.showCursor) {
      const rawCursor = getCursorAt(ts);
      let cursor = rawCursor;
      if (rawCursor && config.cursorMovement.enabled) {
        const durationMs = Math.max(50, getMovementDuration(config.cursorMovement));
        smoothedCursor = hasClickNear(clickEvents, ts)
          ? { ...rawCursor, ts }
          : smoothTowards(smoothedCursor, rawCursor, ts, durationMs);
        cursor = smoothedCursor;
      } else {
        smoothedCursor = null;
      }
      const idleAlpha = cursorIdleOpacity(mouseMoveEvents, ts, config.cursorStyle.hideWhenIdle);
      if (cursor && idleAlpha > 0) {
        const c = screenToVideo(cursor.x, cursor.y, vw, vh);
        const zoomedCursorX = (c.x - coverX) / coverW * videoW + offsetX;
        const zoomedCursorY = (c.y - coverY) / coverH * videoH + offsetY;
        if (zoomedCursorX >= offsetX && zoomedCursorX <= offsetX + videoW &&
            zoomedCursorY >= offsetY && zoomedCursorY <= offsetY + videoH) {
          ctx.save(); ctx.globalAlpha = idleAlpha;
          const pack = config.cursorStyle.pack;
          const trailImage = pack ? loadCachedImage(pack.imageUrl, cursorImages) : null;
          const trailHotspot = pack ? (config.cursorHotspots[pack.id] ?? { x: 10, y: 10 }) : null;
          const prevCursor = previousCursorDraw;
          if (config.motionBlur.enabled && config.motionBlur.cursorAmount > 0 && prevCursor) {
            const dx = zoomedCursorX - prevCursor.x, dy = zoomedCursorY - prevCursor.y;
            if (Math.hypot(dx, dy) > 2) {
              for (let ghost = 3; ghost >= 1; ghost--) {
                ctx.save(); ctx.globalAlpha = idleAlpha * 0.08 * (4 - ghost);
                if (trailImage && trailImage.complete && trailImage.naturalWidth > 0 && trailHotspot) {
                  drawCursorImage(ctx, trailImage, zoomedCursorX - dx * ghost * 0.22, zoomedCursorY - dy * ghost * 0.22, config.cursorStyle.size, trailHotspot);
                } else {
                  drawCursor(ctx, zoomedCursorX - dx * ghost * 0.22, zoomedCursorY - dy * ghost * 0.22, config.cursorStyle);
                }
                ctx.restore();
              }
            }
          }
          previousCursorDraw = { x: zoomedCursorX, y: zoomedCursorY };
          if (pack) {
            const img = loadCachedImage(pack.imageUrl, cursorImages);
            if (img && img.complete && img.naturalWidth > 0) {
              lastPack = { path: pack.imageUrl, img };
              const hs = config.cursorHotspots[pack.id] ?? { x: 10, y: 10 };
              drawCursorImage(ctx, img, zoomedCursorX, zoomedCursorY, config.cursorStyle.size, hs);
            } else if (lastPack) {
              const prev = lastPack.img;
              const hs = config.cursorHotspots[pack.id] ?? { x: 10, y: 10 };
              drawCursorImage(ctx, prev, zoomedCursorX, zoomedCursorY, config.cursorStyle.size, hs);
            } else {
              drawCursor(ctx, zoomedCursorX, zoomedCursorY, config.cursorStyle);
            }
          } else {
            drawCursor(ctx, zoomedCursorX, zoomedCursorY, config.cursorStyle);
          }
          ctx.restore();
        }
      }
    }

    // Click ripples
    clickRipples = clickRipples.filter((r) => {
      const age = (ts - r.ts) / 1000;
      if (age > clickEffectDuration(config.cursorStyle.clickEffect)) return false;
      const rx = (r.x - coverX) / coverW * videoW + offsetX;
      const ry = (r.y - coverY) / coverH * videoH + offsetY;
      drawClickEffect(ctx, rx, ry, age, config.cursorStyle.color, config.cursorStyle.clickEffect, r.ts);
      return true;
    });

    ctx.restore();

    // Timed annotation and mask layers. Masks sample the fully composited
    // frame so their result matches Preview after pan/zoom and styling.
    const videoTs = video.currentTime;
    const activeLayers = config.layers.filter((layer) => videoTs >= layer.start - 0.02 && videoTs <= layer.end + 0.02);
    if (maskSourceCtx && activeLayers.some((layer) => layer.type === "mask")) {
      maskSourceCtx.clearRect(0, 0, outputW, outputH);
      maskSourceCtx.drawImage(canvas, 0, 0);
      for (const layer of activeLayers) {
        if (layer.type !== "mask") continue;
        const lx = offsetX + layer.x * videoW;
        const ly = offsetY + layer.y * videoH;
        const lw = layer.w * videoW;
        const lh = layer.h * videoH;
        drawMaskLayer(
          ctx, layer, maskSource,
          { x: 0, y: 0, w: outputW, h: outputH },
          { x: 0, y: 0, w: outputW, h: outputH },
          { x: lx, y: ly, w: lw, h: lh }
        );
      }
    }
    for (const layer of activeLayers) {
      if (layer.type === "mask") continue;
      const lx = offsetX + layer.x * videoW;
      const ly = offsetY + layer.y * videoH;
      const lw = layer.w * videoW;
      const lh = layer.h * videoH;
      ctx.save();
      ctx.globalAlpha = Math.max(0.05, Math.min(1, layer.opacity ?? 1));
      ctx.translate(lx + lw / 2, ly + lh / 2);
      ctx.rotate((layer.rotation ?? 0) * Math.PI / 180);
      ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
      ctx.translate(-(lx + lw / 2), -(ly + lh / 2));
      if (layer.type === "text") drawTextLayer(ctx, layer, lx, ly, lw, lh);
      else drawShapeLayer(ctx, layer, lx, ly, lw, lh);
      ctx.restore();
    }
    for (const track of captionTracks) {
      if (track.burnedIn) drawCaptionTrack(ctx, track, videoTs * 1000, { x: offsetX, y: offsetY, w: videoW, h: videoH });
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
    clickTimesMs: clickEvents.map((event) => event.ts),
    destroy() {
      destroyed = true;
      cancelAnimationFrame(rafId);
      video.pause();
      video.remove();
      canvas.remove();
    },
  };
}
