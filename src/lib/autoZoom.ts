import type { InputEvent, Keyframe } from "./types";

interface ActivityCluster {
  startTime: number;
  endTime: number;
  events: { x: number; y: number; ts: number }[];
}

const CLUSTER_WINDOW_MS = 600;
const MERGE_GAP_MS = 800;
const MIN_CLUSTER_EVENTS = 2;
const LEAD_IN_MS = 400;
const LEAD_OUT_MS = 300;
const MIN_KEYFRAME_GAP_MS = 400;
const MAX_SCALE = 3.0;
const MIN_SCALE = 1.0;
const ZOOM_PADDING = 120;
const TRANSITION_DURATION_MS = 400;

function findClusters(events: InputEvent[]): ActivityCluster[] {
  const significant = events.filter(
    (e) =>
      e.type === "mousedown" ||
      e.type === "keydown" ||
      e.type === "wheel"
  );

  if (significant.length < MIN_CLUSTER_EVENTS) return [];

  const clusters: ActivityCluster[] = [];
  let current: ActivityCluster | null = null;

  for (const e of significant) {
    const posX = e.x ?? 0;
    const posY = e.y ?? 0;

    if (!current) {
      current = {
        startTime: e.ts,
        endTime: e.ts,
        events: [{ x: posX, y: posY, ts: e.ts }],
      };
      continue;
    }

    if (e.ts - current.endTime <= CLUSTER_WINDOW_MS) {
      current.endTime = e.ts;
      current.events.push({ x: posX, y: posY, ts: e.ts });
    } else {
      if (current.events.length >= MIN_CLUSTER_EVENTS) {
        clusters.push(current);
      }
      current = {
        startTime: e.ts,
        endTime: e.ts,
        events: [{ x: posX, y: posY, ts: e.ts }],
      };
    }
  }

  if (current && current.events.length >= MIN_CLUSTER_EVENTS) {
    clusters.push(current);
  }

  return mergeNearbyClusters(clusters);
}

function mergeNearbyClusters(clusters: ActivityCluster[]): ActivityCluster[] {
  if (clusters.length <= 1) return clusters;

  const merged: ActivityCluster[] = [];
  let current = clusters[0];

  for (let i = 1; i < clusters.length; i++) {
    const next = clusters[i];
    const gap = next.startTime - current.endTime;

    if (gap <= MERGE_GAP_MS) {
      current.endTime = next.endTime;
      current.events.push(...next.events);
    } else {
      merged.push(current);
      current = next;
    }
  }

  merged.push(current);
  return merged;
}

function clusterBoundingBox(
  cluster: ActivityCluster,
  videoWidth: number,
  videoHeight: number
): { cx: number; cy: number; scale: number } {
  const positions = cluster.events;
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (const p of positions) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const activityW = maxX - minX + ZOOM_PADDING * 2;
  const activityH = maxY - minY + ZOOM_PADDING * 2;

  const scaleX = videoWidth / Math.max(activityW, 1);
  const scaleY = videoHeight / Math.max(activityH, 1);
  const scale = Math.min(Math.max(Math.min(scaleX, scaleY), MIN_SCALE), MAX_SCALE);

  const cx = (minX + maxX) / 2 / videoWidth;
  const cy = (minY + maxY) / 2 / videoHeight;

  return { cx, cy, scale };
}

export function generateKeyframes(
  events: InputEvent[],
  videoWidth: number,
  videoHeight: number,
  videoDurationMs: number
): Keyframe[] {
  const clusters = findClusters(events);

  if (clusters.length === 0 || videoDurationMs === 0) {
    return [
      {
        time: 0,
        duration: 0,
        x: 0.5,
        y: 0.5,
        scale: 1.0,
        easing: "ease",
      },
    ];
  }

  const keyframes: Keyframe[] = [];

  keyframes.push({
    time: 0,
    duration: 0,
    x: 0.5,
    y: 0.5,
    scale: 1.0,
    easing: "ease",
  });

  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    const { cx, cy, scale } = clusterBoundingBox(cluster, videoWidth, videoHeight);
    const prevEnd = i > 0 ? clusters[i - 1].endTime + LEAD_OUT_MS : 0;

    const zoomInTime = Math.max(cluster.startTime - LEAD_IN_MS, prevEnd + MIN_KEYFRAME_GAP_MS);
    const holdEndTime = cluster.endTime + LEAD_OUT_MS;

    if (zoomInTime - prevEnd >= MIN_KEYFRAME_GAP_MS && prevEnd > 0) {
      const midTime = (prevEnd + zoomInTime) / 2;
      if (keyframes.length > 0 && midTime - keyframes[keyframes.length - 1].time >= MIN_KEYFRAME_GAP_MS) {
        keyframes.push({
          time: midTime,
          duration: 0,
          x: 0.5,
          y: 0.5,
          scale: 1.0,
          easing: "ease",
        });
      }
    }

    keyframes.push({
      time: zoomInTime,
      duration: TRANSITION_DURATION_MS,
      x: Math.max(0, Math.min(1, cx)),
      y: Math.max(0, Math.min(1, cy)),
      scale,
      easing: "ease-in-out",
    });

    keyframes.push({
      time: holdEndTime,
      duration: TRANSITION_DURATION_MS,
      x: Math.max(0, Math.min(1, cx)),
      y: Math.max(0, Math.min(1, cy)),
      scale,
      easing: "ease-in-out",
    });

    if (i < clusters.length - 1) {
      const nextCluster = clusters[i + 1];
      const nextZoomIn = nextCluster.startTime - LEAD_IN_MS;
      const gapStart = holdEndTime + TRANSITION_DURATION_MS;
      if (nextZoomIn - gapStart >= MIN_KEYFRAME_GAP_MS) {
        keyframes.push({
          time: gapStart,
          duration: TRANSITION_DURATION_MS,
          x: 0.5,
          y: 0.5,
          scale: 1.0,
          easing: "ease-in-out",
        });
      }
    } else {
      const endTime = Math.min(holdEndTime + TRANSITION_DURATION_MS, videoDurationMs);
      if (endTime > keyframes[keyframes.length - 1].time + MIN_KEYFRAME_GAP_MS) {
        keyframes.push({
          time: endTime,
          duration: TRANSITION_DURATION_MS,
          x: 0.5,
          y: 0.5,
          scale: 1.0,
          easing: "ease-in-out",
        });
      }
    }
  }

  if (keyframes.length > 0 && keyframes[keyframes.length - 1].time < videoDurationMs) {
    keyframes.push({
      time: videoDurationMs,
      duration: 0,
      x: 0.5,
      y: 0.5,
      scale: 1.0,
      easing: "ease",
    });
  }

  return keyframes;
}

export function interpolateKeyframe(
  kf: Keyframe,
  nextKf: Keyframe,
  currentTimeMs: number
): { x: number; y: number; scale: number } {
  if (!nextKf) {
    return { x: kf.x, y: kf.y, scale: kf.scale };
  }

  const elapsed = currentTimeMs - kf.time;
  const total = nextKf.time - kf.time;

  if (total <= 0) {
    return { x: kf.x, y: kf.y, scale: kf.scale };
  }

  let t = Math.max(0, Math.min(1, elapsed / total));
  t = easeInOutCubic(t);

  return {
    x: kf.x + (nextKf.x - kf.x) * t,
    y: kf.y + (nextKf.y - kf.y) * t,
    scale: kf.scale + (nextKf.scale - kf.scale) * t,
  };
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
