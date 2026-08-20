import type { CaptionStyle } from "./types";

export interface CaptionAnimationFrame {
  alpha: number;
  scale: number;
  rise: number;
  reveal: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const easeOutCubic = (value: number) => 1 - (1 - value) ** 3;

/** Deterministic caption entrance state shared by preview and export rendering. */
export function captionAnimationFrame(
  animation: NonNullable<CaptionStyle["animation"]>,
  elapsedMs: number,
): CaptionAnimationFrame {
  const elapsed = Math.max(0, elapsedMs);
  if (animation === "fade") {
    const progress = easeOutCubic(clamp01(elapsed / 320));
    return { alpha: progress, scale: 1, rise: 0, reveal: 1 };
  }
  if (animation === "reveal") {
    const progress = easeOutCubic(clamp01(elapsed / 680));
    return { alpha: Math.min(1, .35 + progress), scale: 1, rise: 0, reveal: progress };
  }
  if (animation === "pop") {
    const progress = clamp01(elapsed / 420);
    const overshoot = 1 + 2.7 * (progress - 1) ** 3 + 1.7 * (progress - 1) ** 2;
    return { alpha: clamp01(progress * 2.5), scale: .72 + .28 * overshoot, rise: 0, reveal: 1 };
  }
  if (animation === "rise") {
    const progress = easeOutCubic(clamp01(elapsed / 380));
    return { alpha: progress, scale: 1, rise: 1 - progress, reveal: 1 };
  }
  return { alpha: 1, scale: 1, rise: 0, reveal: 1 };
}

export function revealCaptionText(text: string, progress: number): string {
  const characters = Array.from(text.trim());
  if (characters.length === 0) return "";
  return characters.slice(0, Math.max(1, Math.ceil(characters.length * clamp01(progress)))).join("").trimEnd();
}
