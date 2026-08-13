import { useRef, useCallback, useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Play, Pause, ChevronDown, ChevronUp } from "lucide";
import { MorphIcon } from "morphicons/react";
import { RectangleHorizontal, Crop, SkipBack, SkipForward, Scissors, ZoomIn, ZoomOut, Film, Undo2, Redo2, Copy, Trash2, SlidersHorizontal } from "lucide-react";
import type { Keyframe, EditorConfig, ZoomRegionSelection, Layer } from "../../../lib/types";
import { ASPECT_RATIOS } from "../../../lib/types";
import { collectZoomRegions } from "../../../lib/zoomRegions";
import "./Timeline.css";

interface Props {
  videoPath: string;
  duration: number;
  currentTime: number;
  keyframes: Keyframe[];
  config: EditorConfig;
  playing: boolean;
  onTogglePlay: () => void;
  onSeek: (t: number) => void;
  onTrimStartChange: (t: number) => void;
  onTrimEndChange: (t: number) => void;
  onCutsChange: (cuts: number[]) => void;
  onAspectChange: (ar: { width: number; height: number } | null) => void;
  onToggleCrop: () => void;
  cropActive: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onKeyframesChange: (keyframes: Keyframe[]) => void;
  onAudioMuteChange: (track: "system" | "mic", muted: boolean) => void;
  selectedZoomRegion: ZoomRegionSelection | null;
  onZoomRegionSelect: (region: ZoomRegionSelection) => void;
  onZoomRegionDuplicate: (region: ZoomRegionSelection) => void;
  onZoomRegionDelete: (region: ZoomRegionSelection) => void;
  layers: Layer[];
  selectedLayerId: string | null;
  onLayerSelect: (id: string) => void;
  onLayerChange: (layer: Layer) => void;
  onLayerDuplicate: (id: string) => void;
  onLayerDelete: (id: string) => void;
}

interface ZoomSegment {
  start: number;
  end: number;
  scale: number;
  firstIndex: number;
  lastZoomIndex: number;
  resetIndex: number | null;
  memberIndices: number[];
  source: "auto" | "manual";
  regionId?: string;
}

export default function Timeline({
  videoPath,
  duration,
  currentTime,
  keyframes,
  config,
  playing,
  onTogglePlay,
  onSeek,
  onTrimStartChange,
  onTrimEndChange,
  onCutsChange,
  onAspectChange,
  onToggleCrop,
  cropActive,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onKeyframesChange,
  onAudioMuteChange,
  selectedZoomRegion,
  onZoomRegionSelect,
  onZoomRegionDuplicate,
  onZoomRegionDelete,
  layers,
  selectedLayerId,
  onLayerSelect,
  onLayerChange,
  onLayerDuplicate,
  onLayerDelete,
}: Props) {
  const [dragging, setDragging] = useState<"playhead" | "trim-start" | "trim-end" | null>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const [showAspectMenu, setShowAspectMenu] = useState(false);
  const [waveforms, setWaveforms] = useState<{ sys?: number[]; mic?: number[] }>({});
  const [contentWidth, setContentWidth] = useState(600);
  const [timelineHeight, setTimelineHeight] = useState(240);
  const [contextMenu, setContextMenu] = useState<
    | { kind: "zoom"; x: number; y: number; region: ZoomRegionSelection }
    | { kind: "layer"; x: number; y: number; layer: Layer }
    | null
  >(null);

  const dragCleanupRef = useRef<(() => void) | null>(null);
  const timeAreaRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Clean up drag listeners on unmount
  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [contextMenu]);
  const [hasSys, setHasSys] = useState(false);
  const [hasMic, setHasMic] = useState(false);
  const [hasDeviceAudio, setHasDeviceAudio] = useState(false);

  // Detect sidecar audio files + build RMS waveforms for each track
  useEffect(() => {
    (async () => {
      try {
        const lastSlash = Math.max(videoPath.lastIndexOf("\\"), videoPath.lastIndexOf("/"));
        const dir = lastSlash >= 0 ? videoPath.substring(0, lastSlash) : ".";
        const fileName = lastSlash >= 0 ? videoPath.substring(lastSlash + 1) : videoPath;
        const baseName = fileName.replace(/\.[^.]+$/, "");
        const audioDir = `${dir}\\${baseName}`;
        const files = await invoke<Array<{ name: string; path: string; is_dir: boolean; size: number }>>("list_directory", { path: audioDir });

        const sysPath = `${audioDir}\\system_audio.wav`;
        const devicePath = `${audioDir}\\device_audio.wav`;
        const micPath = `${audioDir}\\mic_audio.wav`;
        const hasDeviceFile = files.some((f) => f.path === devicePath && f.size > 44);
        const hasSysFile = hasDeviceFile || files.some((f) => f.path === sysPath && f.size > 44);
        const hasMicFile = files.some((f) => f.path === micPath && f.size > 0);

        setHasSys(hasSysFile);
        setHasMic(hasMicFile);
        setHasDeviceAudio(hasDeviceFile);

        const wfs: { sys?: number[]; mic?: number[] } = {};
        if (hasSysFile) wfs.sys = await loadWaveform(hasDeviceFile ? devicePath : sysPath);
        if (hasMicFile) wfs.mic = await loadWaveform(micPath);
        setWaveforms(wfs);
      } catch {
        setHasSys(false);
        setHasMic(false);
        setHasDeviceAudio(false);
        setWaveforms({});
      }
    })();
  }, [videoPath]);

  // Track the timeline width once so px-per-second stays stable
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setContentWidth(Math.max(0, el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const effectiveWidth = Math.max(1, contentWidth * zoomScale);

  const zoomSegments = useMemo(() => {
    return collectZoomRegions(keyframes, Math.round((config.trimEnd || duration) * 1000)).map((region): ZoomSegment => ({
      start: region.startMs / 1000,
      end: region.endMs / 1000,
      scale: region.scale,
      firstIndex: region.zoomIndices[0],
      lastZoomIndex: region.zoomIndices[region.zoomIndices.length - 1],
      resetIndex: region.resetIndex,
      memberIndices: region.memberIndices,
      source: region.source ?? "auto",
      regionId: region.regionId,
    }));
  }, [keyframes, config.trimEnd, duration]);

  const visibleLayerTypes = useMemo(
    () => (["text", "shape", "mask"] as Layer["type"][]).filter((type) => layers.some((layer) => layer.type === type)),
    [layers]
  );

  const beginZoomEdit = (event: React.PointerEvent, segment: ZoomSegment, mode: "move" | "start" | "end") => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onZoomRegionSelect({ startMs: Math.round(segment.start * 1000), endMs: Math.round(segment.end * 1000), regionId: segment.regionId });
    const startX = event.clientX;
    const initial = keyframes.map((frame) => ({ ...frame }));
    const editingSegment: ZoomSegment = { ...segment, memberIndices: [...segment.memberIndices] };
    const minTimeMs = Math.max(0, config.trimStart * 1000);
    const maxTimeMs = Math.max(minTimeMs + 100, (config.trimEnd || duration) * 1000);
    const startMs = segment.start * 1000;
    const endMs = segment.end * 1000;
    const segmentDurationMs = Math.max(1, endMs - startMs);
    const minSegmentMs = Math.min(350, segmentDurationMs);
    const bar = (event.currentTarget as HTMLElement).closest<HTMLElement>(".zoom-segment-bar");
    if (!bar || duration <= 0) return;

    // A trailing zoom with no explicit reset is normalized into a regular
    // editable segment the first time it is manipulated.
    if (editingSegment.resetIndex === null) {
      editingSegment.resetIndex = initial.length;
      editingSegment.memberIndices.push(initial.length);
      initial.push({ time: Math.round(endMs), duration: 400, x: 0.5, y: 0.5, scale: 1, easing: "ease-in-out", source: editingSegment.source, regionId: editingSegment.regionId });
    }
    const previousEndMs = zoomSegments
      .filter((candidate) => candidate !== segment && candidate.end <= segment.start)
      .reduce((latest, candidate) => Math.max(latest, candidate.end * 1000 + 50), minTimeMs);
    const nextStartMs = zoomSegments
      .filter((candidate) => candidate !== segment && candidate.start >= segment.end)
      .reduce((earliest, candidate) => Math.min(earliest, candidate.start * 1000 - 50), maxTimeMs);

    let pendingKeyframes: Keyframe[] | null = null;
    let animationFrame = 0;
    let visualStartMs = startMs;
    let visualEndMs = endMs;
    bar.classList.add("editing");

    const paintBar = () => {
      animationFrame = 0;
      bar.style.left = `${x(visualStartMs / 1000)}px`;
      bar.style.width = `${Math.max(18, w((visualEndMs - visualStartMs) / 1000))}px`;
    };

    const onMove = (moveEvent: PointerEvent) => {
      const area = timeAreaRef.current;
      if (!area || duration <= 0) return;
      const deltaMs = ((moveEvent.clientX - startX) / area.getBoundingClientRect().width) * duration * 1000;
      const next = initial.map((frame) => ({ ...frame }));

      if (mode === "move") {
        const boundedDelta = Math.max(previousEndMs - startMs, Math.min(nextStartMs - endMs, deltaMs));
        editingSegment.memberIndices.forEach((index) => {
          next[index].time = Math.round(next[index].time + boundedDelta);
        });
        visualStartMs = startMs + boundedDelta;
        visualEndMs = endMs + boundedDelta;
      } else if (mode === "start") {
        const latestStart = Math.max(previousEndMs, endMs - minSegmentMs);
        const desired = Math.max(previousEndMs, Math.min(latestStart, startMs + deltaMs));
        const ratio = (endMs - desired) / segmentDurationMs;
        editingSegment.memberIndices.forEach((index) => {
          const original = initial[index];
          next[index].time = Math.round(endMs - (endMs - original.time) * ratio);
          if (original.duration > 0) next[index].duration = Math.max(40, Math.round(original.duration * ratio));
        });
        visualStartMs = desired;
        visualEndMs = endMs;
      } else {
        const desired = Math.round(Math.max(startMs + minSegmentMs, Math.min(nextStartMs, endMs + deltaMs)));
        const ratio = (desired - startMs) / segmentDurationMs;
        editingSegment.memberIndices.forEach((index) => {
          const original = initial[index];
          next[index].time = Math.round(startMs + (original.time - startMs) * ratio);
          if (original.duration > 0) next[index].duration = Math.max(40, Math.round(original.duration * ratio));
        });
        visualStartMs = startMs;
        visualEndMs = desired;
      }

      pendingKeyframes = next.sort((a, b) => a.time - b.time);
      if (!animationFrame) animationFrame = requestAnimationFrame(paintBar);
    };

    const cleanup = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      if (animationFrame) cancelAnimationFrame(animationFrame);
      bar.classList.remove("editing");
      dragCleanupRef.current = null;
    };

    const onUp = () => {
      cleanup();
      if (pendingKeyframes) {
        onKeyframesChange(pendingKeyframes);
        onZoomRegionSelect({ startMs: Math.round(visualStartMs), endMs: Math.round(visualEndMs), regionId: editingSegment.regionId });
      }
    };
    const onCancel = () => {
      cleanup();
      bar.style.left = `${x(startMs / 1000)}px`;
      bar.style.width = `${Math.max(18, w(segmentDurationMs / 1000))}px`;
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    dragCleanupRef.current = cleanup;
  };

  const beginLayerEdit = (event: React.PointerEvent, layer: Layer, mode: "move" | "start" | "end") => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onLayerSelect(layer.id);
    const bar = (event.currentTarget as HTMLElement).closest<HTMLElement>(".layer-clip-bar");
    if (!bar || duration <= 0) return;
    const startX = event.clientX;
    const initialStart = layer.start;
    const initialEnd = layer.end;
    const layerDuration = Math.max(0.2, initialEnd - initialStart);
    const minTime = Math.max(0, config.trimStart);
    const maxTime = Math.max(minTime + 0.2, config.trimEnd || duration);
    let visualStart = initialStart;
    let visualEnd = initialEnd;
    let pending: Layer | null = null;
    let animationFrame = 0;
    bar.classList.add("editing");

    const paint = () => {
      animationFrame = 0;
      bar.style.left = `${x(visualStart)}px`;
      bar.style.width = `${Math.max(18, w(visualEnd - visualStart))}px`;
    };
    const onMove = (moveEvent: PointerEvent) => {
      const area = timeAreaRef.current;
      if (!area) return;
      const delta = ((moveEvent.clientX - startX) / area.getBoundingClientRect().width) * duration;
      if (mode === "move") {
        const bounded = Math.max(minTime - initialStart, Math.min(maxTime - initialEnd, delta));
        visualStart = initialStart + bounded;
        visualEnd = initialEnd + bounded;
      } else if (mode === "start") {
        visualStart = Math.max(minTime, Math.min(initialEnd - 0.2, initialStart + delta));
        visualEnd = initialEnd;
      } else {
        visualStart = initialStart;
        visualEnd = Math.max(initialStart + 0.2, Math.min(maxTime, initialEnd + delta));
      }
      pending = { ...layer, start: Math.round(visualStart * 100) / 100, end: Math.round(visualEnd * 100) / 100 };
      if (!animationFrame) animationFrame = requestAnimationFrame(paint);
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      if (animationFrame) cancelAnimationFrame(animationFrame);
      bar.classList.remove("editing");
      dragCleanupRef.current = null;
    };
    const onUp = () => { cleanup(); if (pending) onLayerChange(pending); };
    const onCancel = () => {
      cleanup();
      bar.style.left = `${x(initialStart)}px`;
      bar.style.width = `${Math.max(18, w(layerDuration))}px`;
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    dragCleanupRef.current = cleanup;
  };

  const beginResize = (event: React.MouseEvent) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = timelineHeight;
    const move = (e: MouseEvent) => setTimelineHeight(Math.max(190, Math.min(620, startHeight - (e.clientY - startY))));
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  useEffect(() => {
    if (!playing || zoomScale <= 1) return;
    const scroller = scrollRef.current;
    if (!scroller || duration <= 0) return;
    const playheadX = (currentTime / duration) * effectiveWidth;
    const margin = Math.min(120, scroller.clientWidth * 0.2);
    if (playheadX < scroller.scrollLeft + margin) {
      scroller.scrollLeft = Math.max(0, playheadX - margin);
    } else if (playheadX > scroller.scrollLeft + scroller.clientWidth - margin) {
      scroller.scrollLeft = playheadX - scroller.clientWidth + margin;
    }
  }, [currentTime, duration, effectiveWidth, playing, zoomScale]);

  const handleScissorCut = () => {
    if (duration <= 0) return;
    const cutPoint = Math.round(currentTime * 100) / 100;
    if (cutPoint <= config.trimStart || cutPoint >= (config.trimEnd || duration)) return;
    if (config.cuts.includes(cutPoint)) return;

    const newCuts = [...config.cuts, cutPoint].sort((a, b) => a - b);
    onCutsChange(newCuts);
  };

  const getTimeFromEvent = useCallback(
    (e: MouseEvent | React.MouseEvent): number => {
      const el = timeAreaRef.current;
      if (!el || duration <= 0) return 0;
      const rect = el.getBoundingClientRect();
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
      const swallowClick = (ev: MouseEvent) => {
        ev.stopPropagation();
        document.removeEventListener("click", swallowClick, true);
      };
      document.addEventListener("click", swallowClick, true);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    dragCleanupRef.current = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  };

  // Position helpers — all measured in the timeline (time) column space
  const x = (t: number): number => (duration > 0 ? (t / duration) * effectiveWidth : 0);
  const w = (t: number): number => (duration > 0 ? (t / duration) * effectiveWidth : 0);

  const currentAspectLabel = ASPECT_RATIOS.find((ar) =>
    (config.aspectRatio === null && ar.width === 0) ||
    (config.aspectRatio?.width === ar.width && config.aspectRatio?.height === ar.height)
  )?.label || "Wide 16:9";

  const menuPosition = (event: React.MouseEvent) => ({
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - 196)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - 142)),
  });

  return (
    <div className="ss-timeline-container" style={{ height: `${timelineHeight}px` }}>
      <div className="timeline-resize-edge" onMouseDown={beginResize} title="Drag the timeline edge to resize" />
      {/* ── Screen Studio Toolbar ──────────────────────────────────── */}
      <div className="ss-timeline-toolbar">
        <div className="tb-left-group">
          <div className="aspect-menu-wrap">
            <button
              className="ss-tb-btn aspect-btn"
              onClick={() => setShowAspectMenu(!showAspectMenu)}
            >
              <RectangleHorizontal size={16} />
              <span>{currentAspectLabel}</span>
              <MorphIcon icon={showAspectMenu ? ChevronUp : ChevronDown} spring="snappy" size={14} />
            </button>

            {showAspectMenu && (
              <div className="aspect-dropdown-menu">
                {ASPECT_RATIOS.map((ar) => (
                  <button
                    key={ar.label}
                    className="aspect-item"
                    onClick={() => {
                      onAspectChange(ar.width > 0 ? { width: ar.width, height: ar.height } : null);
                      setShowAspectMenu(false);
                    }}
                  >
                    {ar.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            className={`ss-tb-btn crop-btn ${cropActive ? "active" : ""}`}
            onClick={onToggleCrop}
            title={cropActive ? "Finish crop" : "Crop Canvas Region"}
          >
            <Crop size={16} />
            <span>Crop</span>
          </button>
        </div>

        {/* Center Transport Controls & Timecode */}
        <div className="tb-center-group">
          <span className="tb-timecode-text">{formatTimecode(currentTime)}</span>

          <div className="tb-transport-buttons">
            <button className="tb-transport-btn" onClick={() => onSeek(0)} title="Jump to Start">
              <SkipBack size={16} fill="currentColor" />
            </button>

            <button
              className={`tb-play-icon-btn ${playing ? "is-playing" : "is-paused"}`}
              onClick={onTogglePlay}
              title={playing ? "Pause" : "Play"}
              aria-label={playing ? "Pause preview" : "Play preview"}
            >
              <span className="tb-play-morph-icon" aria-hidden="true">
                <MorphIcon icon={playing ? Pause : Play} spring="snappy" size={19} />
              </span>
            </button>

            <button className="tb-transport-btn" onClick={() => onSeek(duration)} title="Jump to End">
              <SkipForward size={16} fill="currentColor" />
            </button>
          </div>

          <span className="tb-timecode-text total">{formatTimecode(duration)}</span>
        </div>

        {/* Right Tools (Scissor cut & Zoom scale) */}
        <div className="tb-right-group">
          <button className="ss-tb-btn primary-scissor-btn" onClick={handleScissorCut} title="Split Clip at Playhead (C)">
            <Scissors size={16} />
          </button>

          <button className="zoom-step-btn history-btn" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)"><Undo2 size={16} /></button>
          <button className="zoom-step-btn history-btn" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)"><Redo2 size={16} /></button>

          <div className="timeline-zoom-slider-wrap">
            <button className="zoom-step-btn" onClick={() => setZoomScale(Math.max(1, zoomScale - 0.5))} title="Zoom Out">
              <ZoomOut size={15} />
            </button>
            <input
              type="range"
              min={1}
              max={4}
              step={0.5}
              value={zoomScale}
              onChange={(e) => setZoomScale(Number(e.target.value))}
            />
            <button className="zoom-step-btn" onClick={() => setZoomScale(Math.min(4, zoomScale + 0.5))} title="Zoom In">
              <ZoomIn size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Multi-Track Area (Video / Audio / Zoom layers) ──────────── */}
      <div className="ss-tracks-wrapper">
        {/* Left label rail */}
        <div className="ss-labels-col">
          <div className="track-label video-label">Video</div>
          <div className="track-label audio-label">
            <button
              className={`track-label-button ${config.audio.systemMuted ? "muted" : ""}`}
              onClick={() => onAudioMuteChange("system", !config.audio.systemMuted)}
              title={config.audio.systemMuted ? `Unmute ${hasDeviceAudio ? "device" : "desktop"} audio` : `Mute ${hasDeviceAudio ? "device" : "desktop"} audio`}
            >
              <span>{hasDeviceAudio ? "Device" : "Desktop"}</span>
              <span className="audio-state-dot" aria-hidden="true" />
            </button>
          </div>
          <div className="track-label audio-label">
            <button
              className={`track-label-button ${config.audio.micMuted ? "muted" : ""}`}
              onClick={() => onAudioMuteChange("mic", !config.audio.micMuted)}
              title={config.audio.micMuted ? "Unmute microphone" : "Mute microphone"}
            >
              <span>Mic</span>
              <span className="audio-state-dot" aria-hidden="true" />
            </button>
          </div>
          <div className="track-label zoom-label">Zoom</div>
          {visibleLayerTypes.map((type) => (
            <div key={type} className={`track-label layer-label ${type}-label`}>
              {type === "shape" ? "Shapes" : type === "mask" ? "Masks" : "Text"}
            </div>
          ))}
        </div>

        {/* Shared timeline columns */}
        <div className={`ss-timeline-scroll ${zoomScale > 1 ? "is-zoomed" : ""}`} ref={scrollRef}>
        <div className="ss-timeline-col" ref={timeAreaRef} style={{ width: `${effectiveWidth}px` }} onClick={(e) => onSeek(getTimeFromEvent(e))}>
          {/* Video layer */}
          <div className="ss-track-row video-track">
            <div
              className="amber-clip-block"
              style={{
                left: x(config.trimStart),
                width: `${w((config.trimEnd || duration) - config.trimStart)}px`,
              }}
            >
              <div className="clip-tag-content">
                <Film size={12} />
                <span>Clip</span>
                <span className="clip-info">{Math.round(duration)}s</span>
              </div>
            </div>

            {config.cuts.map((cutTime, i) => (
              <div key={i} className="cut-marker-line" style={{ left: x(cutTime) }}>
                <div className="cut-marker-head" />
              </div>
            ))}
          </div>

          {/* System Audio layer */}
          <div className={`ss-track-row audio-track sys-audio ${hasSys ? "" : "empty"} ${config.audio.systemMuted ? "muted" : ""}`} title={hasSys ? `${hasDeviceAudio ? "Device" : "Desktop"} audio` : "No desktop audio was recorded"}>
            {hasSys ? <WaveRow data={waveforms.sys ?? pseudoWaveform()} /> : <span className="empty-track-label">No desktop audio</span>}
          </div>

          {/* Mic Audio layer */}
          <div className={`ss-track-row audio-track mic-audio ${hasMic ? "" : "empty"} ${config.audio.micMuted ? "muted" : ""}`} title={hasMic ? "Microphone audio" : "No microphone audio was recorded"}>
            {hasMic ? <WaveRow data={waveforms.mic ?? pseudoWaveform()} /> : <span className="empty-track-label">No microphone audio</span>}
          </div>

          {/* Zoom / Animation layer */}
          <div className="ss-track-row zoom-track">
            <div className="zoom-connecting-line" />
            {zoomSegments.map((segment, index) => (
              <div
                key={`zoom-${index}`}
                className={`zoom-segment-bar ${segment.source} ${selectedZoomRegion && (
                  selectedZoomRegion.regionId && segment.regionId
                    ? selectedZoomRegion.regionId === segment.regionId
                    : Math.abs(selectedZoomRegion.startMs - segment.start * 1000) < 2 && Math.abs(selectedZoomRegion.endMs - segment.end * 1000) < 2
                ) ? "selected" : ""}`}
                style={{ left: x(segment.start), width: Math.max(18, w(segment.end - segment.start)) }}
                onPointerDown={(event) => beginZoomEdit(event, segment, "move")}
                onClick={(event) => event.stopPropagation()}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const position = menuPosition(event);
                  setContextMenu({
                    kind: "zoom",
                    ...position,
                    region: { startMs: Math.round(segment.start * 1000), endMs: Math.round(segment.end * 1000), regionId: segment.regionId },
                  });
                }}
                title="Drag to move · drag either edge to change duration"
              >
                <button className="zoom-bar-handle left" onPointerDown={(event) => beginZoomEdit(event, segment, "start")} aria-label="Change zoom start" />
                <span><i className="zoom-source-dot" />{segment.scale.toFixed(1)}×</span>
                <button className="zoom-bar-handle right" onPointerDown={(event) => beginZoomEdit(event, segment, "end")} aria-label="Change zoom end" />
              </div>
            ))}
          </div>

          {visibleLayerTypes.map((type) => (
            <div key={type} className={`ss-track-row layer-track ${type}-track`}>
              <div className="layer-connecting-line" />
              {layers.filter((layer) => layer.type === type).map((layer) => {
                const name = layer.type === "text" ? layer.content || "Text" : layer.type === "shape" ? layer.shape : layer.mask;
                return (
                  <div
                    key={layer.id}
                    className={`layer-clip-bar ${type} ${selectedLayerId === layer.id ? "selected" : ""}`}
                    style={{ left: x(layer.start), width: Math.max(18, w(layer.end - layer.start)) }}
                    onPointerDown={(event) => beginLayerEdit(event, layer, "move")}
                    onClick={(event) => event.stopPropagation()}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setContextMenu({ kind: "layer", ...menuPosition(event), layer });
                    }}
                    title={`${name} · drag to move, trim either edge`}
                  >
                    <button className="layer-bar-handle left" onPointerDown={(event) => beginLayerEdit(event, layer, "start")} aria-label={`Change ${type} start`} />
                    <span>{name}</span>
                    <button className="layer-bar-handle right" onPointerDown={(event) => beginLayerEdit(event, layer, "end")} aria-label={`Change ${type} end`} />
                  </div>
                );
              })}
            </div>
          ))}

          {/* Trim handles + playhead overlay (span all layers) */}
          <div
            className={`ss-trim-handle in-handle ${dragging === "trim-start" ? "dragging" : ""}`}
            style={{ left: x(config.trimStart) }}
            onMouseDown={handleMouseDown("trim-start")}
          />
          <div
            className={`ss-trim-handle out-handle ${dragging === "trim-end" ? "dragging" : ""}`}
            style={{ left: x(config.trimEnd || duration) }}
            onMouseDown={handleMouseDown("trim-end")}
          />
          <div
            className={`ss-playhead-needle ${dragging === "playhead" ? "dragging" : ""}`}
            style={{ left: x(currentTime) }}
            onMouseDown={handleMouseDown("playhead")}
          >
            <div className="playhead-purple-cap" />
            <div className="playhead-line" />
          </div>
        </div>
        </div>
      </div>
      {contextMenu && createPortal(
        <div
          className="timeline-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          aria-label={`${contextMenu.kind} actions`}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button role="menuitem" onClick={() => {
            if (contextMenu.kind === "zoom") onZoomRegionSelect(contextMenu.region);
            else onLayerSelect(contextMenu.layer.id);
            setContextMenu(null);
          }}>
            <SlidersHorizontal size={15} /> Edit parameters
          </button>
          <button role="menuitem" onClick={() => {
            if (contextMenu.kind === "zoom") onZoomRegionDuplicate(contextMenu.region);
            else onLayerDuplicate(contextMenu.layer.id);
            setContextMenu(null);
          }}>
            <Copy size={15} /> Duplicate
          </button>
          <div className="timeline-context-separator" />
          <button className="danger" role="menuitem" onClick={() => {
            if (contextMenu.kind === "zoom") onZoomRegionDelete(contextMenu.region);
            else onLayerDelete(contextMenu.layer.id);
            setContextMenu(null);
          }}>
            <Trash2 size={15} /> Remove
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Audio waveform helpers ────────────────────────────────────────────────────

function WaveRow({ data }: { data: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const colorRef = useRef("#9aa3b2");

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const cs = getComputedStyle(canvas);
    colorRef.current = cs.getPropertyValue("--text-secondary").trim() || "#9aa3b2";
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const draw = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const wpx = Math.max(2, Math.floor(parent.clientWidth));
      const hpx = Math.max(2, Math.floor(parent.clientHeight));
      if (canvas.width !== wpx) canvas.width = wpx;
      if (canvas.height !== hpx) canvas.height = hpx;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, wpx, hpx);

      const n = data.length;
      if (n === 0) return;
      ctx.fillStyle = colorRef.current;
      const barW = wpx / n;
      for (let i = 0; i < n; i++) {
        const v = Math.max(0.04, Math.min(1, data[i]));
        const bh = Math.max(1, v * (hpx - 2));
        ctx.fillRect(i * barW, (hpx - bh) / 2, Math.max(1, barW - 0.5), bh);
      }
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas.parentElement!);
    window.addEventListener("resize", draw);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", draw);
    };
  }, [data]);

  return <canvas ref={ref} className="wave-canvas" />;
}

/** Deterministic pseudo-waveform fallback so empty/locked tracks still read clearly. */
function pseudoWaveform(): number[] {
  return Array.from({ length: 220 }, (_, i) => {
    const t = i / 220;
    const v =
      0.32 +
      0.26 * Math.abs(Math.sin(t * Math.PI * 9)) +
      0.18 * Math.abs(Math.sin(t * Math.PI * 23) * Math.exp(-t * 4)) +
      0.06 * Math.sin(t * Math.PI * 47);
    return Math.max(0.05, Math.min(1, v));
  });
}

async function loadWaveform(path: string): Promise<number[]> {
  try {
    const res = await fetch(convertFileSrc(path));
    const buf = await res.arrayBuffer();
    const rms = parseWavRms(buf, 220);
    if (rms.length > 0) return rms;
  } catch {
    // fall through to pseudo waveform
  }
  return pseudoWaveform();
}

function parseWavRms(buffer: ArrayBuffer, buckets: number): number[] {
  const dv = new DataView(buffer);
  if (dv.byteLength < 44 || dv.getUint32(0, true) !== 0x52494646) return []; // "RIFF"

  let offset = 12;
  let channels = 1;
  let bits = 16;
  let dataOffset = 0;
  let dataLen = 0;

  while (offset + 8 <= dv.byteLength) {
    const id = dv.getUint32(offset, true);
    const size = dv.getUint32(offset + 4, true);
    if (id === 0x666d7420) {
      // "fmt "
      channels = dv.getUint16(offset + 10, true);
      bits = dv.getUint16(offset + 22, true);
    } else if (id === 0x64617461) {
      // "data"
      dataOffset = offset + 8;
      dataLen = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }

  if (!dataLen) return [];
  const bytesPerSample = bits / 8;
  const frames = Math.floor(dataLen / bytesPerSample / channels);

  const out = new Array<number>(buckets).fill(0);
  const ofs = (f: number) => dataOffset + f * bytesPerSample * channels;

  for (let i = 0; i < buckets; i++) {
    const start = Math.floor((frames / buckets) * i);
    const end = Math.floor((frames / buckets) * (i + 1));
    let sum = 0;
    let count = 0;
    for (let f = start; f < end; f += 12) {
      const off = ofs(f);
      let sample = 0;
      if (bits === 16) sample = dv.getInt16(off, true) / 32768;
      else if (bits === 8) sample = (dv.getUint8(off) - 128) / 128;
      else if (bits === 24) {
        sample = ((dv.getUint8(off + 2) << 16) | (dv.getUint8(off + 1) << 8) | dv.getUint8(off)) / 8388607;
        if (sample > 1) sample -= 2;
      } else if (bits === 32) sample = Math.min(1, Math.abs(dv.getFloat32(off, true)));
      sum += sample * sample;
      count++;
    }
    out[i] = count ? Math.min(1, Math.sqrt(sum / Math.max(1, count))) : 0;
  }
  return out;
}

function formatTimecode(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00.00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 100);
  return `${m}:${sec.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}
