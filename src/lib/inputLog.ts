import { invoke } from "@tauri-apps/api/core";
import type { InputEvent } from "./types";

export interface LoadedInputLog {
  allEvents: InputEvent[];
  mouseMoveEvents: InputEvent[];
  clickEvents: InputEvent[];
  region: { x: number; y: number; w: number; h: number } | null;
}

/**
 * Load and align the JSON sidecar written by the Rust input_hook module.
 * Parses `meta` lines (capture-start offset + recording region), aligns
 * every other event's timestamp to video time 0, and splits mousemove /
 * mousedown events out for fast lookup. Shared by Preview (interactive)
 * and the export renderer (real-time playback capture) so both read the
 * exact same cursor data the exact same way.
 */
export async function loadInputLog(inputLogPath: string): Promise<LoadedInputLog> {
  const text = await invoke<string>("read_text_file", { path: inputLogPath });
  const raw: any[] = text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

  let captureStartMs = 0;
  let region: { x: number; y: number; w: number; h: number } | null = null;
  for (const e of raw) {
    if (e.type === "meta") {
      if (typeof e.captureStartMs === "number" && e.captureStartMs > 0) {
        captureStartMs = e.captureStartMs;
      }
      if (typeof e.w === "number" && e.w > 0) {
        region = { x: e.x, y: e.y, w: e.w, h: e.h };
      }
    }
  }

  const aligned: InputEvent[] = raw
    .filter((e) => e.type !== "meta")
    .map((e) => ({ ...e, ts: Math.max(0, e.ts - captureStartMs) }));

  const mouseMoveEvents = aligned
    .filter((e) => e.type === "mousemove" && e.x != null && e.y != null)
    .sort((a, b) => a.ts - b.ts);
  const clickEvents = aligned
    .filter((e) => e.type === "mousedown" && e.x != null && e.y != null)
    .sort((a, b) => a.ts - b.ts);

  return { allEvents: aligned, mouseMoveEvents, clickEvents, region };
}

/** Binary-search interpolated cursor position (screen space) at a given video timestamp (ms). */
export function getCursorAt(moves: InputEvent[], timestampMs: number): { x: number; y: number } | null {
  if (moves.length === 0) return null;

  let lo = 0, hi = moves.length - 1, idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (moves[mid].ts <= timestampMs) { idx = mid; lo = mid + 1; }
    else { hi = mid - 1; }
  }
  if (idx < 0) return null;

  const a = moves[idx];
  const b = idx + 1 < moves.length ? moves[idx + 1] : null;
  if (b && b.ts > a.ts) {
    const t = (timestampMs - a.ts) / (b.ts - a.ts);
    return {
      x: a.x! + (b.x! - a.x!) * Math.min(t, 1),
      y: a.y! + (b.y! - a.y!) * Math.min(t, 1),
    };
  }
  return { x: a.x!, y: a.y! };
}

/** Map an absolute screen coordinate onto the video's source pixel space. */
export function screenToVideo(
  region: { x: number; y: number; w: number; h: number } | null,
  sx: number,
  sy: number,
  vw: number,
  vh: number
): { x: number; y: number } {
  if (region && region.w > 0 && region.h > 0) {
    return {
      x: ((sx - region.x) / region.w) * vw,
      y: ((sy - region.y) / region.h) * vh,
    };
  }
  return { x: sx, y: sy };
}
