/** Ignore empty GPU initialization thumbnails, while retaining dark windows with visible content. */
export function hasWindowPreviewContent(pixels: ArrayLike<number>): boolean {
  let visible = 0;
  const count = Math.floor(pixels.length / 4);
  if (!count) return false;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i+3] > 16 && Math.max(pixels[i],pixels[i+1],pixels[i+2]) > 24) visible++;
  }
  return visible >= Math.max(1,Math.ceil(count * .005));
}
