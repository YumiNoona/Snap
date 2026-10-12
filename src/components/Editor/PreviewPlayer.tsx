import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX, Captions, GripHorizontal } from "lucide-react";

interface Props {
  position: number; duration: number; playing: boolean; muted: boolean; volume: number;
  onSeek: (seconds: number) => void; onToggle: () => void;
  onMute: () => void; onVolume: (volume: number) => void; onActivity: () => void;
  hasCaptions?: boolean; captionsVisible?: boolean; onCaptions?: () => void;
}
export function clampDockOffset(offset: { x: number; y: number }, rect: { left: number; right: number; top: number; bottom: number }, area: { left: number; right: number; top: number; bottom: number }) {
  return { x: offset.x + Math.max(area.left + 8 - rect.left, Math.min(0, area.right - 8 - rect.right)),
    y: offset.y + Math.max(area.top + 8 - rect.top, Math.min(0, area.bottom - 8 - rect.bottom)) };
}
export function playerTime(seconds: number) {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600), minutes = Math.floor(total / 60) % 60;
  return `${hours ? `${hours}:` : ""}${hours ? String(minutes).padStart(2, "0") : minutes}:${String(total % 60).padStart(2, "0")}`;
}
export default function PreviewPlayer(p: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; offset: typeof offset; rect: DOMRect; area: DOMRect } | null>(null);
  useLayoutEffect(() => {
    const node = root.current, parent = node?.parentElement;
    if (!node || !parent) return;
    const observer = new ResizeObserver(() => setOffset(previous => clampDockOffset(previous, node.getBoundingClientRect(), parent.getBoundingClientRect())));
    observer.observe(parent); return () => observer.disconnect();
  }, []);
  const begin = (e: PointerEvent) => {
    if (e.button !== 0 || (e.target as Element).closest("input,button:not(.ss-preview-drag-handle)")) return;
    const node = root.current, parent = node?.parentElement;
    if (!node || !parent) return;
    e.preventDefault(); e.stopPropagation(); node.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, offset, rect: node.getBoundingClientRect(), area: parent.getBoundingClientRect() };
    setDragging(true); p.onActivity();
  };
  const move = (e: PointerEvent) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    setOffset(clampDockOffset({ x: d.offset.x + dx, y: d.offset.y + dy }, { left: d.rect.left + dx, right: d.rect.right + dx, top: d.rect.top + dy, bottom: d.rect.bottom + dy }, d.area));
    p.onActivity();
  };
  const end = () => { drag.current = null; setDragging(false); p.onActivity(); };
  const duration = Number.isFinite(p.duration) ? Math.max(0, p.duration) : 0;
  const position = Number.isFinite(p.position) ? Math.max(0, Math.min(duration, p.position)) : 0;
  const seek = (seconds: number) => p.onSeek(Math.max(0, Math.min(duration, seconds)));
  const volume = p.muted ? 0 : Math.max(0, Math.min(100, p.volume));
  return <div className="ss-preview-player" role="group" aria-label="Preview playback controls"
    ref={root} data-dragging={dragging} style={{ left: `calc(50% + ${offset.x}px)`, bottom: `calc(24px - ${offset.y}px)` }}
    onPointerDown={begin} onPointerMove={move} onPointerUp={e => { if (root.current?.hasPointerCapture(e.pointerId)) root.current.releasePointerCapture(e.pointerId); end(); }} onPointerCancel={end} onLostPointerCapture={end}
    onFocusCapture={p.onActivity} onBlurCapture={p.onActivity} onPointerEnter={p.onActivity} onPointerLeave={p.onActivity}>
    <button type="button" className="ss-preview-drag-handle" aria-label="Move playback controls" onKeyDown={e => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === "Home") { setOffset({ x: 0, y: 0 }); return; }
      const node = root.current, parent = node?.parentElement; if (!node || !parent) return;
      const step = e.shiftKey ? 40 : 10, dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      const r = node.getBoundingClientRect(); setOffset(clampDockOffset({ x: offset.x + dx, y: offset.y + dy }, { left: r.left + dx, right: r.right + dx, top: r.top + dy, bottom: r.bottom + dy }, parent.getBoundingClientRect()));
    }}><GripHorizontal size={16} /></button>
    <div className="ss-preview-player-scrub">
      <span>{playerTime(position)}</span>
      <input aria-label="Preview position" aria-valuetext={`${playerTime(position)} of ${playerTime(duration)}`} type="range" min={0} max={duration || 1} step="0.01" value={position} disabled={!duration}
        style={{ "--player-progress": `${duration ? position / duration * 100 : 0}%` } as CSSProperties} onChange={e => seek(Number(e.target.value))} />
      <span>−{playerTime(duration - position)}</span>
    </div>
    <div className="ss-preview-player-bottom">
      <button type="button" className="ss-preview-captions" aria-label="Preview captions" aria-pressed={!!p.captionsVisible} disabled={!p.hasCaptions} onClick={p.onCaptions}><Captions size={19} /></button>
      <div className="ss-preview-player-buttons">
        <button type="button" aria-label="Back 5 seconds" disabled={!duration} onClick={() => seek(position - 5)}><RotateCcw size={20} /></button>
        <button type="button" className="primary" aria-label={p.playing ? "Pause preview" : "Play preview"} onClick={p.onToggle}>{p.playing ? <Pause size={23} fill="currentColor" /> : <Play size={23} fill="currentColor" />}</button>
        <button type="button" aria-label="Forward 5 seconds" disabled={!duration} onClick={() => seek(position + 5)}><RotateCw size={20} /></button>
      </div>
      <div className="ss-preview-volume">
        <button type="button" aria-label={p.muted || volume === 0 ? "Unmute preview" : "Mute preview"} onClick={p.onMute}>{p.muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
        <input aria-label="Preview volume" type="range" min={0} max={100} step={1} value={volume} style={{ "--player-progress": `${volume}%` } as CSSProperties} onChange={e => p.onVolume(Number(e.target.value))} />
      </div>
    </div>
  </div>;
}
