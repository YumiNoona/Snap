import { AUTO_ZOOM_PRESETS, type AutoZoomConfig, type InputEvent, type Keyframe } from "./types";

interface ActivityCluster {
  startTime: number;
  endTime: number;
  events: { x: number; y: number; ts: number; type: string }[];
}

// Intent-aware camera pacing. All times are source-media milliseconds.

const CLUSTER_WINDOW_MS = 900;
const FAR_CLICK_SPLIT_MS = 80;
const FAR_CLICK_DISTANCE = 0.3;
const LEAD_OUT_MS = 700;

/**
 * Filter and group input events into activity clusters.
 */
function findClusters(
  events: InputEvent[],
  videoWidth: number,
  videoHeight: number,
  videoDurationMs: number,
  options: AutoZoomConfig
): ActivityCluster[] {
  const ordered = events
    .filter((event) => Number.isFinite(event.ts) && event.ts >= 0 && event.ts <= videoDurationMs + 250)
    .sort((a, b) => a.ts - b.ts);
  const significant: InputEvent[] = [];
  let lastPointer: { x: number; y: number } | null = null;
  let lastFollow: { x: number; y: number; ts: number } | null = null;
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
    else if (event.type === "wheel" && pointerInside) significant.push(lastPointer ? { ...event, ...lastPointer } : event);
    else if (event.type === "mousemove" && hasPoint && pointerInside && options.focusMode === "follow") {
      const distance = lastFollow ? Math.hypot((event.x! - lastFollow.x) / videoWidth, (event.y! - lastFollow.y) / videoHeight) : 1;
      if (!lastFollow || (event.ts - lastFollow.ts >= 500 && distance >= options.deadZone)) {
        significant.push({ ...event, type: "follow" });
        lastFollow = { x: event.x!, y: event.y!, ts: event.ts };
      }
    }
  }

  if (significant.length === 0) return [];

  const rawClusters: ActivityCluster[] = [];
  let current: ActivityCluster | null = null;
  let sumX = 0, sumY = 0, count = 0;

  for (const e of significant) {
    const posX = typeof e.x === "number" ? e.x : Number.NaN;
    const posY = typeof e.y === "number" ? e.y : Number.NaN;

    if (!current) {
      current = {
        startTime: e.ts,
        endTime: e.ts,
        events: [{ x: posX, y: posY, ts: e.ts, type: e.type }],
      };
      sumX = Number.isFinite(posX) ? posX : 0;
      sumY = Number.isFinite(posY) ? posY : 0;
      count = Number.isFinite(posX) && Number.isFinite(posY) ? 1 : 0;
      continue;
    }

    const gap = e.ts - current.endTime;
    // Running sums avoid quadratic rescanning during long typing bursts.
    const farClick = count > 0 && Number.isFinite(posX) && Number.isFinite(posY)
      ? Math.hypot((posX - sumX / count) / videoWidth, (posY - sumY / count) / videoHeight) > FAR_CLICK_DISTANCE
      : false;

    if (gap <= CLUSTER_WINDOW_MS && !(farClick && gap >= FAR_CLICK_SPLIT_MS)) {
      current.endTime = e.ts;
      current.events.push({ x: posX, y: posY, ts: e.ts, type: e.type });
      if (Number.isFinite(posX) && Number.isFinite(posY)) { sumX += posX; sumY += posY; count++; }
    } else {
      if (isSignificantCluster(current, options)) {
        rawClusters.push(current);
      }
      current = {
        startTime: e.ts,
        endTime: e.ts,
        events: [{ x: posX, y: posY, ts: e.ts, type: e.type }],
      };
      sumX = Number.isFinite(posX) ? posX : 0;
      sumY = Number.isFinite(posY) ? posY : 0;
      count = Number.isFinite(posX) && Number.isFinite(posY) ? 1 : 0;
    }
  }

  if (current && isSignificantCluster(current, options)) {
    rawClusters.push(current);
  }

  return mergeNearbyClusters(rawClusters, videoWidth, videoHeight, Math.max(0, Math.min(5000, options.mergeGapMs ?? options.cooldownMs)), options.deadZone);
}

/**
 * Evaluate if a cluster is genuinely significant.
 * Any deliberate click focuses the camera; sustained typing or dense mixed
 * activity qualifies too.
 */
function isSignificantCluster(cluster: ActivityCluster, options: AutoZoomConfig): boolean {
  const keydownCount = cluster.events.filter((e) => e.type === "keydown").length;
  const clickCount = cluster.events.filter((e) => e.type === "mousedown").length;

  if (clickCount >= 1) return true;
  if (options.focusMode === "clicks") return false;
  if (keydownCount >= options.typingSensitivity) return true;
  const wheelCount = cluster.events.filter((e) => e.type === "wheel").length;
  const followCount = cluster.events.filter((e) => e.type === "follow").length;
  return followCount > 0 || wheelCount >= options.scrollSensitivity;
}

/**
 * Merge nearby clusters only when their focus remains spatially compatible.
 * This prevents rapid clicks on opposite sides of the screen from collapsing
 * into one weak, nearly full-screen zoom.
 */
function mergeNearbyClusters(clusters: ActivityCluster[], videoWidth: number, videoHeight: number, mergeGapMs: number, deadZone: number): ActivityCluster[] {
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

    if (gap <= mergeGapMs && spatialDistance <= deadZone) {
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
  const clicks = cluster.events.filter((event) => Number.isFinite(event.x) && Number.isFinite(event.y));
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
  return Math.round(clamp(baseMs * (0.9 + travel * 1.2 + scaleTravel * 0.35), 480, 1400));
}

/**
 * Compute the focal center and scale for a cluster.
 * Positions come ONLY from mouse clicks (keydowns have no coordinates and
 * wheel deltas are not positions) — using them polluted the focus box.
 */
function clusterFocus(
  cluster: ActivityCluster,
  videoWidth: number,
  videoHeight: number,
  options: AutoZoomConfig
): { cx: number; cy: number; scale: number } {
  const clicks = cluster.events.filter(
    (e) => e.type === "mousedown" && e.x >= 0 && e.y >= 0 && e.x <= videoWidth && e.y <= videoHeight
  );

  // Typing bursts inherit the last known cursor position, which is generally
  // the field the user clicked before typing. Fall back to center only when
  // the input log truly has no positional context.
  if (clicks.length === 0) {
    const anchors = cluster.events.filter(
      (event) => (event.type === "keydown" || event.type === "follow" || event.type === "wheel") && event.x >= 0 && event.y >= 0 && event.x <= videoWidth && event.y <= videoHeight
    );
    if (anchors.length === 0) return { cx: 0.5, cy: 0.5, scale: options.minScale };
    const anchor = anchors[anchors.length - 1];
    const isTyping = anchors.some((event) => event.type === "keydown");
    const scale = clamp(isTyping ? options.typingScale : options.minScale, options.minScale, options.maxScale);
    const safeEdge = Math.min(0.48, 0.5 / scale + options.edgePadding);
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
  // Two/few real actions at opposite edges need context, not outlier rejection.
  const focusClicks = clicks.length >= 8 && inliers.length >= clicks.length * .8 ? inliers : clicks;

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
    ? Math.min(options.maxScale, Math.max(options.minScale, options.singleClickScale))
    : clamp(fit * 0.9, 1, options.maxScale);

  const safeEdge = Math.min(0.48, 0.5 / scale + options.edgePadding);
  const cx = clamp((weightedX / totalWeight) / videoWidth, safeEdge, 1 - safeEdge);
  const cy = clamp((weightedY / totalWeight) / videoHeight, safeEdge, 1 - safeEdge);

  return { cx, cy, scale };
}

/**
 * Plan shots with look-ahead: arrive near the action, frame rapid activity
 * together, hold while useful, and return to context during genuine inactivity.
 */
export function generateKeyframes(
  events: InputEvent[],
  videoWidth: number,
  videoHeight: number,
  videoDurationMs: number,
  transitionDurationMs: number = 600,
  requestedOptions: Partial<AutoZoomConfig> = {}
): Keyframe[] {
  const safeWidth = Number.isFinite(videoWidth) ? Math.max(1, videoWidth) : 1;
  const safeHeight = Number.isFinite(videoHeight) ? Math.max(1, videoHeight) : 1;
  const safeDuration = Number.isFinite(videoDurationMs) ? Math.max(0, videoDurationMs) : 0;
  const baseTransitionMs = clamp(Number.isFinite(transitionDurationMs) ? transitionDurationMs : 800, 180, 1600);
  const options: AutoZoomConfig = {
    preset: "balanced", ...AUTO_ZOOM_PRESETS.balanced, ...requestedOptions,
  };
  for (const key of ["minScale","maxScale","holdMs","cooldownMs","typingSensitivity","scrollSensitivity","edgePadding","deadZone","idleResetMs","singleClickScale","typingScale","minimumShotMs"] as const) {
    if (!Number.isFinite(options[key])) options[key] = AUTO_ZOOM_PRESETS.balanced[key];
  }
  options.minScale = clamp(options.minScale, 1.05, 3);
  options.maxScale = clamp(options.maxScale, options.minScale, 4);
  options.holdMs = clamp(options.holdMs, 300, 4000);
  options.cooldownMs = clamp(options.cooldownMs, 0, 2500);
  options.typingSensitivity = clamp(Math.round(options.typingSensitivity), 2, 20);
  options.scrollSensitivity = clamp(Math.round(options.scrollSensitivity), 1, 20);
  options.edgePadding = clamp(options.edgePadding, 0, 0.15);
  options.deadZone = clamp(options.deadZone, .02, .35);
  options.idleResetMs = clamp(options.idleResetMs, 900, 12_000);
  options.singleClickScale = clamp(options.singleClickScale, options.minScale, options.maxScale);
  options.typingScale = clamp(options.typingScale, options.minScale, options.maxScale);
  options.minimumShotMs = clamp(options.minimumShotMs, 350, 4000);
  const eligibleEvents = events.filter(event => !(options.excludedRanges ?? []).some(range => event.ts >= range.start && event.ts <= range.end));
  const clusters = findClusters(eligibleEvents, safeWidth, safeHeight, safeDuration, options);

  // Default: unzoomed full-screen 1.0x
  if (clusters.length === 0 || safeDuration === 0) {
    const defaultKfs: Keyframe[] = [
      { time: 0, duration: 0, x: 0.5, y: 0.5, scale: 1.0, easing: "ease", source: "auto" },
    ];
    return defaultKfs;
  }

  // Chasing several distant clicks in a fraction of a second causes queued,
  // late pans. Give them one wider establishing shot instead.
  const shots: ActivityCluster[] = [];
  for (const cluster of clusters) {
    const previous = shots[shots.length - 1];
    const crossesExclusion = previous && (options.excludedRanges ?? []).some(range => range.start <= cluster.startTime && range.end >= previous.endTime);
    const a = previous && clusterFocus(previous, safeWidth, safeHeight, options);
    const b = clusterFocus(cluster, safeWidth, safeHeight, options);
    const sameFocus = a && Math.hypot(a.cx - b.cx, a.cy - b.cy) <= options.deadZone && Math.abs(a.scale - b.scale) < .18;
    if (previous && !crossesExclusion && (
      cluster.startTime - previous.startTime < Math.max(options.minimumShotMs, baseTransitionMs + 350)
      || sameFocus && cluster.startTime - previous.endTime < options.idleResetMs
    )) {
      previous.endTime = cluster.endTime;
      previous.events.push(...cluster.events);
    } else shots.push({ ...cluster, events: [...cluster.events] });
  }
  const targets = shots.map(cluster => {
    const target = clusterFocus(cluster, safeWidth, safeHeight, options);
    // Keep protected rectangles visible by widening the camera crop around
    // the focus. Rectangles use normalized source coordinates.
    for (const area of options.protectedAreas ?? []) {
      if (![area.x,area.y,area.w,area.h].every(Number.isFinite)) continue;
      const left = Math.max(0,Math.min(target.cx-.5/target.scale,area.x));
      const right = Math.min(1,Math.max(target.cx+.5/target.scale,area.x+area.w));
      const top = Math.max(0,Math.min(target.cy-.5/target.scale,area.y));
      const bottom = Math.min(1,Math.max(target.cy+.5/target.scale,area.y+area.h));
      target.scale = Math.max(1,Math.min(target.scale,1/Math.max(right-left,bottom-top,.001)));
      target.cx = clamp((left+right)/2,.5/target.scale,1-.5/target.scale);
      target.cy = clamp((top+bottom)/2,.5/target.scale,1-.5/target.scale);
    }
    return { x: target.cx, y: target.cy, scale: target.scale };
  });
  const full = { x: .5, y: .5, scale: 1 };
  const keyframes: Keyframe[] = [{ time: 0, duration: 0, ...full, easing: options.curve }];
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i], target = targets[i];
    const previous = keyframes[keyframes.length - 1];
    const moveDuration = transitionForDistance(baseTransitionMs, previous, target);
    const start = Math.max(previous.time, shot.startTime + 180 - moveDuration, 0);
    const arrival = Math.min(safeDuration, start + moveDuration);
    // Don't manufacture a tiny abrupt zoom at the final frame.
    if (arrival - start < 350 || safeDuration - arrival < 250) continue;
    keyframes.push({ time: arrival, duration: arrival - start, ...target, easing: options.curve });
    const next = shots[i + 1];
    const resetDuration = transitionForDistance(baseTransitionMs, target, full);
    const nextStart = next ? next.startTime + 180 - transitionForDistance(baseTransitionMs, target, targets[i + 1]) : safeDuration;
    const idle = !next || next.startTime - shot.endTime >= options.idleResetMs;
    const typing = shot.events.some(event => event.type === "keydown");
    const tail = Math.max(options.holdMs, typing ? 1100 : LEAD_OUT_MS);
    const desiredHold = Math.max(arrival + options.holdMs, start + options.minimumShotMs, shot.endTime + tail);
    const holdEnd = Math.min(safeDuration, Math.max(arrival, Math.min(desiredHold, nextStart)));
    // Holds must have EXACTLY the arrival pose. Changing their x/y with a zero
    // transition made the old merged shots jump at the hold endpoint.
    if (holdEnd > arrival) keyframes.push({ time: holdEnd, duration: 0, ...target, easing: options.curve });
    if (idle && nextStart - holdEnd >= resetDuration) {
      keyframes.push({ time: holdEnd + resetDuration, duration: resetDuration, ...full, easing: options.curve });
    }
  }
  const lastKf = keyframes[keyframes.length - 1];
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
  const normalized = normalizeTrajectory(keyframes, safeDuration, options.maxScale).map((frame) => {
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

function normalizeTrajectory(keyframes: Keyframe[], videoDurationMs: number, maxScale: number): Keyframe[] {
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  const normalized: Keyframe[] = [];
  for (const raw of sorted) {
    const frame = {
      ...raw,
      time: Math.round(clamp(raw.time, 0, videoDurationMs)),
      duration: Math.max(0, Math.round(raw.duration || 0)),
      x: clamp(raw.x, 0, 1),
      y: clamp(raw.y, 0, 1),
      scale: clamp(raw.scale, 1, maxScale),
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
