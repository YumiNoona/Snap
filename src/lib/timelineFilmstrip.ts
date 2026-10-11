/** Sample the visible source interval, using the existing ten-frame cache atlas. */
export function filmstripFrames(
  start: number,
  end: number,
  duration: number,
  width: number,
): number[] {
  if (
    ![start, end, duration, width].every(Number.isFinite) ||
    end <= start ||
    duration <= 0 ||
    width <= 0
  )
    return [];
  const count = Math.min(200, Math.max(1, Math.ceil(width / 104)));
  return Array.from({ length: count }, (_, i) =>
    Math.max(
      0,
      Math.min(
        9,
        Math.floor(
          ((start + ((i + 0.5) / count) * (end - start)) / duration) * 10,
        ),
      ),
    ),
  );
}
