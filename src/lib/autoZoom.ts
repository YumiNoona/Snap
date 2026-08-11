import type { InputEvent, Keyframe } from "./types";

interface ActivityCluster {
  startTime: number;
  endTime: number;
  events: { x: number; y: number; ts: number; type: string }[];
}

// ── Tuned AutoZoom Constants (Screen Studio / Natural Camera Pacing) ────────

const CLUSTER_WINDOW_MS = 900;
const MERGE_GAP_MS = 520;
const FAR_CLICK_SPLIT_MS = 80;
const FAR_CLICK_DISTANCE = 0.3;
const MERGE_FOCUS_DISTANCE = 0.12;
const MIN_TYPING_BURST = 4;
const LEAD_IN_MS = 260;
const LEAD_OUT_MS = 700;
const MIN_HOLD_MS = 720;
const MIN_CAMERA_GAP_MS = 90;
const UNZOOM_GAP_THRESHOLD_MS = 2600;
const MIN_SCALE = 1.15;
const MAX_SCALE = 1.9;

/**
 * Filter and group input events into activity clusters.
 */
function findClusters(
  events: InputEvent[],
  videoWidth: number,
  videoHeight: number,
  videoDurationMs: number
): ActivityCluster[] {
  const ordered = events
    .filter((event) => Number.isFinite(event.ts) && event.ts >= 0 && event.ts <= videoDurationMs + 250)
    .sort((a, b) => a.ts - b.ts);
  const significant: InputEvent[] = [];
  let lastPointer: { x: number; y: number } | null = null;
  for (const event of ordered) {
    const hasPoint = typeof event.x === "number" && Number.isFinite(event.x) && typeof event.y === "number" && Number.isFinite(event.y);
    if ((event.type === "mousemove" || event.type === "mousedown") && hasPoint) {
      lastPointer = { x: event.x as number, y: event.y as number };
    }
    const pointerInside = !lastPointer || (
      lastPointer.x >= 0 && lastPointer.x <= videoWidth && lastPointer.y >= 0 && lastPointer.y <= videoHeight
    );
    if (event.type === "mousedown" && hasPoint && pointerInside) significant.push(event);
    else if (event.type === "keydown" && pointerInside) significant.push(lastPointer ? { ...event, ...lastPointer } : event);
    else if (event.type === "wheel" && pointerInside) significant.push(event);
  }

  if (significant.length === 0) return [];

  const rawClusters: ActivityCluster[] = [];
  let current: ActivityCluster | null = null;

  for (const e of significant) {
    const posX = typeof e.x === "number" ? e.x : Number.NaN;
    const posY = typeof e.y === "number" ? e.y : Number.NaN;

    if (!current) {
      current = {
        startTime: e.ts,
        endTime: e.ts,
        events: [{ x: posX, y: posY, ts: e.ts, type: e.type }],
      };
      continue;
    }

    const gap = e.ts - current.endTime;
    const clicks = current.events.filter((event) => event.type === "mousedown");
    const clickCenter = clicks.length > 0
      ? {
          x: clicks.reduce((sum, event) => sum + event.x, 0) / clicks.length,
          y: clicks.reduce((sum, event) => sum + event.y, 0) / clicks.length,
        }
      : null;
    const farClick = e.type === "mousedown" && clickCenter
      ? Math.hypot((posX - clickCenter.x) / Math.max(1, videoWidth), (posY - clickCenter.y) / Math.max(1, videoHeight)) > FAR_CLICK_DISTANCE
      : false;

    if (gap <= CLUSTER_WINDOW_MS && !(farClick && gap >= FAR_CLICK_SPLIT_MS)) {
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

  return mergeNearbyClusters(rawClusters, videoWidth, videoHeight);
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
  const wheelCount = cluster.events.filter((e) => e.type === "wheel").length;
  return wheelCount >= 2 || cluster.events.length >= 5;
}

/**
 * Merge nearby clusters only when their focus remains spatially compatible.
 * This prevents rapid clicks on opposite sides of the screen from collapsing
 * into one weak, nearly full-screen zoom.
 */
function mergeNearbyClusters(clusters: ActivityCluster[], videoWidth: number, videoHeight: number): ActivityCluster[] {
  if (clusters.length <= 1) return clusters;

  const merged: ActivityCluster[] = [];
  let current = clusters[0];

  for (let i = 1; i < clusters.length; i++) {
    const next = clusters[i];
    const gap = next.startTime - current.endTime;

    const currentCenter = clusterClickCenter(current);
    const nextCenter = clusterClickCenter(next);
    const spatialDistance = currentCenter && nextCenter
      ? Math.hypot((nextCenter.x - currentCenter.x) / Math.max(1, videoWidth), (nextCenter.y - currentCenter.y) / Math.max(1, videoHeight))
      : 0;

    if (gap <= MERGE_GAP_MS && spatialDistance <= MERGE_FOCUS_DISTANCE) {
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

function clusterClickCenter(cluster: ActivityCluster): { x: number; y: number } | null {
  const clicks = cluster.events.filter((event) => event.type === "mousedown");
  if (clicks.length === 0) return null;
  return {
    x: clicks.reduce((sum, event) => sum + event.x, 0) / clicks.length,
    y: clicks.reduce((sum, event) => sum + event.y, 0) / clicks.length,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function transitionForDistance(
  baseMs: number,
  from: { x: number; y: number; scale: number },
  to: { x: number; y: number; scale: number }
): number {
  const travel = Math.hypot(to.x - from.x, to.y - from.y);
  const scaleTravel = Math.abs(to.scale - from.scale);
  return Math.round(clamp(baseMs * (0.72 + travel * 1.35 + scaleTravel * 0.42), 350, 1100));
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
    (e) => e.type === "mousedown" && e.x >= 0 && e.y >= 0 && e.x <= videoWidth && e.y <= videoHeight
  );

  // Typing bursts inherit the last known cursor position, which is generally
  // the field the user clicked before typing. Fall back to center only when
  // the input log truly has no positional context.
  if (clicks.length === 0) {
    const anchors = cluster.events.filter(
      (event) => event.type === "keydown" && event.x >= 0 && event.y >= 0 && event.x <= videoWidth && event.y <= videoHeight
    );
    if (anchors.length === 0) return { cx: 0.5, cy: 0.5, scale: MIN_SCALE };
    const anchor = anchors[anchors.length - 1];
    const scale = 1.28;
    const safeEdge = Math.min(0.48, 0.5 / scale + 0.015);
    return {
      cx: clamp(anchor.x / videoWidth, safeEdge, 1 - safeEdge),
      cy: clamp(anchor.y / videoHeight, safeEdge, 1 - safeEdge),
      scale,
    };
  }

  const sortedX = clicks.map((point) => point.x).sort((a, b) => a - b);
  const sortedY = clicks.map((point) => point.y).sort((a, b) => a - b);
  const middle = Math.floor(sortedX.length / 2);
  const medianX = sortedX.length % 2 === 0 ? (sortedX[middle - 1] + sortedX[middle]) / 2 : sortedX[middle];
  const medianY = sortedY.length % 2 === 0 ? (sortedY[middle - 1] + sortedY[middle]) / 2 : sortedY[middle];
  const inlierRadius = Math.max(90, Math.hypot(videoWidth, videoHeight) * 0.18);
  const inliers = clicks.filter((point) => Math.hypot(point.x - medianX, point.y - medianY) <= inlierRadius);
  const focusClicks = inliers.length > 0 ? inliers : clicks;

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  let weightedX = 0, weightedY = 0, totalWeight = 0;
  for (let index = 0; index < focusClicks.length; index++) {
    const p = focusClicks[index];
    const weight = 0.65 + (index / Math.max(1, focusClicks.length - 1)) * 0.35;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    weightedX += p.x * weight;
    weightedY += p.y * weight;
    totalWeight += weight;
  }

  const padding = clamp(Math.min(videoWidth, videoHeight) * 0.14, 120, 250);
  const activityW = maxX - minX + padding * 2;
  const activityH = maxY - minY + padding * 2;

  // Single deliberate clicks get a confident but comfortable zoom. Multiple
  // clicks use their robust bounding box so toolbars/forms remain in frame.
  const fit = Math.min(videoWidth / activityW, videoHeight / activityH);
  const scale = focusClicks.length === 1
    ? Math.min(MAX_SCALE, 1.62)
    : clamp(fit * 0.76, MIN_SCALE, MAX_SCALE);

  const safeEdge = Math.min(0.48, 0.5 / scale + 0.015);
  const cx = clamp((weightedX / totalWeight) / videoWidth, safeEdge, 1 - safeEdge);
  const cy = clamp((weightedY / totalWeight) / videoHeight, safeEdge, 1 - safeEdge);

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
  const safeWidth = Math.max(1, videoWidth);
  const safeHeight = Math.max(1, videoHeight);
  const safeDuration = Math.max(0, videoDurationMs);
  const baseTransitionMs = clamp(transitionDurationMs, 180, 1600);
  const clusters = findClusters(events, safeWidth, safeHeight, safeDuration);

  // Default: unzoomed full-screen 1.0x
  if (clusters.length === 0 || safeDuration === 0) {
    const defaultKfs: Keyframe[] = [
      { time: 0, duration: 0, x: 0.5, y: 0.5, scale: 1.0, easing: "ease", source: "auto" },
    ];
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

  let lastHoldIndex = -1;

  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    const target = clusterFocus(cluster, safeWidth, safeHeight);
    const previousTarget = keyframes[keyframes.length - 1];
    const targetDistance = Math.hypot(target.cx - previousTarget.x, target.cy - previousTarget.y);
    const targetScaleDistance = Math.abs(target.scale - previousTarget.scale);

    // Repeated activity in the same visual area extends the existing shot
    // instead of adding tiny camera corrections that feel nervous.
    if (
      lastHoldIndex >= 0 &&
      previousTarget.scale > 1.02 &&
      targetDistance < 0.075 &&
      targetScaleDistance < 0.14 &&
      cluster.startTime - previousTarget.time < UNZOOM_GAP_THRESHOLD_MS
    ) {
      keyframes[lastHoldIndex] = {
        ...keyframes[lastHoldIndex],
        time: Math.min(safeDuration, Math.max(keyframes[lastHoldIndex].time, cluster.endTime + LEAD_OUT_MS)),
        x: (keyframes[lastHoldIndex].x + target.cx) / 2,
        y: (keyframes[lastHoldIndex].y + target.cy) / 2,
        scale: Math.max(keyframes[lastHoldIndex].scale, target.scale),
      };
      continue;
    }

    let prevKf = keyframes[keyframes.length - 1];
    const desiredTransitionStart = clamp(cluster.startTime - LEAD_IN_MS, 0, safeDuration);

    // Long idle gaps return to the full view before the next action. The reset
    // is fitted entirely inside the lull so it cannot overlap the next zoom.
    if (prevKf.scale > 1.02 && desiredTransitionStart - prevKf.time >= UNZOOM_GAP_THRESHOLD_MS) {
      const resetTarget = { x: 0.5, y: 0.5, scale: 1.0 };
      const resetDuration = transitionForDistance(baseTransitionMs, prevKf, resetTarget);
      const resetTime = Math.min(desiredTransitionStart - 120, prevKf.time + 420 + resetDuration);
      keyframes.push({
        time: Math.round(resetTime),
        duration: Math.max(120, Math.min(resetDuration, resetTime - prevKf.time)),
        x: 0.5,
        y: 0.5,
        scale: 1.0,
        easing: "ease-in-out",
      });
      prevKf = keyframes[keyframes.length - 1];
      lastHoldIndex = -1;
    }

    const moveTarget = { x: target.cx, y: target.cy, scale: target.scale };
    const requestedMoveDuration = transitionForDistance(baseTransitionMs, prevKf, moveTarget);
    const transitionStart = Math.max(desiredTransitionStart, prevKf.time + MIN_CAMERA_GAP_MS);
    if (transitionStart >= safeDuration - 80) break;
    const moveDuration = Math.max(80, Math.min(requestedMoveDuration, safeDuration - transitionStart));
    const zoomInTime = Math.round(transitionStart + moveDuration);
    const holdEndTime = Math.round(Math.min(
      safeDuration,
      Math.max(zoomInTime + MIN_HOLD_MS, cluster.endTime + LEAD_OUT_MS)
    ));

    keyframes.push({
      time: zoomInTime,
      duration: moveDuration,
      x: target.cx,
      y: target.cy,
      scale: target.scale,
      easing: "ease-in-out",
    });

    keyframes.push({
      time: holdEndTime,
      duration: 0,
      x: target.cx,
      y: target.cy,
      scale: target.scale,
      easing: "ease-in-out",
    });
    lastHoldIndex = keyframes.length - 1;
  }

  // Finish naturally: reset only when enough time remains for a visible move.
  let lastKf = keyframes[keyframes.length - 1];
  if (lastKf.scale > 1.02 && safeDuration - lastKf.time >= 950) {
    const resetTarget = { x: 0.5, y: 0.5, scale: 1.0 };
    const resetDuration = transitionForDistance(baseTransitionMs, lastKf, resetTarget);
    const resetStart = lastKf.time + 360;
    const resetTime = Math.min(safeDuration, resetStart + resetDuration);
    keyframes.push({
      time: Math.round(resetTime),
      duration: Math.max(120, Math.min(resetDuration, resetTime - lastKf.time)),
      x: 0.5,
      y: 0.5,
      scale: 1.0,
      easing: "ease-in-out",
    });
    lastKf = keyframes[keyframes.length - 1];
  }

  if (lastKf.time < safeDuration) {
    keyframes.push({
      time: safeDuration,
      duration: 0,
      x: lastKf.x,
      y: lastKf.y,
      scale: lastKf.scale,
      easing: "ease",
    });
  }

  let activeRegionId: string | undefined;
  let regionSequence = 0;
  const normalized = normalizeTrajectory(keyframes, safeDuration).map((frame) => {
    if (frame.scale > 1.02) {
      activeRegionId ??= `auto-${regionSequence++}-${Math.round(frame.time)}`;
      return { ...frame, source: "auto" as const, regionId: activeRegionId };
    }
    if (activeRegionId) {
      const reset = { ...frame, source: "auto" as const, regionId: activeRegionId };
      activeRegionId = undefined;
      return reset;
    }
    return { ...frame, source: "auto" as const };
  });

  return normalized;
}

function normalizeTrajectory(keyframes: Keyframe[], videoDurationMs: number): Keyframe[] {
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  const normalized: Keyframe[] = [];
  for (const raw of sorted) {
    const frame = {
      ...raw,
      time: Math.round(clamp(raw.time, 0, videoDurationMs)),
      duration: Math.max(0, Math.round(raw.duration || 0)),
      x: clamp(raw.x, 0, 1),
      y: clamp(raw.y, 0, 1),
      scale: clamp(raw.scale, 1, MAX_SCALE),
    };
    const previous = normalized[normalized.length - 1];
    if (previous && frame.time === previous.time) {
      normalized[normalized.length - 1] = frame;
      continue;
    }
    if (previous) frame.duration = Math.min(frame.duration, Math.max(0, frame.time - previous.time));
    normalized.push(frame);
  }
  return normalized;
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
