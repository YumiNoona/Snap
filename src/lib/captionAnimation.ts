import type { CaptionStyle } from "./types";

export interface CaptionAnimationFrame {
  alpha: number;
  scale: number;
  rise: number;
  slide: number;
  blur: number;
  reveal: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const easeOutCubic = (value: number) => 1 - (1 - value) ** 3;

/** Deterministic caption entrance state shared by preview and export rendering. */
export function captionAnimationFrame(
  animation: NonNullable<CaptionStyle["animation"]>,
  elapsedMs: number,
  durationMs = 420,
): CaptionAnimationFrame {
  const elapsed = Math.max(0, elapsedMs);
  const duration = Math.max(120, durationMs);
  if (animation === "fade") {
    const progress = easeOutCubic(clamp01(elapsed / duration));
    return { alpha: progress, scale: 1, rise: 0, slide: 0, blur: 0, reveal: 1 };
  }
  if (animation === "reveal") {
    const progress = easeOutCubic(clamp01(elapsed / Math.max(duration, 520)));
    return { alpha: Math.min(1, .35 + progress), scale: 1, rise: 0, slide: 0, blur: 0, reveal: progress };
  }
  if (animation === "pop") {
    const progress = clamp01(elapsed / duration);
    const overshoot = 1 + 2.7 * (progress - 1) ** 3 + 1.7 * (progress - 1) ** 2;
    return { alpha: clamp01(progress * 2.5), scale: .72 + .28 * overshoot, rise: 0, slide: 0, blur: 0, reveal: 1 };
  }
  if (animation === "rise") {
    const progress = easeOutCubic(clamp01(elapsed / duration));
    return { alpha: progress, scale: 1, rise: 1 - progress, slide: 0, blur: 0, reveal: 1 };
  }
  if (animation === "slide") {
    const progress = easeOutCubic(clamp01(elapsed / duration));
    return { alpha: progress, scale: 1, rise: 0, slide: 1 - progress, blur: 0, reveal: 1 };
  }
  if (animation === "blur") {
    const progress = easeOutCubic(clamp01(elapsed / duration));
    return { alpha: progress, scale: .98 + .02 * progress, rise: 0, slide: 0, blur: 1 - progress, reveal: 1 };
  }
  if (animation === "bounce") {
    const progress = clamp01(elapsed / duration);
    const bounce = 1 - Math.abs(Math.cos(progress * Math.PI * 2.5)) * (1 - progress);
    return { alpha: clamp01(progress * 3), scale: .84 + .16 * bounce, rise: (1 - progress) * .45, slide: 0, blur: 0, reveal: 1 };
  }
  return { alpha: 1, scale: 1, rise: 0, slide: 0, blur: 0, reveal: 1 };
}

export function revealCaptionText(text: string, progress: number): string {
  const characters = Array.from(text.trim());
  if (characters.length === 0) return "";
  return characters.slice(0, Math.max(1, Math.ceil(characters.length * clamp01(progress)))).join("").trimEnd();
}
