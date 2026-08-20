export function clampPlaybackTime(time: number, start: number, end: number): number {
  const safeStart = Number.isFinite(start) ? Math.max(0, start) : 0;
  const safeEnd = Number.isFinite(end) ? Math.max(safeStart, end) : safeStart;
  if (!Number.isFinite(time)) return safeStart;
  return Math.max(safeStart, Math.min(time, safeEnd));
}

export function shouldResyncSidecar(
  sidecarTime: number,
  videoTime: number,
  force = false,
  thresholdSeconds = 0.18,
): boolean {
  if (force) return true;
  if (!Number.isFinite(sidecarTime) || !Number.isFinite(videoTime)) return true;
  return Math.abs(sidecarTime - videoTime) > Math.max(0, thresholdSeconds);
}

/** Only the newest asynchronous transport completion may mutate playback. */
export function isAuthoritativeTransportCommand(
  completedGeneration: number,
  currentGeneration: number,
): boolean {
  return completedGeneration === currentGeneration;
}

export function isAtPlaybackBoundary(
  currentTime: number,
  ended: boolean,
  start: number,
  end: number,
  toleranceSeconds = 0.025,
): boolean {
  if (ended) return true;
  if (!Number.isFinite(currentTime)) return true;
  if (currentTime < Math.max(0, start) - toleranceSeconds) return true;
  return end > start && currentTime >= end - toleranceSeconds;
}

/**
 * WebView2 can complete a backwards seek from the decoded end frame without
 * presenting a new frame. Rebuild the decoder when the user returns to the
 * beginning from the end (or makes an almost full-length backwards jump).
 */
export function shouldRebuildForSeek(options: {
  currentTime: number;
  targetTime: number;
  start: number;
  end: number;
  ended: boolean;
}): boolean {
  const { currentTime, targetTime, start, end, ended } = options;
  if (!Number.isFinite(currentTime) || !Number.isFinite(targetTime)) return true;
  const span = Math.max(0, end - start);
  const returningToStart = targetTime <= start + Math.max(0.08, span * 0.002);
  const wasAtEnd = ended || (span > 0 && currentTime >= end - Math.max(0.08, span * 0.002));
  const largeBackwardsJump = span > 0 && currentTime - targetTime >= span * 0.8;
  return returningToStart && (wasAtEnd || largeBackwardsJump);
}

export function shouldRecoverStalledPlayback(options: {
  wantsPlayback: boolean;
  paused: boolean;
  seeking: boolean;
  stalledForMs: number;
  thresholdMs?: number;
}): boolean {
  const { wantsPlayback, paused, seeking, stalledForMs, thresholdMs = 1_500 } = options;
  return wantsPlayback && !paused && !seeking && stalledForMs >= thresholdMs;
}
