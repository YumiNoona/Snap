export function timelineHeightBounds(visibleTrackCount: number): { minimum: number; maximum: number } {
  const rows = Math.max(1, Math.floor(visibleTrackCount));
  const natural = 52 + 24 + 40 + Math.max(0, rows - 1) * 36;
  const minimum = Math.min(190, Math.max(124, natural));
  return { minimum, maximum: Math.max(minimum, Math.min(620, natural)) };
}
