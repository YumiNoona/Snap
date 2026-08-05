import type { InputEvent, Keyframe } from "./types";

interface ActivityCluster {
  startTime: number;
  endTime: number;
  events: { x: number; y: number; ts: number; type: string }[];
}

// ── Tuned AutoZoom Constants (Screen Studio / Natural Camera Pacing) ────────

const CLUSTER_WINDOW_MS = 1500;       // Group events within 1.5s window
const MERGE_GAP_MS = 1200;            // Merge clusters closer than 1.2s
const MIN_TYPING_BURST = 5;           // Require 5+ keydowns for typing burst
const LEAD_IN_MS = 300;               // Lead-in time before cluster start
const LEAD_OUT_MS = 600;              // Hold time after cluster activity ends
const MIN_KEYFRAME_GAP_MS = 1200;     // Cooldown between consecutive camera moves
const UNZOOM_GAP_THRESHOLD_MS = 3500; // Only return to 1.0x center if gap >= 3.5s
const MIN_SCALE = 1.15;               // Gentle minimum zoom scale
const MAX_SCALE = 1.75;               // Cap max automatic scale to 1.75x
const ZOOM_PADDING = 200;             // Padding around focus bounding box

/**
 * Filter and group input events into activity clusters.
 */
function findClusters(events: InputEvent[]): ActivityCluster[] {
  const significant = events.filter(
    (e) =>
      e.type === "mousedown" ||
      e.type === "keydown" ||
      e.type === "wheel"
  );

  if (significant.length === 0) return [];

  const rawClusters: ActivityCluster[] = [];
  let current: ActivityCluster | null = null;

  for (const e of significant) {
    const posX = e.x ?? 0;
    const posY = e.y ?? 0;

    if (!current) {
      current = {
        startTime: e.ts,
        endTime: e.ts,
        events: [{ x: posX, y: posY, ts: e.ts, type: e.type }],
      };
      continue;
    }

    if (e.ts - current.endTime <= CLUSTER_WINDOW_MS) {
      current.endTime = e.ts;
      current.events.push({ x: posX, y: posY, ts: e.ts, type: e.type });
    } else {
      if (isSignificantCluster(current)) {
        rawClusters.push(current);
      }
      current = {
        startTime: e.ts,
        endTime: e.ts,
        events: [{ x: posX, y: posY, ts: e.ts, type: e.type }],
      };
    }
  }

  if (current && isSignificantCluster(current)) {
    rawClusters.push(current);
  }

  return mergeNearbyClusters(rawClusters);
}

/**
 * Evaluate if a cluster is genuinely significant.
 * Any deliberate click focuses the camera; sustained typing or dense mixed
 * activity qualifies too.
 */
function isSignificantCluster(cluster: ActivityCluster): boolean {
  const keydownCount = cluster.events.filter((e) => e.type === "keydown").length;
  const clickCount = cluster.events.filter((e) => e.type === "mousedown").length;

  if (clickCount >= 1) return true;
  if (keydownCount >= MIN_TYPING_BURST) return true;
  return cluster.events.length >= 5;
}

/**
 * Merge nearby clusters separated by short gaps.
 */
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

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Compute the focal center and scale for a cluster.
 * Positions come ONLY from mouse clicks (keydowns have no coordinates and
 * wheel deltas are not positions) — using them polluted the focus box.
 */
function clusterFocus(
  cluster: ActivityCluster,
  videoWidth: number,
  videoHeight: number
): { cx: number; cy: number; scale: number } {
  const clicks = cluster.events.filter(
    (e) => e.type === "mousedown" && e.x > 0 && e.y > 0
  );

  // Typing-only burst: gentle center zoom, no position data to focus on.
  if (clicks.length === 0) {
    return { cx: 0.5, cy: 0.5, scale: MIN_SCALE };
  }

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  for (const p of clicks) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const activityW = maxX - minX + ZOOM_PADDING * 2;
  const activityH = maxY - minY + ZOOM_PADDING * 2;

  // Scale so the padded activity box fits with breathing room, capped.
  const fit = Math.min(videoWidth / activityW, videoHeight / activityH);
  const scale = clamp(fit * 0.72, MIN_SCALE, MAX_SCALE);

  const cx = clamp((minX + maxX) / 2 / videoWidth, 0.15, 0.85);
  const cy = clamp((minY + maxY) / 2 / videoHeight, 0.15, 0.85);

  return { cx, cy, scale };
}

/**
 * Generate camera keyframe trajectory with direct panning between nearby
 * clusters and unzooming only during long lulls (>= 3.5s).
 */
export function generateKeyframes(
  events: InputEvent[],
  videoWidth: number,
  videoHeight: number,
  videoDurationMs: number,
  transitionDurationMs: number = 600
): Keyframe[] {
  const clusters = findClusters(events);

  // Default: unzoomed full-screen 1.0x
  if (clusters.length === 0 || videoDurationMs === 0) {
    const defaultKfs: Keyframe[] = [
      { time: 0, duration: 0, x: 0.5, y: 0.5, scale: 1.0, easing: "ease" },
    ];
    logKeyframesVisualization(events.length, clusters.length, defaultKfs);
    return defaultKfs;
  }

  const keyframes: Keyframe[] = [];

  // Start video at scale 1.0x
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
    const { cx, cy, scale } = clusterFocus(cluster, videoWidth, videoHeight);

    const prevKf = keyframes[keyframes.length - 1];
    const prevEndTime = prevKf.time;

    // The very first zoom can start immediately; later moves wait out the
    // cooldown so consecutive cameras don't stutter.
    const minTime =
      prevKf.scale > 1.0 ? prevEndTime + MIN_KEYFRAME_GAP_MS : prevEndTime;
    let zoomInTime = Math.max(cluster.startTime - LEAD_IN_MS, minTime);
    const holdEndTime = cluster.endTime + LEAD_OUT_MS;

    // LONG LULL (>= 3.5s): Return to full screen 1.0x center before zooming in.
    const gapFromPrev = zoomInTime - prevEndTime;
    if (gapFromPrev >= UNZOOM_GAP_THRESHOLD_MS && prevKf.scale > 1.0) {
      const unzoomTime = prevEndTime + 800;
      keyframes.push({
        time: unzoomTime,
        duration: transitionDurationMs,
        x: 0.5,
        y: 0.5,
        scale: 1.0,
        easing: "ease-in-out",
      });
      zoomInTime = Math.max(zoomInTime, unzoomTime + transitionDurationMs);
    }

    // Zoom or Direct Pan to current cluster focus
    keyframes.push({
      time: zoomInTime,
      duration: transitionDurationMs,
      x: cx,
      y: cy,
      scale,
      easing: "ease-in-out",
    });

    // Hold focus through the end of cluster activity
    keyframes.push({
      time: holdEndTime,
      duration: transitionDurationMs,
      x: cx,
      y: cy,
      scale,
      easing: "ease-in-out",
    });
  }

  // After final cluster: unzoom to 1.0x center if time remains
  const lastKf = keyframes[keyframes.length - 1];
  if (lastKf.scale > 1.0 && lastKf.time + 1000 < videoDurationMs) {
    keyframes.push({
      time: lastKf.time + 800,
      duration: transitionDurationMs,
      x: 0.5,
      y: 0.5,
      scale: 1.0,
      easing: "ease-in-out",
    });
  }

  // End of video marker
  if (keyframes[keyframes.length - 1].time < videoDurationMs) {
    keyframes.push({
      time: videoDurationMs,
      duration: 0,
      x: 0.5,
      y: 0.5,
      scale: 1.0,
      easing: "ease",
    });
  }

  // Dev visualization log
  logKeyframesVisualization(events.length, clusters.length, keyframes);

  return keyframes;
}

/**
 * Log generated keyframes table to DevTools console for visual sanity-checking.
 */
function logKeyframesVisualization(
  totalEvents: number,
  totalClusters: number,
  keyframes: Keyframe[]
) {
  console.group("%c[Snap AutoZoom] Generated Keyframe Trajectory", "color: #a855f7; font-weight: bold; font-size: 13px;");
  console.log(
    `Input Events: ${totalEvents} | Significant Clusters: ${totalClusters} | Keyframes Generated: ${keyframes.length}`
  );
  console.table(
    keyframes.map((kf, i) => ({
      Index: i,
      "Time (sec)": `${(kf.time / 1000).toFixed(2)}s`,
      "Duration": `${kf.duration}ms`,
      "Scale": `${kf.scale.toFixed(2)}x`,
      "Focus (X, Y)": `(${kf.x.toFixed(2)}, ${kf.y.toFixed(2)})`,
      "Easing": kf.easing,
    }))
  );
  console.groupEnd();
}

/**
 * Interpolate keyframe values at currentTimeMs using smooth cubic easing.
 */
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
