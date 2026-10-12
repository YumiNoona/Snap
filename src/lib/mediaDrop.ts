import type { VideoClip } from "./types";
import { clipDuration, sequenceTime } from "./videoEditing";

/** The guide and committed drop must share snapping and clock conversion. */
export function mediaDropPosition(clientX: number, rect: { left: number; width: number }, duration: number, clips: VideoClip[], sourceView: boolean, snapping: boolean, fps: number) {
  const rate = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const raw = Math.max(0, Math.min(duration, (clientX - rect.left) / Math.max(1, rect.width) * duration));
  const points = sourceView ? clips.flatMap(clip => [clip.start, clip.end]) : clips.reduce<number[]>((out, clip) => [...out, out[out.length - 1] + clipDuration(clip)], [0]);
  const nearest = points.reduce((best, point) => Math.abs(point - raw) < Math.abs(best - raw) ? point : best, Infinity);
  const snapped = snapping && Math.abs(nearest - raw) <= 8 / Math.max(1, rect.width) * duration ? nearest : raw;
  const display = Math.round(snapped * rate) / rate;
  return { display, sequence: Math.round((sourceView ? sequenceTime(clips, display) : display) * rate) / rate };
}
