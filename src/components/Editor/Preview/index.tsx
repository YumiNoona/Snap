import { useEffect, useRef, useState, useCallback } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Play } from "lucide-react";
import type { InputEvent, Keyframe, EditorConfig } from "../../../lib/types";
import { generateKeyframes } from "../../../lib/autoZoom";
import { getMovementDuration } from "../../../lib/types";
import { getGradientPreset } from "../../../lib/wallpapers";
import { loadInputLog, getCursorAt as getCursorAtShared, screenToVideo as screenToVideoShared } from "../../../lib/inputLog";
import { loadCachedImage, paintGradient, paintImageCover, drawCursor, roundRect, computeCoverRect, resolveZoom, smoothTowards } from "../../../lib/canvasDraw";
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
  cropMode?: boolean;
  onCropApply?: (crop: { x: number; y: number; w: number; h: number } | null) => void;
  onCropCancel?: () => void;
  selectedLayerId?: string | null;
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
  cropMode = false,
  onCropApply,
  onCropCancel,
  selectedLayerId = null,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loadError, setLoadError] = useState("");
  const [videoReady, setVideoReady] = useState(false);
  const rafRef = useRef<number>(0);
  const renderRef = useRef<() => void>(() => {});
  const cursorImages = useRef(new Map<string, HTMLImageElement>());
  const wallpaperImages = useRef(new Map<string, HTMLImageElement>());
  const cropDrag = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const geomRef = useRef({ offsetX: 0, offsetY: 0, videoW: 1280, videoH: 720, cw: 1280, ch: 720 });
  const mouseMoveEvents = useRef<InputEvent[]>([]);
  const allEvents = useRef<InputEvent[]>([]);
  const clickEvents = useRef<InputEvent[]>([]);
  const clickIdxRef = useRef(0);
  const regionRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const clickRipples = useRef<{ x: number; y: number; t: number; ts: number }[]>([]);
  const prevTimeRef = useRef(-1);
  const prevPlayRef = useRef(-1);
  const wallpaperRef = useRef<{ path: string; img: HTMLImageElement } | null>(null);
  const fadeRef = useRef<{ start: number }>({ start: 0 });
  const lastPackRef = useRef<{ path: string; img: HTMLImageElement } | null>(null);
  const smoothedCursorRef = useRef<{ x: number; y: number; ts: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 1280, h: 720 });
  const [eventsReady, setEventsReady] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(1.0);
  const videoMetaRef = useRef<{ w: number; h: number; d: number } | null>(null);
  const kfGenerated = useRef(false);

  // Cache resolved CSS variable colors ONCE — never call getComputedStyle inside rAF.
  const colorsRef = useRef({ shadow: "#0f172a", crop: "rgba(0,0,0,0.45)", border: "#ffffff", cursorWhite: "#ffffff" });

  // Resolve CSS variable colors once on mount
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    colorsRef.current = {
      shadow: cs.getPropertyValue("--bg-surface-sunken").trim() || "#0f172a",
      crop: "rgba(0, 0, 0, 0.45)",
      border: cs.getPropertyValue("--text-primary").trim() || "#ffffff",
      cursorWhite: "#ffffff",
    };
  }, []);

  useEffect(() => {
    setEventsReady(false);
    kfGenerated.current = false;
    mouseMoveEvents.current = [];
    allEvents.current = [];
    clickEvents.current = [];
    clickIdxRef.current = 0;
    regionRef.current = null;
    clickRipples.current = [];
  }, [inputLogPath]);

  // Load input log
  useEffect(() => {
    (async () => {
      try {
        const { allEvents: aligned, mouseMoveEvents: moves, clickEvents: clicks, region } =
          await loadInputLog(inputLogPath);
        allEvents.current = aligned;
        mouseMoveEvents.current = moves;
        clickEvents.current = clicks;
        regionRef.current = region;
        clickIdxRef.current = 0;
        clickRipples.current = [];
        setEventsReady(true);
      } catch (e) {
        setLoadError(`Failed to load log: ${e}`);
      }
    })();
  }, [inputLogPath]);

  // Generate keyframes when ready
  useEffect(() => {
    if (!videoReady || !eventsReady || kfGenerated.current) return;
    const meta = videoMetaRef.current;
    if (!meta) return;
    kfGenerated.current = true;
    if (allEvents.current.length > 0) {
      const kf = generateKeyframes(
        allEvents.current,
        meta.w,
        meta.h,
        meta.d * 1000,
        getMovementDuration(config.zoomMovement)
      );
      onKeyframesChange(kf);
    }
  }, [videoReady, eventsReady, onKeyframesChange]);

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
      // Canvas is sized to the video / output aspect ratio only — padding is
      // drawn INSIDE the canvas so the padding slider scales the video frame
      // smoothly instead of resizing the whole canvas.
      const maxW = Math.max(64, container.clientWidth - 32);
      const maxH = Math.max(64, container.clientHeight - 32);

      let outW: number, outH: number;

      if (config.aspectRatio && config.aspectRatio.width > 0) {
        const ar = config.aspectRatio.width / config.aspectRatio.height;
        if (maxW / maxH > ar) {
          outH = maxH;
          outW = outH * ar;
        } else {
          outW = maxW;
          outH = outW / ar;
        }
      } else {
        const scale = Math.min(maxW / vw, maxH / vh);
        outW = vw * scale;
        outH = vh * scale;
      }

      setCanvasSize({ w: Math.round(outW), h: Math.round(outH) });
    },
    [config.aspectRatio]
  );

  useEffect(() => {
    const video = videoRef.current;
    if (video && videoReady) {
      computeCanvasSize(video.videoWidth, video.videoHeight);
    }
  }, [config.aspectRatio, videoReady, computeCanvasSize]);

  // Cursor interpolation (shared with the export renderer via lib/inputLog)
  const getCursorAt = useCallback((timestampMs: number): { x: number; y: number } | null => {
    return getCursorAtShared(mouseMoveEvents.current, timestampMs);
  }, []);

  // Map an absolute screen coordinate onto the video's source pixel space.
  const screenToVideo = useCallback((sx: number, sy: number, vw: number, vh: number) => {
    return screenToVideoShared(regionRef.current, sx, sy, vw, vh);
  }, []);

  // Spawn click ripples for every click the playhead crossed since the last frame.
  const spawnClickRipples = useCallback(
    (prevTs: number, curTs: number, vw: number, vh: number) => {
      if (!config.cursorStyle.showClickRipples) return;
      const clicks = clickEvents.current;
      let i = clickIdxRef.current;
      while (i < clicks.length && clicks[i].ts <= curTs) {
        const c = clicks[i];
        if (c.ts > prevTs && c.x != null && c.y != null) {
          const p = screenToVideo(c.x, c.y, vw, vh);
          const ripples = clickRipples.current;
          ripples.push({ x: p.x, y: p.y, t: performance.now(), ts: c.ts });
          if (ripples.length > 12) ripples.shift();
        }
        i++;
      }
      clickIdxRef.current = i;
    },
    [config.cursorStyle.showClickRipples, screenToVideo]
  );

  // ── Render ──────────────────────────────────────────────────────────────
  const render = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || canvasSize.w === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const ts = video.currentTime * 1000;
    const { w: cw, h: ch } = canvasSize;
    const pad = config.padding;
    const br = config.borderRadius;
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    // Uniform 4-Side Padding Calculation (padding lives INSIDE the fixed canvas)
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
    geomRef.current = { offsetX, offsetY, videoW, videoH, cw, ch };

    // Crop base rect (normalized 0-1 -> source pixels)
    const crop = config.crop;
    const baseX = crop ? crop.x * vw : 0;
    const baseY = crop ? crop.y * vh : 0;
    const baseW = crop ? crop.w * vw : vw;
    const baseH = crop ? crop.h * vh : vh;

    // Corner radius applies to the recorded video only (not the canvas)
    const clipR = Math.max(0, Math.min(br, videoW / 2, videoH / 2));

    // ── Interpolate Zoom ──────────────────────────────────────────────────
    // Shared with the export renderer via lib/canvasDraw.resolveZoom so both
    // compute the exact same pan/zoom for a given timestamp.
    const zoomResult = resolveZoom(keyframes, ts, config.zoomEnabled, config.fixedZoomPart);
    const zoomX = zoomResult.x, zoomY = zoomResult.y, zoomScale = zoomResult.scale;
    if (config.zoomEnabled && keyframes.length > 0) {
      const z = Math.round(zoomScale * 100) / 100;
      if (Math.abs(currentZoom - z) > 0.01) setCurrentZoom(z);
    }


    // ── Draw Background ────────────────────────────────────────────────────
    ctx.clearRect(0, 0, cw, ch);

    // Background type is the single source of truth. Previously this looked
    // up `bgGradient` unconditionally, so picking a solid color still painted
    // the last-selected gradient (wallpaperUrl was never cleared) — colors
    // never actually applied. "wallpaper" is treated as gradient for legacy
    // default-config compatibility.
    const bgIsImage = config.bgType === "image";
    const bgIsGradient = config.bgType === "gradient" || config.bgType === "wallpaper";
    const bgGradient = bgIsGradient ? getGradientPreset(config.wallpaperUrl) : undefined;

    // Blur applies ONLY to the wallpaper image layer (not gradients/solids)
    const FADE_MS = 200;
    ctx.save();
    if (bgIsImage && config.bgBlur > 0) {
      ctx.filter = `blur(${Math.min(config.bgBlur, 100)}px)`;
    }

    if (bgIsImage) {
      const img = getWallpaperImage(config.wallpaperUrl, wallpaperImages.current);
      const imgReady = img && img.complete && img.naturalWidth > 0;
      const last = wallpaperRef.current;

      if (imgReady) {
        if (last && last.path !== config.wallpaperUrl && last.img.complete && last.img.naturalWidth > 0) {
          // Crossfade from the previously-drawn wallpaper to the new one.
          const fade = fadeRef.current;
          const t = Math.min(1, (performance.now() - fade.start) / FADE_MS);
          ctx.globalAlpha = 1 - t;
          paintImageCover(ctx, last.img, cw, ch);
          ctx.globalAlpha = t;
          paintImageCover(ctx, img, cw, ch);
          ctx.globalAlpha = 1;
          if (t >= 1) wallpaperRef.current = { path: config.wallpaperUrl, img };
        } else {
          paintImageCover(ctx, img, cw, ch);
          wallpaperRef.current = { path: config.wallpaperUrl, img };
        }
      } else if (last && last.img.complete && last.img.naturalWidth > 0) {
        // New image still loading — keep showing the previous one (no flash).
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
      ctx.fillStyle = colorsRef.current.shadow;
      ctx.beginPath();
      roundRect(ctx, offsetX, offsetY, videoW, videoH, clipR);
      ctx.fill();
      ctx.restore();
    }

    // Clip for video area
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, offsetX, offsetY, videoW, videoH, clipR);
    ctx.clip();

    // Draw Video Frame with Zoom (within the crop base rect)
    const srcX = baseX + zoomX * baseW - (baseW / zoomScale) / 2;
    const srcY = baseY + zoomY * baseH - (baseH / zoomScale) / 2;
    const srcW = baseW / zoomScale;
    const srcH = baseH / zoomScale;
    const effX = Math.max(baseX, srcX);
    const effY = Math.max(baseY, srcY);
    const effW = Math.min(baseX + baseW, srcX + srcW) - effX;
    const effH = Math.min(baseY + baseH, srcY + srcH) - effY;

    // "Cover" fit into the destination box (offsetX,offsetY,videoW,videoH).
    // Previously the zoomed/cropped source rect (native video aspect) was
    // drawn straight into a destination box shaped like the chosen output
    // aspect ratio — a non-uniform stretch whenever the two aspects
    // differed (e.g. picking 9:16 on a 16:9 recording). Instead, crop the
    // source further, centered, to match the destination aspect exactly,
    // so the frame fills without distorting.
    const cover = computeCoverRect(effX, effY, effW, effH, videoW, videoH);
    const coverX = cover.x, coverY = cover.y, coverW = cover.w, coverH = cover.h;

    if (coverW > 0.5 && coverH > 0.5) {
      ctx.drawImage(
        video,
        coverX, coverY, coverW, coverH,
        offsetX, offsetY, videoW, videoH
      );
    }

    // Cursor Overlay
    if (config.showCursor) {
      const rawCursor = getCursorAt(ts);
      // Cursor Movement smoothing: when enabled, ease the cursor toward its
      // raw sampled position over `durationMs` for a fluid, cinematic feel.
      // When disabled (default), the raw 250Hz-sampled position is used
      // directly — exact 1:1 tracking, no added delay.
      let cursor = rawCursor;
      if (rawCursor && config.cursorMovement.enabled) {
        const durationMs = Math.max(50, getMovementDuration(config.cursorMovement));
        smoothedCursorRef.current = smoothTowards(smoothedCursorRef.current, rawCursor, ts, durationMs);
        cursor = smoothedCursorRef.current;
      } else {
        smoothedCursorRef.current = null;
      }
      if (cursor) {
        const c = screenToVideo(cursor.x, cursor.y, vw, vh);
        const zoomedCursorX = (c.x - coverX) / coverW * videoW + offsetX;
        const zoomedCursorY = (c.y - coverY) / coverH * videoH + offsetY;
        if (zoomedCursorX >= offsetX && zoomedCursorX <= offsetX + videoW &&
            zoomedCursorY >= offsetY && zoomedCursorY <= offsetY + videoH) {
          const pack = config.cursorStyle.pack;
          if (pack) {
            const img = loadCursorImage(pack.imageUrl, cursorImages.current);
            if (img && img.complete && img.naturalWidth > 0) {
              lastPackRef.current = { path: pack.imageUrl, img };
              const hs = config.cursorHotspots[pack.id] ?? { x: 10, y: 10 };
              const drawX = zoomedCursorX - (Math.min(100, Math.max(0, hs.x)) / 100) * img.naturalWidth;
              const drawY = zoomedCursorY - (Math.min(100, Math.max(0, hs.y)) / 100) * img.naturalHeight;
              ctx.drawImage(img, drawX, drawY);
            } else if (lastPackRef.current) {
              // New pack image still loading — draw the previous pack image
              // instead of flashing the built-in cursor.
              const prev = lastPackRef.current.img;
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

    // Click Ripples
    const now = performance.now();
    clickRipples.current = clickRipples.current.filter((r) => {
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

    // ── Mask Layers (blur, spotlight, magnifier) ──────────────────────────
    const videoTs = video.currentTime;
    for (const layer of config.layers) {
      if (layer.type !== "mask") continue;
      const ls = layer.start;
      const le = layer.end;
      if (videoTs < ls || videoTs > le) continue;

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
        // Dim the blurred region slightly so it reads as obscured
        ctx.fillStyle = "rgba(0,0,0,0.12)";
        ctx.fillRect(lx, ly, lw, lh);
        ctx.restore();
      } else if (layer.mask === "spotlight") {
        // TODO: spotlight mask not yet implemented in canvas renderer
      } else if (layer.mask === "magnifier") {
        // TODO: magnifier mask not yet implemented in canvas renderer
      }

      // Draw layer border when selected
      if (layer.id === selectedLayerId) {
        ctx.save();
        ctx.strokeStyle = "var(--accent, #3b82f6)";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(lx, ly, lw, lh);
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    // ── Crop Selection Overlay ────────────────────────────────────────────
    if (cropMode) {
      const drag = cropDrag.current;
      let sel: { x: number; y: number; w: number; h: number } | null = null;
      if (drag) {
        sel = clampRect(drag.x0, drag.y0, drag.x1, drag.y1, offsetX, offsetY, videoW, videoH);
      } else if (config.crop) {
        sel = {
          x: offsetX + config.crop.x * videoW,
          y: offsetY + config.crop.y * videoH,
          w: config.crop.w * videoW,
          h: config.crop.h * videoH,
        };
      }
      ctx.save();
      ctx.fillStyle = colorsRef.current.crop;
      if (sel) {
        ctx.fillRect(0, 0, cw, sel.y);
        ctx.fillRect(0, sel.y, sel.x, sel.h);
        ctx.fillRect(sel.x + sel.w, sel.y, cw - sel.x - sel.w, sel.h);
        ctx.fillRect(0, sel.y + sel.h, cw, ch - sel.y - sel.h);
        ctx.strokeStyle = colorsRef.current.border;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
        ctx.setLineDash([]);
      } else {
        ctx.fillRect(0, 0, cw, ch);
      }
      ctx.restore();
    }

    // Spawn click ripples for clicks the playhead crossed since the last frame.
    if (playing) {
      const prev = prevPlayRef.current < 0 ? ts : prevPlayRef.current;
      prevPlayRef.current = ts;
      // If the playhead jumped (seek), don't spawn a burst for every click.
      const jumped = Math.abs(ts - prev) > 300;
      spawnClickRipples(jumped ? ts : prev, ts, vw, vh);
    } else {
      prevPlayRef.current = -1;
    }

    if (Math.abs(video.currentTime - prevTimeRef.current / 1000) >= 0.05) {
      onTimeUpdate(video.currentTime);
      prevTimeRef.current = ts;
    }
  }, [
    canvasSize, config, keyframes, playing,
    getCursorAt, onTimeUpdate, screenToVideo, spawnClickRipples, currentZoom
  ]);
  renderRef.current = render;

  // Track wallpaper changes so the render can crossfade old → new.
  useEffect(() => {
    if (config.bgType === "image" && config.wallpaperUrl) {
      if (wallpaperRef.current && wallpaperRef.current.path !== config.wallpaperUrl) {
        fadeRef.current = { start: performance.now() };
      }
    }
  }, [config.bgType, config.wallpaperUrl]);

  // Preload the selected pack image so the overlay swaps in on the next frame
  useEffect(() => {
    const pack = config.cursorStyle.pack;
    if (pack) loadCursorImage(pack.imageUrl, cursorImages.current);
  }, [config.cursorStyle.pack]);

  // Preload the selected wallpaper image
  useEffect(() => {
    if (config.bgType === "image" && config.wallpaperUrl) {
      getWallpaperImage(config.wallpaperUrl, wallpaperImages.current);
    }
  }, [config.bgType, config.wallpaperUrl]);

  // ── Crop mode: mouse drag to define the crop rect ─────────────────────────
  const canvasToBacking = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const g = geomRef.current;
    if (!canvas) return { x: clientX, y: clientY };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (g.cw / Math.max(1, rect.width)),
      y: (clientY - rect.top) * (g.ch / Math.max(1, rect.height)),
    };
  }, []);

  const handleCropMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!cropMode) return;
      e.preventDefault();
      e.stopPropagation();
      const p = canvasToBacking(e.clientX, e.clientY);
      cropDrag.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    },
    [cropMode, canvasToBacking]
  );

  const handleCropMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!cropMode || !cropDrag.current) return;
      const p = canvasToBacking(e.clientX, e.clientY);
      cropDrag.current.x1 = p.x;
      cropDrag.current.y1 = p.y;
    },
    [cropMode, canvasToBacking]
  );

  const handleCropMouseUp = useCallback(() => {
    const drag = cropDrag.current;
    cropDrag.current = null;
    if (!drag || !cropMode || !onCropApply) return;
    const g = geomRef.current;
    const rect = clampRect(drag.x0, drag.y0, drag.x1, drag.y1, g.offsetX, g.offsetY, g.videoW, g.videoH);
    if (rect.w < 8 || rect.h < 8) {
      onCropApply(null);
    } else {
      onCropApply({
        x: (rect.x - g.offsetX) / g.videoW,
        y: (rect.y - g.offsetY) / g.videoH,
        w: rect.w / g.videoW,
        h: rect.h / g.videoH,
      });
    }
  }, [cropMode, onCropApply]);

  useEffect(() => {
    if (!cropMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCropCancel?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cropMode, onCropCancel]);

  // Stable rAF loop — always reads the latest render via renderRef, so config
  // changes (cursor style/pack) apply on the very next frame without restarting.
  useEffect(() => {
    const loop = () => {
      renderRef.current();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

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
    <div
      className={`preview-container ${cropMode ? "crop-mode" : ""}`}
      ref={containerRef}
      onMouseDown={handleCropMouseDown}
      onMouseMove={handleCropMouseMove}
      onMouseUp={handleCropMouseUp}
    >
      {loadError && <p className="preview-error">{loadError}</p>}
      <canvas
        ref={canvasRef}
        width={canvasSize.w}
        height={canvasSize.h}
        className="preview-canvas"
        style={{ cursor: cropMode ? "crosshair" : undefined }}
      />
      <div className="preview-controls" onClick={togglePlay}>
        <div className={`play-overlay ${playing ? "hidden" : ""}`}>
          <Play size={44} fill="currentColor" />
        </div>
      </div>
      {cropMode && (
        <div className="crop-hint">
          Drag to crop region • Esc to cancel • tiny click to reset
        </div>
      )}
      {config.zoomEnabled && keyframes.length > 0 && currentZoom > 1.02 && (
        <div className="zoom-badge">{Math.round(currentZoom * 100)}%</div>
      )}
      <video
        ref={videoRef}
        id="preview-video"
        src={videoUrl}
        style={{ display: "none" }}
        onLoadedMetadata={onMetadata}
        onError={(e) => {
          const el = e.currentTarget as HTMLVideoElement;
          const err = el.error;
          setLoadError(`Video failed to load: ${err?.message || err?.code || "unknown error"}`);
          console.error("[Snap Preview] video load error:", err);
        }}
      />
    </div>
  );
}

// Helpers
function clampRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  minX: number,
  minY: number,
  maxW: number,
  maxH: number
): { x: number; y: number; w: number; h: number } {
  const a = Math.max(minX, Math.min(minX + maxW, x0));
  const b = Math.max(minX, Math.min(minX + maxW, x1));
  const c = Math.max(minY, Math.min(minY + maxH, y0));
  const d = Math.max(minY, Math.min(minY + maxH, y1));
  return {
    x: Math.min(a, b),
    y: Math.min(c, d),
    w: Math.abs(a - b),
    h: Math.abs(c - d),
  };
}

function loadCursorImage(path: string, cache: Map<string, HTMLImageElement>): HTMLImageElement {
  return loadCachedImage(path, cache);
}

function getWallpaperImage(path: string, cache: Map<string, HTMLImageElement>): HTMLImageElement {
  return loadCachedImage(path, cache);
}
