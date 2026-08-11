import type { Keyframe, ZoomRegionSelection, ZoomRegionSettings } from "./types";

export interface IndexedZoomRegion extends ZoomRegionSettings {
  memberIndices: number[];
  zoomIndices: number[];
  resetIndex: number | null;
}

/** Build independently editable camera regions from the keyframe stream. */
export function collectZoomRegions(frames: Keyframe[], timelineEndMs: number): IndexedZoomRegion[] {
  const sorted = frames.map((frame, index) => ({ frame, index })).sort((a, b) => a.frame.time - b.frame.time);
  const regions: IndexedZoomRegion[] = [];
  const tagged = new Map<string, typeof sorted>();

  for (const entry of sorted) {
    if (!entry.frame.regionId) continue;
    const group = tagged.get(entry.frame.regionId) ?? [];
    group.push(entry);
    tagged.set(entry.frame.regionId, group);
  }

  for (const [regionId, group] of tagged) {
    const zooms = group.filter(({ frame }) => frame.scale > 1.02);
    if (zooms.length === 0) continue;
    const first = zooms[0];
    const last = zooms[zooms.length - 1];
    const reset = group.find(({ frame }) => frame.scale <= 1.02 && frame.time >= last.frame.time) ?? null;
    regions.push({
      startMs: Math.max(0, first.frame.time - (first.frame.duration || 0)),
      endMs: reset?.frame.time ?? Math.max(first.frame.time + 100, timelineEndMs),
      scale: Math.max(...zooms.map(({ frame }) => frame.scale)),
      x: last.frame.x,
      y: last.frame.y,
      transitionMs: first.frame.duration || 400,
      easing: first.frame.easing,
      source: first.frame.source ?? "auto",
      regionId,
      memberIndices: group.map(({ index }) => index),
      zoomIndices: zooms.map(({ index }) => index),
      resetIndex: reset?.index ?? null,
    });
  }

  // Keep projects created before stable region IDs editable.
  let active: IndexedZoomRegion | null = null;
  for (const { frame, index } of sorted.filter(({ frame }) => !frame.regionId)) {
    if (frame.scale > 1.02) {
      if (!active) {
        active = {
          startMs: Math.max(0, frame.time - (frame.duration || 0)),
          endMs: frame.time,
          scale: frame.scale,
          x: frame.x,
          y: frame.y,
          transitionMs: frame.duration || 400,
          easing: frame.easing,
          source: frame.source ?? "auto",
          memberIndices: [index],
          zoomIndices: [index],
          resetIndex: null,
        };
      } else {
        active.endMs = Math.max(active.endMs, frame.time);
        active.scale = Math.max(active.scale, frame.scale);
        active.x = frame.x;
        active.y = frame.y;
        active.memberIndices.push(index);
        active.zoomIndices.push(index);
      }
    } else if (active) {
      active.endMs = Math.max(active.startMs + 100, frame.time);
      active.memberIndices.push(index);
      active.resetIndex = index;
      regions.push(active);
      active = null;
    }
  }
  if (active) {
    active.endMs = Math.max(active.startMs + 100, timelineEndMs);
    regions.push(active);
  }

  return regions.sort((a, b) => a.startMs - b.startMs);
}

export function findZoomRegion(
  frames: Keyframe[],
  selection: ZoomRegionSelection | null,
  timelineEndMs: number
): IndexedZoomRegion | null {
  if (!selection) return null;
  const regions = collectZoomRegions(frames, timelineEndMs);
  const exact = selection.regionId ? regions.find((region) => region.regionId === selection.regionId) : null;
  if (exact) return exact;
  return regions.reduce<IndexedZoomRegion | null>((best, region) => {
    const score = Math.abs(region.startMs - selection.startMs) + Math.abs(region.endMs - selection.endMs);
    if (!best) return region;
    const bestScore = Math.abs(best.startMs - selection.startMs) + Math.abs(best.endMs - selection.endMs);
    return score < bestScore ? region : best;
  }, null);
}
