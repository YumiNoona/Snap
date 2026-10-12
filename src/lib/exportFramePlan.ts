import type { VideoClip } from "./types";
import { clipSpeed, sequenceClip, sequenceDuration } from "./videoEditing";

export function exportFramePosition(
  clips: VideoClip[],
  frame: number,
  fps: number,
  rate: number,
) {
  const sequence = Math.min(
    sequenceDuration(clips) - 0.000001,
    (frame / fps) * rate,
  );
  const position = sequenceClip(clips, Math.max(0, sequence));
  if (!position) throw new Error("Export timeline is empty");
  return {
    clip: position.clip,
    source: position.source,
    sequence: Math.max(0, sequence),
  };
}

/** Interpolate the source clock before composition; overlays keep sharp edges. */
export function motionSourceFps(
  clips: VideoClip[],
  fps: number,
  rate: number,
): number {
  const slowest = Math.min(
    1,
    ...clips.filter((clip) => !clip.gap).map((clip) => clipSpeed(clip) * rate),
  );
  return Math.min(240, Math.max(24, Math.ceil(fps / slowest)));
}
