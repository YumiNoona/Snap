export function exportPlaybackRate(rate: number): number {
  return Number.isFinite(rate) && rate > 0 ? Math.max(.5, Math.min(2, rate)) : 1;
}

export function outputDuration(start: number, end: number, rate: number): number {
  return Math.max(.01, (end - start) / exportPlaybackRate(rate));
}

export function renderProgress(time: number, start: number, end: number): number {
  return Math.max(0, Math.min(.97, (time - start) / Math.max(.001, end - start)));
}
