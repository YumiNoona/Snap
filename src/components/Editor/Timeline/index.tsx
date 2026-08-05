import { useRef, useCallback, useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { PlayCircle, PauseCircle, ChevronDown, ChevronUp } from "lucide";
import { MorphIcon } from "morphicons/react";
import { RectangleHorizontal, Crop, SkipBack, SkipForward, Scissors, ZoomIn, ZoomOut, Film } from "lucide-react";
import type { Keyframe, EditorConfig } from "../../../lib/types";
import { ASPECT_RATIOS } from "../../../lib/types";
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
}: Props) {
  const [dragging, setDragging] = useState<"playhead" | "trim-start" | "trim-end" | null>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const [showAspectMenu, setShowAspectMenu] = useState(false);
  const [waveforms, setWaveforms] = useState<{ sys?: number[]; mic?: number[] }>({});
  const [contentWidth, setContentWidth] = useState(600);

  const dragCleanupRef = useRef<(() => void) | null>(null);
  const timeAreaRef = useRef<HTMLDivElement>(null);

  // Clean up drag listeners on unmount
  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);
  const [hasSys, setHasSys] = useState(false);
  const [hasMic, setHasMic] = useState(false);

  // Detect sidecar audio files + build RMS waveforms for each track
  useEffect(() => {
    (async () => {
      try {
        const lastSlash = Math.max(videoPath.lastIndexOf("\\"), videoPath.lastIndexOf("/"));
        const dir = lastSlash >= 0 ? videoPath.substring(0, lastSlash) : ".";
        const fileName = lastSlash >= 0 ? videoPath.substring(lastSlash + 1) : videoPath;
        const baseName = fileName.replace(/\.[^.]+$/, "");
        const audioDir = `${dir}\\${baseName}`;
        const files = await invoke<Array<{ name: string; path: string; is_dir: boolean; size: number }>>("list_directory", { path: dir });

        const sysPath = `${audioDir}\\system_audio.wav`;
        const micPath = `${audioDir}\\mic_audio.wav`;
        const hasSysFile = files.some((f) => f.path === sysPath && f.size > 0);
        const hasMicFile = files.some((f) => f.path === micPath && f.size > 0);

        setHasSys(hasSysFile);
        setHasMic(hasMicFile);

        const wfs: { sys?: number[]; mic?: number[] } = {};
        if (hasSysFile) wfs.sys = await loadWaveform(sysPath);
        if (hasMicFile) wfs.mic = await loadWaveform(micPath);
        setWaveforms(wfs);
      } catch {
        setHasSys(false);
        setHasMic(false);
        setWaveforms({});
      }
    })();
  }, [videoPath]);

  // Track the timeline width once so px-per-second stays stable
  useEffect(() => {
    const el = timeAreaRef.current;
    if (!el) return;
    const measure = () => setContentWidth(Math.max(0, el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
  const x = (t: number): number => (duration > 0 ? (t / duration) * contentWidth : 0);
  const w = (t: number): number => (duration > 0 ? (t / duration) * contentWidth : 0);

  const currentAspectLabel = ASPECT_RATIOS.find((ar) =>
    (config.aspectRatio === null && ar.width === 0) ||
    (config.aspectRatio?.width === ar.width && config.aspectRatio?.height === ar.height)
  )?.label || "Wide 16:9";

  return (
    <div className="ss-timeline-container">
      {/* ── Screen Studio Toolbar ──────────────────────────────────── */}
      <div className="ss-timeline-toolbar">
        <div className="tb-left-group">
          <div className="aspect-menu-wrap">
            <button
              className="ss-tb-btn aspect-btn"
              onClick={() => setShowAspectMenu(!showAspectMenu)}
            >
              <RectangleHorizontal size={14} />
              <span>{currentAspectLabel}</span>
              <MorphIcon icon={showAspectMenu ? ChevronUp : ChevronDown} spring="snappy" size={12} />
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
            <Crop size={14} />
            <span>Crop</span>
          </button>
        </div>

        {/* Center Transport Controls & Timecode */}
        <div className="tb-center-group">
          <span className="tb-timecode-text">{formatTimecode(currentTime)}</span>

          <div className="tb-transport-buttons">
            <button className="tb-transport-btn" onClick={() => onSeek(0)} title="Jump to Start">
              <SkipBack size={14} fill="currentColor" />
            </button>

            <button className="tb-play-circle-btn" onClick={onTogglePlay} title={playing ? "Pause" : "Play"}>
              <MorphIcon icon={playing ? PauseCircle : PlayCircle} spring="snappy" size={18} />
            </button>

            <button className="tb-transport-btn" onClick={() => onSeek(duration)} title="Jump to End">
              <SkipForward size={14} fill="currentColor" />
            </button>
          </div>

          <span className="tb-timecode-text total">{formatTimecode(duration)}</span>
        </div>

        {/* Right Tools (Scissor cut & Zoom scale) */}
        <div className="tb-right-group">
          <button className="ss-tb-btn primary-scissor-btn" onClick={handleScissorCut} title="Split Clip at Playhead (C)">
            <Scissors size={14} />
          </button>

          <div className="timeline-zoom-slider-wrap">
            <button className="zoom-step-btn" onClick={() => setZoomScale(Math.max(1, zoomScale - 0.5))} title="Zoom Out">
              <ZoomOut size={13} />
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
              <ZoomIn size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Multi-Track Area (Video / Audio / Zoom layers) ──────────── */}
      <div className="ss-tracks-wrapper">
        {/* Left label rail */}
        <div className="ss-labels-col">
          <div className="track-label">Video</div>
          {hasSys && <div className="track-label">System</div>}
          {hasMic && <div className="track-label">Mic</div>}
          <div className="track-label">Zoom</div>
        </div>

        {/* Shared timeline columns */}
        <div className="ss-timeline-col" ref={timeAreaRef} onClick={(e) => getTimeFromEvent(e) && onSeek(getTimeFromEvent(e))}>
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
          {hasSys && (
            <div className="ss-track-row audio-track sys-audio">
              <WaveRow data={waveforms.sys ?? pseudoWaveform()} />
            </div>
          )}

          {/* Mic Audio layer */}
          {hasMic && (
            <div className="ss-track-row audio-track mic-audio">
              <WaveRow data={waveforms.mic ?? pseudoWaveform()} />
            </div>
          )}

          {/* Zoom / Animation layer */}
          <div className="ss-track-row zoom-track">
            <div className="zoom-connecting-line" />
            {keyframes.map((kf, idx) => (
              <div
                key={idx}
                className={`diamond-keyframe-marker ${kf.scale > 1.05 ? "zoomed" : ""}`}
                style={{ left: x(kf.time / 1000) }}
                title={`Zoom ${kf.scale.toFixed(1)}x at ${formatTimecode(kf.time / 1000)}`}
              />
            ))}
          </div>

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