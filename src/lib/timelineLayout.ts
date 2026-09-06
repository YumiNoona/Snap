export function timelineHeightBounds(visibleTrackCount: number): { minimum: number; maximum: number } {
  const rows = Math.max(1, Math.floor(visibleTrackCount));
  const natural = 52 + 24 + 28 + 64 + Math.max(0, rows - 1) * 36;
  const minimum = Math.min(280, Math.max(220, natural));
  return { minimum, maximum: Math.max(320, Math.min(620, natural)) };
}
