import type { CaptionTrack, Keyframe } from "./types";
import { collectZoomRegions } from "./zoomRegions";
import { exportPlaybackRate, outputDuration } from "./exportTiming";

export function buildDeliveryPackage(tracks: CaptionTrack[], frames: Keyframe[], start: number, end: number, rate: number) {
  const playbackRate = exportPlaybackRate(rate);
  const duration = outputDuration(start, end, playbackRate);
  const transcript = tracks.flatMap((track) => track.visible ? track.segments : [])
    .filter((segment) => segment.endMs > start * 1000 && segment.startMs < end * 1000)
    .sort((a, b) => a.startMs - b.startMs)
    .map((segment) => segment.text.trim()).filter(Boolean).join("\n");
  const chapters = collectZoomRegions(frames, Math.round(end * 1000))
    .filter((region) => region.endMs > start * 1000 && region.startMs < end * 1000)
    .map((region, index) => ({
      title: `Chapter ${index + 1}`,
      startSeconds: Math.max(0, (region.startMs / 1000 - start) / playbackRate),
      endSeconds: Math.min(duration, (region.endMs / 1000 - start) / playbackRate),
    }));
  return { transcript: transcript || "No captions were available for this export.", chapters: JSON.stringify(chapters, null, 2), thumbnailTimeSeconds: duration * .35 };
}
