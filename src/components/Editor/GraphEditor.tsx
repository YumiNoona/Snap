import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Plus, Copy, Trash2, ClipboardPaste } from "lucide-react";
import { motionEase } from "../../lib/easing";
import type { Keyframe } from "../../lib/types";
import { duplicateKeys, pasteKeys } from "../../lib/keyframeEditing";
import { useModalFocus } from "./hooks/useModalFocus";
import "./GraphEditor.css";
export interface GraphKey {
  time: number;
  easing: Keyframe["easing"];
  bezier?: Keyframe["bezier"];
  [channel: string]: unknown;
}
export interface GraphTrack {
  id: string;
  name: string;
  keys: GraphKey[];
  maximum: number;
  channels: {
    id: string;
    name: string;
    min: number;
    max: number;
    step: number;
  }[];
  base: GraphKey;
  zoom?: boolean;
  locked?: boolean;
  onChange: (keys: GraphKey[]) => void;
  seek: (time: number) => void;
}
export default function GraphEditor({
  tracks,
  initialTrack,
  fps,
  onClose,
}: {
  tracks: GraphTrack[];
  initialTrack?: string;
  fps: number;
  onClose: () => void;
}) {
  const ref = useModalFocus(true),
    [trackId, setTrackId] = useState(initialTrack ?? tracks[0]?.id ?? ""),
    [channelId, setChannelId] = useState(""),
    [selected, setSelected] = useState<number[]>([]),
    [draft, setDraft] = useState<GraphKey[] | null>(null),
    clipboard = useRef<GraphKey[]>([]),
    suppressClick = useRef(false);
  const track = tracks.find((t) => t.id === trackId) ?? tracks[0],
    channel =
      track?.channels.find((c) => c.id === channelId) ?? track?.channels[0],
    keys = (draft ?? track?.keys ?? []).slice().sort((a, b) => a.time - b.time),
    key = keys.find((k) => selected.includes(k.time));
  const max = Math.max(1 / fps, track?.maximum ?? 1),
    range = channel ? channel.max - channel.min : 1;
  const commit = (next: GraphKey[]) => {
    if (track && !track.locked)
      track.onChange(next.slice().sort((a, b) => a.time - b.time));
    setDraft(null);
  };
  const patch = (change: Partial<GraphKey>) => {
    if (!key) return;
    const time = Number(change.time ?? key.time);
    if (
      !Number.isFinite(time) ||
      time < 0 ||
      time > max ||
      keys.some((k) => k !== key && Math.abs(k.time - time) < 0.5 / fps)
    )
      return;
    commit(keys.map((k) => (k === key ? { ...k, ...change } : k)));
    setSelected([time]);
  };
  const remove = () => {
    commit(keys.filter((k) => !selected.includes(k.time)));
    setSelected([]);
  };
  const paste = () => {
    const at = key?.time ?? 0;
    const next = pasteKeys(
      keys,
      clipboard.current,
      Math.min(max, at + 1 / fps),
      max,
      fps,
    );
    commit(next);
  };
  useEffect(() => {
    setSelected([]);
    setDraft(null);
    setChannelId("");
  }, [trackId]);
  const valueAt = (time: number) => {
    if (!channel || !keys.length)
      return Number(track?.base[channel?.id ?? ""] ?? 0);
    const i = keys.findIndex((k) => k.time > time);
    if (i === 0) return Number(keys[0][channel.id]);
    if (i < 0) return Number(keys[keys.length - 1][channel.id]);
    const a = keys[i - 1],
      b = keys[i],
      start = track.zoom
        ? Math.max(a.time, b.time - Number(b.duration ?? 0) / 1000)
        : a.time;
    const mix =
      time < start
        ? 0
        : motionEase(
            (time - start) / Math.max(0.0001, b.time - start),
            b.easing,
            b.bezier,
          );
    return (
      Number(a[channel.id]) +
      (Number(b[channel.id]) - Number(a[channel.id])) * mix
    );
  };
  return createPortal(
    <div
      className="graph-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="graph-editor editor-glass-surface"
        ref={(node) => {
          ref.current = node;
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Keyframe graph editor"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onClose();
          if (
            (e.key === "Delete" || e.key === "Backspace") &&
            !(e.target as HTMLElement).closest("input,select")
          ) {
            e.preventDefault();
            remove();
          }
          if (
            (e.ctrlKey || e.metaKey) &&
            !(e.target as HTMLElement).closest("input")
          ) {
            if (e.key.toLowerCase() === "c") {
              e.preventDefault();
              clipboard.current = structuredClone(
                keys.filter((k) => selected.includes(k.time)),
              );
            }
            if (e.key.toLowerCase() === "v") {
              e.preventDefault();
              paste();
            }
            if (e.key.toLowerCase() === "d") {
              e.preventDefault();
              commit(duplicateKeys(keys, selected, max, fps));
            }
          }
        }}
      >
        <header>
          <div>
            <h2>Keyframe graph</h2>
            <small>Source / object time · snap to {fps.toFixed(0)} FPS</small>
          </div>
          <button aria-label="Close graph editor" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        {!track || !channel ? (
          <p>No animation tracks available.</p>
        ) : (
          <>
            <div className="graph-toolbar">
              <label>
                Track
                <select
                  value={track.id}
                  onChange={(e) => setTrackId(e.target.value)}
                >
                  {tracks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.locked ? " · Locked" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Channel
                <select
                  value={channel.id}
                  onChange={(e) => setChannelId(e.target.value)}
                >
                  {track.channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                title="Add at selected time plus one frame"
                disabled={track.locked}
                onClick={() => {
                  const time = Math.min(max, (key?.time ?? 0) + 1 / fps);
                  if (keys.some((k) => Math.abs(k.time - time) < 0.5 / fps))
                    return;
                  commit([
                    ...keys,
                    { ...track.base, time, [channel.id]: valueAt(time) },
                  ]);
                  setSelected([time]);
                }}
              >
                <Plus size={16} />
                Key
              </button>
              <button
                aria-label="Copy graph keys"
                onClick={() => {
                  clipboard.current = structuredClone(
                    keys.filter((k) => selected.includes(k.time)),
                  );
                }}
                disabled={!selected.length}
              >
                <Copy size={16} />
              </button>
              <button
                aria-label="Paste graph keys"
                onClick={paste}
                disabled={track.locked}
              >
                <ClipboardPaste size={16} />
              </button>
              <button
                aria-label="Delete graph keys"
                onClick={remove}
                disabled={track.locked || !selected.length}
              >
                <Trash2 size={16} />
              </button>
            </div>
            <svg
              className="graph-plot"
              viewBox="0 0 800 300"
              role="img"
              aria-label="Animation value graph. Double click to add a key."
              onDoubleClick={(e) => {
                if (track.locked) return;
                const r = e.currentTarget.getBoundingClientRect(),
                  time = Math.max(
                    0,
                    Math.min(
                      max,
                      Math.round(((e.clientX - r.left) / r.width) * max * fps) /
                        fps,
                    ),
                  ),
                  value =
                    channel.max - ((e.clientY - r.top) / r.height) * range;
                if (keys.some((k) => Math.abs(k.time - time) < 0.5 / fps))
                  return;
                commit([
                  ...keys,
                  {
                    ...track.base,
                    time,
                    [channel.id]: Math.max(
                      channel.min,
                      Math.min(channel.max, value),
                    ),
                  },
                ]);
                setSelected([time]);
              }}
            >
              {[0.25, 0.5, 0.75].map((v) => (
                <g key={v}>
                  <line x1={v * 800} x2={v * 800} y1="0" y2="300" />
                  <line x1="0" x2="800" y1={v * 300} y2={v * 300} />
                </g>
              ))}
              <path
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2"
                d={Array.from(
                  { length: 401 },
                  (_, i) =>
                    `${i ? "L" : "M"}${i * 2} ${((channel.max - valueAt((i / 400) * max)) / range) * 300}`,
                ).join(" ")}
              />
              {keys.map((k) => (
                <circle
                  key={k.time}
                  cx={(k.time / max) * 800}
                  cy={((channel.max - Number(k[channel.id])) / range) * 300}
                  r={selected.includes(k.time) ? 6 : 4}
                  role="button"
                  tabIndex={0}
                  aria-label={`Key at ${k.time.toFixed(3)} seconds`}
                  fill={
                    selected.includes(k.time)
                      ? "var(--accent)"
                      : "var(--text-primary)"
                  }
                  onFocus={() => setSelected([k.time])}
                  onClick={(e) => {
                    if (suppressClick.current) {
                      suppressClick.current = false;
                      return;
                    }
                    setSelected((prev) =>
                      e.shiftKey
                        ? prev.includes(k.time)
                          ? prev.filter((t) => t !== k.time)
                          : [...prev, k.time]
                        : [k.time],
                    );
                    track.seek(k.time);
                  }}
                  onPointerDown={(e) => {
                    if (track.locked || e.button !== 0) return;
                    e.preventDefault();
                    const selection = e.shiftKey
                      ? [...new Set([...selected, k.time])]
                      : selected.includes(k.time)
                        ? selected
                        : [k.time];
                    setSelected(selection);
                    const r =
                        e.currentTarget.ownerSVGElement!.getBoundingClientRect(),
                      x = e.clientX,
                      y = e.clientY;
                    let next = keys;
                    let movedPointer = false;
                    const chosen = keys.filter((q) =>
                        selection.includes(q.time),
                      ),
                      minimum = Math.min(...chosen.map((q) => q.time)),
                      maximum = Math.max(...chosen.map((q) => q.time));
                    const move = (ev: PointerEvent) => {
                      if (
                        Math.hypot(ev.clientX - x, ev.clientY - y) < 2 &&
                        !movedPointer
                      )
                        return;
                      movedPointer = true;
                      const delta = Math.max(
                          -minimum,
                          Math.min(
                            max - maximum,
                            Math.round(
                              ((ev.clientX - x) / r.width) * max * fps,
                            ) / fps,
                          ),
                        ),
                        dv = (-(ev.clientY - y) / r.height) * range;
                      next = keys.map((q) =>
                        selection.includes(q.time)
                          ? {
                              ...q,
                              time: Math.round((q.time + delta) * fps) / fps,
                              [channel.id]: Math.max(
                                channel.min,
                                Math.min(
                                  channel.max,
                                  Number(q[channel.id]) + dv,
                                ),
                              ),
                            }
                          : q,
                      );
                      setDraft(next);
                    };
                    const up = () => {
                      window.removeEventListener("pointermove", move);
                      if (!movedPointer) return;
                      suppressClick.current = true;
                      const moved = next.filter((_, i) =>
                        selection.includes(keys[i].time),
                      );
                      const unique = new Map(
                        next
                          .filter((_, i) => !selection.includes(keys[i].time))
                          .map((q) => [q.time, q]),
                      );
                      moved.forEach((q) => unique.set(q.time, q));
                      commit([...unique.values()]);
                      setSelected(moved.map((q) => q.time));
                    };
                    window.addEventListener("pointermove", move);
                    window.addEventListener("pointerup", up, { once: true });
                  }}
                />
              ))}
            </svg>
            <div className="graph-axis">
              <span>{channel.min}</span>
              <span>0:00 → {max.toFixed(2)} s</span>
              <span>{channel.max}</span>
            </div>
            <fieldset
              disabled={track.locked || !key}
              className="graph-controls"
            >
              <label>
                Time (s)
                <input
                  type="number"
                  min="0"
                  max={max}
                  step={1 / fps}
                  value={key ? Number(key.time.toFixed(4)) : 0}
                  onChange={(e) =>
                    patch({
                      time: Math.round(Number(e.target.value) * fps) / fps,
                    })
                  }
                />
              </label>
              <label>
                {channel.name}
                <input
                  type="number"
                  min={channel.min}
                  max={channel.max}
                  step={channel.step}
                  value={key ? Number(key[channel.id]).toFixed(3) : 0}
                  onChange={(e) =>
                    patch({
                      [channel.id]: Math.max(
                        channel.min,
                        Math.min(channel.max, Number(e.target.value)),
                      ),
                    })
                  }
                />
              </label>
              <label>
                Incoming interpolation
                <select
                  aria-label="Incoming interpolation"
                  value={key?.easing ?? "linear"}
                  onChange={(e) =>
                    patch({
                      easing: e.target.value as Keyframe["easing"],
                      bezier:
                        e.target.value === "custom"
                          ? (key?.bezier ?? [0.25, 0.1, 0.25, 1])
                          : key?.bezier,
                    })
                  }
                >
                  {[
                    "linear",
                    "hold",
                    "ease-in",
                    "ease-out",
                    "ease-in-out",
                    "sine",
                    "smoother",
                    "custom",
                  ].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              {track.zoom && (
                <label>
                  Transition (s)
                  <input
                    type="number"
                    min="0"
                    step={1 / fps}
                    value={Number(key?.duration ?? 0) / 1000}
                    onChange={(e) =>
                      patch({
                        duration: Math.max(0, Number(e.target.value)) * 1000,
                      })
                    }
                  />
                </label>
              )}
            </fieldset>
            {key?.easing === "custom" && (
              <div className="graph-bezier">
                <svg viewBox="0 0 240 160" aria-label="Bezier easing handles">
                  <path
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth="2"
                    d={`M20 140 C${20 + (key.bezier?.[0] ?? 0.25) * 200} ${140 - (key.bezier?.[1] ?? 0.1) * 120},${20 + (key.bezier?.[2] ?? 0.25) * 200} ${140 - (key.bezier?.[3] ?? 1) * 120},220 20`}
                  />
                  {[0, 1].map((i) => {
                    const b = key.bezier ?? [0.25, 0.1, 0.25, 1];
                    return (
                      <g key={i}>
                        <line
                          x1={i ? 220 : 20}
                          y1={i ? 20 : 140}
                          x2={20 + b[i * 2] * 200}
                          y2={140 - b[i * 2 + 1] * 120}
                        />
                        <circle
                          cx={20 + b[i * 2] * 200}
                          cy={140 - b[i * 2 + 1] * 120}
                          r="6"
                          fill="var(--text-primary)"
                          onPointerDown={(e) => {
                            if (track.locked) return;
                            const r =
                              e.currentTarget.ownerSVGElement!.getBoundingClientRect();
                            let bezier = [...b] as NonNullable<
                              Keyframe["bezier"]
                            >;
                            const move = (ev: PointerEvent) => {
                              bezier[i * 2] = Math.max(
                                0,
                                Math.min(
                                  1,
                                  (((ev.clientX - r.left) / r.width) * 240 -
                                    20) /
                                    200,
                                ),
                              );
                              bezier[i * 2 + 1] = Math.max(
                                -2,
                                Math.min(
                                  3,
                                  (140 -
                                    ((ev.clientY - r.top) / r.height) * 160) /
                                    120,
                                ),
                              );
                              setDraft(
                                keys.map((q) =>
                                  q === key ? { ...q, bezier: [...bezier] } : q,
                                ),
                              );
                            };
                            const up = () => {
                              window.removeEventListener("pointermove", move);
                              commit(
                                keys.map((q) =>
                                  q === key ? { ...q, bezier } : q,
                                ),
                              );
                            };
                            window.addEventListener("pointermove", move);
                            window.addEventListener("pointerup", up, {
                              once: true,
                            });
                          }}
                        />
                      </g>
                    );
                  })}
                </svg>
                <div>
                  {["X1", "Y1", "X2", "Y2"].map((label, i) => (
                    <label key={label}>
                      {label}
                      <input
                        type="number"
                        step=".01"
                        min={i % 2 ? -2 : 0}
                        max={i % 2 ? 3 : 1}
                        disabled={track.locked}
                        value={(key.bezier ?? [0.25, 0.1, 0.25, 1])[i].toFixed(
                          3,
                        )}
                        onChange={(e) => {
                          const bezier = [
                            ...(key.bezier ?? [0.25, 0.1, 0.25, 1]),
                          ] as NonNullable<Keyframe["bezier"]>;
                          bezier[i] = Math.max(
                            i % 2 ? -2 : 0,
                            Math.min(i % 2 ? 3 : 1, Number(e.target.value)),
                          );
                          patch({ bezier });
                        }}
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}
            <small>
              Double click the graph to add a key. Shift-select keys to move
              together. Ctrl+C / V / D to copy, paste or duplicate. Custom
              handles control the incoming segment.
            </small>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
