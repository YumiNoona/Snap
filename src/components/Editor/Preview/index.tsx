import { useEffect, useRef, useState, useCallback } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { CaptionTrack, InputEvent, Keyframe, EditorConfig, Layer } from "../../../lib/types";
import { generateKeyframes } from "../../../lib/autoZoom";
import { getMovementDuration } from "../../../lib/types";
import { getGradientPreset, getWallpaperPreset } from "../../../lib/wallpapers";
import { loadInputLog, getCursorAt as getCursorAtShared, screenToVideo as screenToVideoShared, hasClickNear } from "../../../lib/inputLog";
import { analyzeMobileVisualActivity } from "../../../lib/mobileAutoZoom";
import {
  loadCachedImage, paintGradient, paintImageCover, drawCursor, drawCursorImage,
  roundRect, computeCoverRect, resolveZoom, smoothTowards, drawClickEffect,
  clickEffectDuration, cursorIdleOpacity, drawTextLayer, drawShapeLayer,
  drawMaskLayer, drawVideoWithMotionBlur,
  drawCaptionTrack,
} from "../../../lib/canvasDraw";
import "./Preview.css";

interface Props {
  videoPath: string;
  inputLogPath: string;
  config: EditorConfig;
  keyframes: Keyframe[];
  onKeyframesChange: (kf: Keyframe[]) => void;
  playing: boolean;
  onDuration: (d: number) => void;
  onMediaElementChange?: (element: HTMLVideoElement | null) => void;
  cropMode?: boolean;
  onCropApply?: (crop: { x: number; y: number; w: number; h: number } | null) => void;
  onCropCancel?: () => void;
  selectedLayerId?: string | null;
  onLayerSelect?: (id: string | null) => void;
  onLayerChange?: (layer: Layer) => void;
  zoomTargetMode?: boolean;
  zoomFocusPoint?: { x: number; y: number } | null;
  zoomFocusSource?: "auto" | "manual";
  onZoomTargetPick?: (point: { x: number; y: number }, commit?: boolean) => void;
  autoZoomRevision?: number;
  autoZoomReady?: boolean;
  preserveProjectKeyframes?: boolean;
  captionTracks?: CaptionTrack[];
  hasExternalAudio?: boolean;
}

type GizmoHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

function rotatePoint(x: number, y: number, cx: number, cy: number, degrees: number) {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians), sin = Math.sin(radians);
  const dx = x - cx, dy = y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

function layerCanvasRect(layer: Layer, geometry: { offsetX: number; offsetY: number; videoW: number; videoH: number }) {
  const x = geometry.offsetX + layer.x * geometry.videoW;
  const y = geometry.offsetY + layer.y * geometry.videoH;
  const w = layer.w * geometry.videoW;
  const h = layer.h * geometry.videoH;
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

function pointInLayer(point: { x: number; y: number }, layer: Layer, geometry: { offsetX: number; offsetY: number; videoW: number; videoH: number }) {
  const rect = layerCanvasRect(layer, geometry);
  const local = rotatePoint(point.x, point.y, rect.cx, rect.cy, -(layer.rotation ?? 0));
  return local.x >= rect.x && local.x <= rect.x + rect.w && local.y >= rect.y && local.y <= rect.y + rect.h;
}

function gizmoHandlePoints(rect: ReturnType<typeof layerCanvasRect>): Array<{ handle: GizmoHandle; x: number; y: number }> {
  return [
    { handle: "nw", x: rect.x, y: rect.y },
    { handle: "n", x: rect.cx, y: rect.y },
    { handle: "ne", x: rect.x + rect.w, y: rect.y },
    { handle: "e", x: rect.x + rect.w, y: rect.cy },
    { handle: "se", x: rect.x + rect.w, y: rect.y + rect.h },
    { handle: "s", x: rect.cx, y: rect.y + rect.h },
    { handle: "sw", x: rect.x, y: rect.y + rect.h },
    { handle: "w", x: rect.x, y: rect.cy },
  ];
}

/** Return the first click strictly after the supplied media timestamp. */
function firstClickAfter(clicks: InputEvent[], timestampMs: number) {
  let low = 0;
  let high = clicks.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (clicks[middle].ts <= timestampMs) low = middle + 1;
    else high = middle;
  }
  return low;
}

export default function Preview({
  videoPath,
  inputLogPath,
  config,
  keyframes,
  onKeyframesChange,
  playing,
  onDuration,
  onMediaElementChange,
  cropMode = false,
  onCropApply,
  onCropCancel,
  selectedLayerId = null,
  onLayerSelect,
  onLayerChange,
  zoomTargetMode = false,
  zoomFocusPoint = null,
  zoomFocusSource = "manual",
  onZoomTargetPick,
  autoZoomRevision = 0,
  autoZoomReady = true,
  preserveProjectKeyframes = false,
  captionTracks = [],
  hasExternalAudio = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loadError, setLoadError] = useState("");
  const [videoReady, setVideoReady] = useState(false);
  const rafRef = useRef<number>(0);
  const decodedFrameCallbackRef = useRef<number | null>(null);
  const renderRef = useRef<() => void>(() => {});
  const cursorImages = useRef(new Map<string, HTMLImageElement>());
  const wallpaperImages = useRef(new Map<string, HTMLImageElement>());
  const cropDrag = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const zoomTargetDrag = useRef<{
    pointerId: number;
    pendingPoint: { x: number; y: number };
    animationFrame: number;
  } | null>(null);
  const geomRef = useRef({ offsetX: 0, offsetY: 0, videoW: 1280, videoH: 720, cw: 1280, ch: 720 });
  const sourceViewRef = useRef({ x: 0, y: 0, w: 1280, h: 720, baseX: 0, baseY: 0, baseW: 1280, baseH: 720 });
  const mouseMoveEvents = useRef<InputEvent[]>([]);
  const allEvents = useRef<InputEvent[]>([]);
  const clickEvents = useRef<InputEvent[]>([]);
  const clickIdxRef = useRef(0);
  const regionRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const inputSourceRef = useRef<string | null>(null);
  const clickRipples = useRef<{ x: number; y: number; ts: number }[]>([]);
  const prevPlayRef = useRef(-1);
  const effectTimelineTsRef = useRef(-1);
  const wallpaperRef = useRef<{ path: string; img: HTMLImageElement } | null>(null);
  const fadeRef = useRef<{ start: number }>({ start: 0 });
  const zoomFocusDisplayRef = useRef<{ x: number; y: number } | null>(null);
  const lastPackRef = useRef<{ path: string; img: HTMLImageElement } | null>(null);
  const smoothedCursorRef = useRef<{ x: number; y: number; ts: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 1280, h: 720 });
  const [eventsReady, setEventsReady] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(1.0);
  const [zoomTargetDragging, setZoomTargetDragging] = useState(false);
  const videoMetaRef = useRef<{ w: number; h: number; d: number } | null>(null);
  const kfGenerated = useRef(false);
  const generatedRevision = useRef(-1);
  const previousZoomRef = useRef<{ x: number; y: number; scale: number; ts: number } | null>(null);
  const previousCursorDrawRef = useRef<{ x: number; y: number } | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const maskSourceRef = useRef<HTMLCanvasElement | null>(null);
  const layerDrag = useRef<{
    mode: "move" | "resize" | "rotate";
    handle?: "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
    layer: Layer;
    startX: number;
    startY: number;
    centerX: number;
    centerY: number;
    startAngle: number;
  } | null>(null);

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
    inputSourceRef.current = null;
    clickRipples.current = [];
    prevPlayRef.current = -1;
    effectTimelineTsRef.current = -1;
    generatedRevision.current = -1;
  }, [inputLogPath]);

  // Load input log
  useEffect(() => {
    if (!inputLogPath) {
      allEvents.current = [];
      mouseMoveEvents.current = [];
      clickEvents.current = [];
      regionRef.current = null;
      inputSourceRef.current = null;
      setLoadError("");
      setEventsReady(true);
      return;
    }
    (async () => {
      try {
        const { allEvents: aligned, mouseMoveEvents: moves, clickEvents: clicks, region, source } =
          await loadInputLog(inputLogPath);
        allEvents.current = aligned;
        mouseMoveEvents.current = moves;
        clickEvents.current = clicks;
        regionRef.current = region;
        inputSourceRef.current = source;
        clickIdxRef.current = 0;
        clickRipples.current = [];
        prevPlayRef.current = -1;
        effectTimelineTsRef.current = -1;
        setEventsReady(true);
      } catch (e) {
        setLoadError(`Failed to load log: ${e}`);
      }
    })();
  }, [inputLogPath]);

  // Generate keyframes when ready
  useEffect(() => {
    if (!videoReady || !eventsReady || !autoZoomReady) return;
    if (preserveProjectKeyframes && autoZoomRevision === 0) {
      kfGenerated.current = true;
      generatedRevision.current = autoZoomRevision;
      return;
    }
    if (kfGenerated.current && generatedRevision.current === autoZoomRevision) return;
    const meta = videoMetaRef.current;
    if (!meta) return;
    kfGenerated.current = true;
    generatedRevision.current = autoZoomRevision;
    let cancelled = false;
    void (async () => {
      let zoomEvents = allEvents.current;
      if (zoomEvents.length === 0 && inputSourceRef.current === "mobile") {
        zoomEvents = await analyzeMobileVisualActivity(videoPath, meta.w, meta.h, meta.d * 1000);
      }
      if (cancelled || zoomEvents.length === 0) return;
      // Input hooks report desktop coordinates. Normalize them into the
      // captured video's pixel space so region/window recordings focus on the
      // actual click instead of drifting toward the desktop origin.
      const normalizedEvents = zoomEvents.map((event) => {
        if (typeof event.x !== "number" || typeof event.y !== "number") return event;
        const point = screenToVideoShared(regionRef.current, event.x, event.y, meta.w, meta.h);
        return { ...event, x: point.x, y: point.y };
      });
      const kf = generateKeyframes(
        normalizedEvents,
        meta.w,
        meta.h,
        meta.d * 1000,
        getMovementDuration(config.zoomMovement),
        config.autoZoom
      );
      if (!cancelled) onKeyframesChange(kf);
    })();
    return () => { cancelled = true; };
  }, [videoReady, eventsReady, onKeyframesChange, autoZoomRevision, config.zoomMovement, config.autoZoom, videoPath, autoZoomReady, preserveProjectKeyframes]);

  const playClickSound = useCallback(() => {
    if (!config.cursorStyle.clickSound || !playing) return;
    try {
      const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ac = audioContextRef.current ?? new AudioCtx();
      audioContextRef.current = ac;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(1150, ac.currentTime);
      osc.frequency.exponentialRampToValueAtTime(520, ac.currentTime + 0.07);
      gain.gain.setValueAtTime(0.12, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.09);
      osc.connect(gain).connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + 0.1);
    } catch {
      // Audio can be unavailable before WebView's user-gesture unlock.
    }
  }, [config.cursorStyle.clickSound, playing]);

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

  // Mobile recordings retain an embedded recovery audio stream and also have
  // an extracted editable sidecar. Keep preview playback in sync with the
  // timeline's primary audio controls.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // Desktop recordings keep audio in independent WAV sidecars. Mobile
    // recordings can also retain an embedded recovery stream, which must be
    // muted when the editable sidecar is present to avoid doubled audio.
    video.muted = hasExternalAudio || config.audio.systemMuted;
    video.volume = Math.max(0, Math.min(1, config.audio.systemVolume / 100));
  }, [config.audio.systemMuted, config.audio.systemVolume, hasExternalAudio, videoReady]);

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
      const visualsEnabled = config.cursorStyle.showClickRipples && config.cursorStyle.clickEffect !== "none";
      if (!visualsEnabled && !config.cursorStyle.clickSound) return;
      const clicks = clickEvents.current;
      let i = clickIdxRef.current;
      while (i < clicks.length && clicks[i].ts <= curTs) {
        const c = clicks[i];
        if (c.ts > prevTs && c.x != null && c.y != null) {
          const p = screenToVideo(c.x, c.y, vw, vh);
          if (visualsEnabled) {
            const ripples = clickRipples.current;
            ripples.push({ x: p.x, y: p.y, ts: c.ts });
            if (ripples.length > 12) ripples.shift();
          }
          playClickSound();
        }
        i++;
      }
      clickIdxRef.current = i;
    },
    [config.cursorStyle.showClickRipples, config.cursorStyle.clickEffect, config.cursorStyle.clickSound, screenToVideo, playClickSound]
  );

  // ── Render ──────────────────────────────────────────────────────────────
  const render = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || canvasSize.w === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const ts = video.currentTime * 1000;

    // Click effects use a forward-only event cursor for cheap playback. Keep
    // that cursor aligned with media time whenever replay, scrubbing, or a
    // decoder-recovery seek moves the playhead discontinuously. Without this,
    // the cursor remains at the end after the first pass and no click effect
    // (Christmas, ripple, spotlight, etc.) can appear on replay.
    const previousEffectTs = effectTimelineTsRef.current;
    const timelineJumped = previousEffectTs >= 0
      && (ts < previousEffectTs - 8 || ts > previousEffectTs + 350);
    if (timelineJumped) {
      clickIdxRef.current = firstClickAfter(clickEvents.current, ts);
      clickRipples.current = [];
      prevPlayRef.current = ts;
    }
    effectTimelineTsRef.current = ts;

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
    sourceViewRef.current = {
      x: coverX, y: coverY, w: coverW, h: coverH,
      baseX, baseY, baseW, baseH,
    };

    if (coverW > 0.5 && coverH > 0.5) {
      const prevZoom = previousZoomRef.current;
      const zoomDelta = prevZoom && ts >= prevZoom.ts && ts - prevZoom.ts < 100
        ? { x: (zoomX - prevZoom.x) * videoW, y: (zoomY - prevZoom.y) * videoH, scale: zoomScale - prevZoom.scale }
        : null;
      drawVideoWithMotionBlur(
        ctx,
        video,
        { x: coverX, y: coverY, w: coverW, h: coverH },
        { x: offsetX, y: offsetY, w: videoW, h: videoH },
        config.motionBlur,
        zoomDelta
      );
      previousZoomRef.current = { x: zoomX, y: zoomY, scale: zoomScale, ts };
    }

    if (config.inset > 0) {
      ctx.save();
      ctx.strokeStyle = config.insetColor;
      ctx.lineWidth = config.inset * 2;
      ctx.beginPath(); roundRect(ctx, offsetX, offsetY, videoW, videoH, clipR); ctx.stroke();
      ctx.restore();
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
        smoothedCursorRef.current = hasClickNear(clickEvents.current, ts)
          ? { ...rawCursor, ts }
          : smoothTowards(smoothedCursorRef.current, rawCursor, ts, durationMs);
        cursor = smoothedCursorRef.current;
      } else {
        smoothedCursorRef.current = null;
      }
      const idleAlpha = cursorIdleOpacity(mouseMoveEvents.current, ts, config.cursorStyle.hideWhenIdle);
      if (cursor && idleAlpha > 0) {
        const c = screenToVideo(cursor.x, cursor.y, vw, vh);
        const zoomedCursorX = (c.x - coverX) / coverW * videoW + offsetX;
        const zoomedCursorY = (c.y - coverY) / coverH * videoH + offsetY;
        if (zoomedCursorX >= offsetX && zoomedCursorX <= offsetX + videoW &&
            zoomedCursorY >= offsetY && zoomedCursorY <= offsetY + videoH) {
          ctx.save();
          ctx.globalAlpha = idleAlpha;
          const pack = config.cursorStyle.pack;
          const trailImage = pack ? loadCursorImage(pack.imageUrl, cursorImages.current) : null;
          const trailHotspot = pack ? (config.cursorHotspots[pack.id] ?? { x: 10, y: 10 }) : null;
          const prevCursor = previousCursorDrawRef.current;
          if (config.motionBlur.enabled && config.motionBlur.cursorAmount > 0 && prevCursor) {
            const dx = zoomedCursorX - prevCursor.x;
            const dy = zoomedCursorY - prevCursor.y;
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
          previousCursorDrawRef.current = { x: zoomedCursorX, y: zoomedCursorY };
          if (pack) {
            const img = loadCursorImage(pack.imageUrl, cursorImages.current);
            if (img && img.complete && img.naturalWidth > 0) {
              lastPackRef.current = { path: pack.imageUrl, img };
              const hs = config.cursorHotspots[pack.id] ?? { x: 10, y: 10 };
              drawCursorImage(ctx, img, zoomedCursorX, zoomedCursorY, config.cursorStyle.size, hs);
            } else if (lastPackRef.current) {
              // New pack image still loading — draw the previous pack image
              // instead of flashing the built-in cursor.
              const prev = lastPackRef.current.img;
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

    // Click Ripples
    clickRipples.current = clickRipples.current.filter((r) => {
      const age = (ts - r.ts) / 1000;
      if (age > clickEffectDuration(config.cursorStyle.clickEffect)) return false;
      const rx = (r.x - coverX) / coverW * videoW + offsetX;
      const ry = (r.y - coverY) / coverH * videoH + offsetY;
      drawClickEffect(ctx, rx, ry, age, config.cursorStyle.color, config.cursorStyle.clickEffect, r.ts);
      return true;
    });

    ctx.restore();

    // ── Timed annotation and mask layers ──────────────────────────────────
    const videoTs = video.currentTime;
    const activeLayers = config.layers.filter((layer) => videoTs >= layer.start - 0.02 && videoTs <= layer.end + 0.02);
    const activeMasks = activeLayers.filter((layer) => layer.type === "mask");

    // Masks sample the already-composited preview, not the raw video. This
    // keeps blur and magnification aligned with crop, pan/zoom, and styling.
    if (activeMasks.length > 0) {
      const maskSource = maskSourceRef.current ?? document.createElement("canvas");
      maskSourceRef.current = maskSource;
      if (maskSource.width !== cw) maskSource.width = cw;
      if (maskSource.height !== ch) maskSource.height = ch;
      const maskCtx = maskSource.getContext("2d");
      if (maskCtx) {
        maskCtx.clearRect(0, 0, cw, ch);
        maskCtx.drawImage(canvas, 0, 0);
        for (const layer of activeMasks) {
          if (layer.type !== "mask") continue;
          const lx = offsetX + layer.x * videoW;
          const ly = offsetY + layer.y * videoH;
          const lw = layer.w * videoW;
          const lh = layer.h * videoH;
          drawMaskLayer(
            ctx, layer, maskSource,
            { x: 0, y: 0, w: cw, h: ch },
            { x: 0, y: 0, w: cw, h: ch },
            { x: lx, y: ly, w: lw, h: lh }
          );
        }
      }
    }

    // Text and shapes always stay legible above masks.
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
      drawCaptionTrack(ctx, track, videoTs * 1000, { x: offsetX, y: offsetY, w: videoW, h: videoH });
    }

    // Selection affordance is drawn last so every layer type can be moved and
    // resized even when its effect changes the underlying pixels.
    for (const layer of activeLayers) {
      // Draw layer border when selected
      if (layer.id === selectedLayerId) {
        const lx = offsetX + layer.x * videoW;
        const ly = offsetY + layer.y * videoH;
        const lw = layer.w * videoW;
        const lh = layer.h * videoH;
        const cx = lx + lw / 2, cy = ly + lh / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((layer.rotation ?? 0) * Math.PI / 180);
        ctx.translate(-cx, -cy);
        ctx.strokeStyle = "rgba(96, 165, 250, .96)";
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.strokeRect(lx, ly, lw, lh);

        // Rotation is available for visual objects; masks stay axis-aligned so
        // their sampled pixels remain exact.
        if (layer.type !== "mask") {
          ctx.beginPath(); ctx.moveTo(cx, ly); ctx.lineTo(cx, ly - 26); ctx.stroke();
          ctx.fillStyle = "#0b1220";
          ctx.beginPath(); ctx.arc(cx, ly - 31, 8, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "#60a5fa"; ctx.lineWidth = 2; ctx.stroke();
          ctx.fillStyle = "#ffffff";
          ctx.beginPath(); ctx.arc(cx, ly - 31, 2.2, 0, Math.PI * 2); ctx.fill();
        }

        const handles = [
          [lx, ly], [cx, ly], [lx + lw, ly], [lx + lw, cy],
          [lx + lw, ly + lh], [cx, ly + lh], [lx, ly + lh], [lx, cy],
        ];
        for (const [hx, hy] of handles) {
          ctx.fillStyle = "#f8fafc";
          ctx.fillRect(hx - 5, hy - 5, 10, 10);
          ctx.strokeStyle = "#2563eb";
          ctx.lineWidth = 2;
          ctx.strokeRect(hx - 5, hy - 5, 10, 10);
        }
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

    if (zoomFocusPoint) {
      const display = zoomTargetMode
        ? { ...zoomFocusPoint }
        : zoomFocusDisplayRef.current ?? { ...zoomFocusPoint };
      if (!zoomTargetMode) {
        display.x += (zoomFocusPoint.x - display.x) * 0.2;
        display.y += (zoomFocusPoint.y - display.y) * 0.2;
      }
      zoomFocusDisplayRef.current = display;
      const focusSourceX = baseX + display.x * baseW;
      const focusSourceY = baseY + display.y * baseH;
      const focusX = offsetX + ((focusSourceX - coverX) / Math.max(1, coverW)) * videoW;
      const focusY = offsetY + ((focusSourceY - coverY) / Math.max(1, coverH)) * videoH;
      const isVisible = focusX >= offsetX - 12 && focusX <= offsetX + videoW + 12 &&
        focusY >= offsetY - 12 && focusY <= offsetY + videoH + 12;
      if (isVisible) {
        const pulse = (Math.sin(performance.now() / 170) + 1) / 2;
        const accent = zoomFocusSource === "auto" ? "139, 92, 246" : "59, 130, 246";
        ctx.save();
        ctx.shadowColor = `rgba(${accent}, 0.7)`;
        ctx.shadowBlur = 11 + pulse * 5;
        ctx.fillStyle = `rgb(${accent})`;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.96)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(focusX, focusY, zoomTargetMode ? 10 + pulse * 1.5 : 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = `rgba(${accent}, ${0.56 + pulse * 0.3})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(focusX, focusY, (zoomTargetMode ? 19 : 15) + pulse * 3, 0, Math.PI * 2);
        ctx.stroke();
        if (zoomTargetMode) {
          ctx.shadowBlur = 0;
          ctx.strokeStyle = `rgba(${accent}, .95)`;
          ctx.lineWidth = 2;
          for (const [x1, y1, x2, y2] of [[-29,0,-21,0],[29,0,21,0],[0,-29,0,-21],[0,29,0,21]]) {
            ctx.beginPath(); ctx.moveTo(focusX + x1, focusY + y1); ctx.lineTo(focusX + x2, focusY + y2); ctx.stroke();
          }
        }
        ctx.restore();
      }
    } else if (zoomTargetMode) {
      zoomFocusDisplayRef.current = null;
      ctx.save();
      ctx.strokeStyle = "#3b82f6"; ctx.fillStyle = "rgba(59,130,246,0.2)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(offsetX + videoW / 2, offsetY + videoH / 2, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
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

  }, [
    canvasSize, config, keyframes, captionTracks, playing, selectedLayerId, zoomTargetMode, zoomFocusPoint, zoomFocusSource,
    getCursorAt, screenToVideo, spawnClickRipples, currentZoom
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

  const zoomTargetFromClient = useCallback((clientX: number, clientY: number) => {
    const p = canvasToBacking(clientX, clientY);
    const g = geomRef.current;
    const view = sourceViewRef.current;
    const sourceX = view.x + ((p.x - g.offsetX) / Math.max(1, g.videoW)) * view.w;
    const sourceY = view.y + ((p.y - g.offsetY) / Math.max(1, g.videoH)) * view.h;
    return {
      x: Math.max(0, Math.min(1, (sourceX - view.baseX) / Math.max(1, view.baseW))),
      y: Math.max(0, Math.min(1, (sourceY - view.baseY) / Math.max(1, view.baseH))),
    };
  }, [canvasToBacking]);

  const handleCropMouseDown = useCallback(
    (e: React.PointerEvent) => {
      if (zoomTargetMode && onZoomTargetPick) {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        const point = zoomTargetFromClient(e.clientX, e.clientY);
        zoomTargetDrag.current = { pointerId: e.pointerId, pendingPoint: point, animationFrame: 0 };
        setZoomTargetDragging(true);
        // Publish immediately so a simple click remains responsive, then keep
        // the same edit session alive until pointerup for smooth dragging.
        onZoomTargetPick(point, false);
        return;
      }
      if (!cropMode) {
        const p = canvasToBacking(e.clientX, e.clientY);
        const g = geomRef.current;
        const time = videoRef.current?.currentTime ?? 0;
        const active = config.layers.filter((layer) => time >= layer.start - 0.02 && time <= layer.end + 0.02);
        const selected = active.find((layer) => layer.id === selectedLayerId) ?? null;
        let target = selected;
        let handle: GizmoHandle | undefined;
        let mode: "move" | "resize" | "rotate" = "move";

        if (selected) {
          const rect = layerCanvasRect(selected, g);
          const rotation = selected.rotation ?? 0;
          const rotationPoint = rotatePoint(rect.cx, rect.y - 31, rect.cx, rect.cy, rotation);
          if (selected.type !== "mask" && Math.hypot(p.x - rotationPoint.x, p.y - rotationPoint.y) <= 14) {
            mode = "rotate";
          } else {
            const hit = gizmoHandlePoints(rect).find((candidate) => {
              const point = rotatePoint(candidate.x, candidate.y, rect.cx, rect.cy, rotation);
              return Math.hypot(p.x - point.x, p.y - point.y) <= 12;
            });
            if (hit) { mode = "resize"; handle = hit.handle; }
            else if (!pointInLayer(p, selected, g)) target = null;
          }
        }

        if (!target) {
          target = [...active].reverse().find((layer) => pointInLayer(p, layer, g)) ?? null;
          mode = "move";
        }
        if (!target || !onLayerChange) {
          onLayerSelect?.(null);
          return;
        }
        if (target.id !== selectedLayerId) onLayerSelect?.(target.id);
        const rect = layerCanvasRect(target, g);
        e.preventDefault(); e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        layerDrag.current = {
          mode, handle, layer: { ...target }, startX: p.x, startY: p.y,
          centerX: rect.cx, centerY: rect.cy,
          startAngle: Math.atan2(p.y - rect.cy, p.x - rect.cx) * 180 / Math.PI,
        };
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const p = canvasToBacking(e.clientX, e.clientY);
      cropDrag.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    },
    [cropMode, zoomTargetMode, onZoomTargetPick, zoomTargetFromClient, canvasToBacking, config.layers, selectedLayerId, onLayerChange, onLayerSelect]
  );

  const handleCropMouseMove = useCallback(
    (e: React.PointerEvent) => {
      const p = canvasToBacking(e.clientX, e.clientY);
      const zoomDrag = zoomTargetDrag.current;
      if (zoomDrag && zoomTargetMode && onZoomTargetPick) {
        zoomDrag.pendingPoint = zoomTargetFromClient(e.clientX, e.clientY);
        if (!zoomDrag.animationFrame) {
          zoomDrag.animationFrame = requestAnimationFrame(() => {
            const active = zoomTargetDrag.current;
            if (!active) return;
            active.animationFrame = 0;
            onZoomTargetPick(active.pendingPoint, false);
          });
        }
        return;
      }
      if (layerDrag.current && onLayerChange) {
        const g = geomRef.current;
        const d = layerDrag.current;
        const dx = (p.x - d.startX) / g.videoW, dy = (p.y - d.startY) / g.videoH;
        if (d.mode === "move") {
          onLayerChange({ ...d.layer, x: Math.max(0, Math.min(1 - d.layer.w, d.layer.x + dx)), y: Math.max(0, Math.min(1 - d.layer.h, d.layer.y + dy)) });
        } else if (d.mode === "rotate") {
          const angle = Math.atan2(p.y - d.centerY, p.x - d.centerX) * 180 / Math.PI;
          const raw = (d.layer.rotation ?? 0) + angle - d.startAngle;
          const snapped = e.shiftKey ? Math.round(raw / 15) * 15 : raw;
          onLayerChange({ ...d.layer, rotation: ((snapped % 360) + 360) % 360 });
        } else if (d.handle) {
          const rect = layerCanvasRect(d.layer, g);
          const local = rotatePoint(p.x, p.y, rect.cx, rect.cy, -(d.layer.rotation ?? 0));
          let left = rect.x, right = rect.x + rect.w, top = rect.y, bottom = rect.y + rect.h;
          if (d.handle.includes("w")) left = Math.min(local.x, right - g.videoW * 0.04);
          if (d.handle.includes("e")) right = Math.max(local.x, left + g.videoW * 0.04);
          if (d.handle.includes("n")) top = Math.min(local.y, bottom - g.videoH * 0.04);
          if (d.handle.includes("s")) bottom = Math.max(local.y, top + g.videoH * 0.04);
          left = Math.max(g.offsetX, left); top = Math.max(g.offsetY, top);
          right = Math.min(g.offsetX + g.videoW, right); bottom = Math.min(g.offsetY + g.videoH, bottom);
          onLayerChange({
            ...d.layer,
            x: (left - g.offsetX) / g.videoW,
            y: (top - g.offsetY) / g.videoH,
            w: Math.max(0.04, (right - left) / g.videoW),
            h: Math.max(0.04, (bottom - top) / g.videoH),
          });
        }
        return;
      }
      if (!cropMode && !zoomTargetMode && canvasRef.current) {
        const time = videoRef.current?.currentTime ?? 0;
        const selected = config.layers.find((layer) => layer.id === selectedLayerId && time >= layer.start - .02 && time <= layer.end + .02);
        if (selected) {
          const g = geomRef.current;
          const rect = layerCanvasRect(selected, g);
          const rotation = selected.rotation ?? 0;
          const rotationPoint = rotatePoint(rect.cx, rect.y - 31, rect.cx, rect.cy, rotation);
          const hit = gizmoHandlePoints(rect).find((candidate) => {
            const point = rotatePoint(candidate.x, candidate.y, rect.cx, rect.cy, rotation);
            return Math.hypot(p.x - point.x, p.y - point.y) <= 12;
          });
          const cursors: Record<GizmoHandle, string> = { nw: "nwse-resize", n: "ns-resize", ne: "nesw-resize", e: "ew-resize", se: "nwse-resize", s: "ns-resize", sw: "nesw-resize", w: "ew-resize" };
          canvasRef.current.style.cursor = selected.type !== "mask" && Math.hypot(p.x - rotationPoint.x, p.y - rotationPoint.y) <= 14
            ? "grab"
            : hit ? cursors[hit.handle]
            : pointInLayer(p, selected, g) ? "move" : "default";
        }
      }
      if (!cropMode || !cropDrag.current) return;
      cropDrag.current.x1 = p.x;
      cropDrag.current.y1 = p.y;
    },
    [cropMode, zoomTargetMode, canvasToBacking, zoomTargetFromClient, onZoomTargetPick, onLayerChange, config.layers, selectedLayerId]
  );

  const handleCropMouseUp = useCallback((event?: React.PointerEvent) => {
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const zoomDrag = zoomTargetDrag.current;
    if (zoomDrag) {
      if (zoomDrag.animationFrame) cancelAnimationFrame(zoomDrag.animationFrame);
      zoomTargetDrag.current = null;
      setZoomTargetDragging(false);
      onZoomTargetPick?.(zoomDrag.pendingPoint, true);
      return;
    }
    if (layerDrag.current) { layerDrag.current = null; return; }
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
  }, [cropMode, onCropApply, onZoomTargetPick]);

  useEffect(() => () => {
    const drag = zoomTargetDrag.current;
    if (drag?.animationFrame) cancelAnimationFrame(drag.animationFrame);
  }, []);

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

  // `currentTime` and the decoded texture exposed by WebView2 are not always
  // advanced atomically. In particular, replaying an MP4 after it reaches the
  // end or seeking across fragments can move the media clock while
  // canvas.drawImage(video) still sees the old compositor texture. Render once
  // for every *presented* video frame as well as from the UI animation loop so
  // the canvas is invalidated at the exact point a new decoded frame exists.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoReady || typeof video.requestVideoFrameCallback !== "function") return;

    let disposed = false;
    const onPresentedFrame: VideoFrameRequestCallback = () => {
      if (disposed) return;
      renderRef.current();
      decodedFrameCallbackRef.current = video.requestVideoFrameCallback(onPresentedFrame);
    };
    decodedFrameCallbackRef.current = video.requestVideoFrameCallback(onPresentedFrame);

    // A paused seek and a decoder reload each produce a new frame without
    // necessarily entering the normal playing state. Repaint on those media
    // lifecycle edges too; the frame callback above will perform the final
    // paint once WebView2 presents the target frame.
    const invalidate = () => requestAnimationFrame(() => renderRef.current());
    video.addEventListener("loadeddata", invalidate);
    video.addEventListener("seeked", invalidate);
    video.addEventListener("canplay", invalidate);
    return () => {
      disposed = true;
      video.removeEventListener("loadeddata", invalidate);
      video.removeEventListener("seeked", invalidate);
      video.removeEventListener("canplay", invalidate);
      if (decodedFrameCallbackRef.current !== null) {
        video.cancelVideoFrameCallback(decodedFrameCallbackRef.current);
        decodedFrameCallbackRef.current = null;
      }
    };
  }, [videoPath, videoReady]);

  useEffect(() => {
    const onResize = () => {
      const video = videoRef.current;
      if (video && videoReady) computeCanvasSize(video.videoWidth, video.videoHeight);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [videoReady, computeCanvasSize]);

  const assignVideoElement = useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element;
    onMediaElementChange?.(element);
  }, [onMediaElementChange]);
  const videoUrl = videoPath.startsWith("/") || /^https?:\/\//i.test(videoPath) ? videoPath : convertFileSrc(videoPath);

  return (
    <div
      className={`preview-container ${cropMode ? "crop-mode" : ""} ${zoomTargetMode ? "zoom-target-mode" : ""} ${zoomTargetDragging ? "zoom-target-dragging" : ""}`}
      ref={containerRef}
      onPointerDown={handleCropMouseDown}
      onPointerMove={handleCropMouseMove}
      onPointerUp={handleCropMouseUp}
      onPointerCancel={handleCropMouseUp}
    >
      {loadError && <p className="preview-error">{loadError}</p>}
      <canvas
        ref={canvasRef}
        width={canvasSize.w}
        height={canvasSize.h}
        className="preview-canvas"
        style={{ cursor: cropMode ? "crosshair" : zoomTargetMode ? (zoomTargetDragging ? "grabbing" : "grab") : selectedLayerId ? "move" : undefined }}
      />
      {cropMode && (
        <div className="crop-hint">
          Drag to crop region • Esc to cancel • tiny click to reset
        </div>
      )}
      {zoomTargetMode && <div className="crop-hint">Drag anywhere to place the zoom focus • Esc to cancel</div>}
      {config.zoomEnabled && keyframes.length > 0 && currentZoom > 1.02 && (
        <div className="zoom-badge">{Math.round(currentZoom * 100)}%</div>
      )}
      <video
        ref={assignVideoElement}
        id="preview-video"
        src={videoUrl}
        preload="auto"
        playsInline
        className="preview-media-source"
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
  return loadCachedImage(getWallpaperPreset(path)?.previewUrl ?? path, cache);
}
