import type { CaptionTrack, Keyframe, VideoClip } from "./types";
import { retainedClips, sequenceDuration, sequenceTime, mapCaptionTracks } from "./videoEditing";
import { collectZoomRegions } from "./zoomRegions";
import { exportPlaybackRate, outputDuration } from "./exportTiming";

export function buildDeliveryPackage(tracks: CaptionTrack[], frames: Keyframe[], start: number, end: number, rate: number, videoClips?: VideoClip[] | null) {
  const clips = retainedClips(videoClips, start, end);
  tracks = mapCaptionTracks(tracks, clips);
  const playbackRate = exportPlaybackRate(rate);
  const duration = outputDuration(0, sequenceDuration(clips), playbackRate);
  const transcript = tracks.flatMap((track) => track.visible ? track.segments : [])
    .sort((a, b) => a.startMs - b.startMs)
    .map((segment) => segment.text.trim()).filter(Boolean).join("\n");
  const chapters = collectZoomRegions(frames, Math.round(end * 1000))
    .flatMap(region => clips.flatMap(clip => {
      const from = Math.max(clip.start, region.startMs / 1000), to = Math.min(clip.end, region.endMs / 1000);
      return to > from ? [{ ...region, startMs: (sequenceTime(clips, clip.start, clip.id) + from - clip.start) * 1000, endMs: (sequenceTime(clips, clip.start, clip.id) + to - clip.start) * 1000 }] : [];
    }))
    .sort((a, b) => a.startMs - b.startMs)
    .map((region, index) => ({
      title: `Chapter ${index + 1}`,
      startSeconds: Math.max(0, region.startMs / 1000 / playbackRate),
      endSeconds: Math.min(duration, region.endMs / 1000 / playbackRate),
    }));
  return { transcript: transcript || "No captions were available for this export.", chapters: JSON.stringify(chapters, null, 2), thumbnailTimeSeconds: duration * .35 };
}
