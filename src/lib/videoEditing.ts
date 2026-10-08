import type { CaptionTrack, VideoClip } from "./types";

export const MIN_CLIP_SECONDS = .1;
export function retainedClips(clips: VideoClip[] | null | undefined, start: number, end: number): VideoClip[] {
  return (clips ?? [{ id: "recording", start, end }]).filter(c => c && typeof c.id === "string" && Number.isFinite(c.start) && Number.isFinite(c.end))
    .flatMap(c => {
      const from = Math.max(start, c.start), to = Math.min(end, c.end);
      if (to - from < MIN_CLIP_SECONDS - 1e-6) return [];
      return [{ ...c, start: from, end: to }];
    });
}
export function sequenceDuration(clips: VideoClip[]): number { return clips.reduce((sum, c) => sum + c.end - c.start, 0); }
export function splitClip(clips: VideoClip[], time: number, clipId?: string): VideoClip[] {
  const target = clipId ?? clips.find(c => time - c.start >= MIN_CLIP_SECONDS && c.end - time >= MIN_CLIP_SECONDS)?.id;
  if (clips.length >= 1000) return clips;
  return clips.flatMap(c => c.id === target && time - c.start >= MIN_CLIP_SECONDS && c.end - time >= MIN_CLIP_SECONDS
    ? [{ ...c, end: time }, { ...c, id: `clip-${crypto.randomUUID()}`, start: time }] : [c]);
}
/** Source clock -> joined sequence clock; removed intervals map to the join. */
export function sequenceTime(clips: VideoClip[], time: number, clipId?: string): number {
  const target = clipId ? clips.findIndex(c => c.id === clipId) : clips.findIndex(c => time >= c.start && time < c.end);
  let elapsed = 0;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    if (i === target) return elapsed + Math.max(0, Math.min(c.end - c.start, time - c.start));
    if (target < 0 && time < c.start) return elapsed;
    elapsed += c.end - c.start;
  }
  return elapsed;
}
export function sequenceClip(clips: VideoClip[], time: number): { clip: VideoClip; source: number } | null {
  let remaining = Math.max(0, time);
  for (let index = 0; index < clips.length; index++) {
    const clip = clips[index], length = clip.end - clip.start;
    if (remaining < length || index === clips.length - 1) return { clip, source: clip.start + Math.min(length, remaining) };
    remaining -= length;
  }
  return null;
}
/** Joined sequence clock -> source clock, choosing the next clip at joins. */
export function sourceTime(clips: VideoClip[], time: number): number {
  let remaining = Math.max(0, time);
  for (const clip of clips) {
    const length = clip.end - clip.start;
    if (remaining < length) return clip.start + remaining;
    remaining -= length;
  }
  return clips[clips.length - 1]?.end ?? 0;
}
export function retainedWaveform(data: number[], clips: VideoClip[], duration: number): number[] {
  if (!data.length || duration <= 0) return [];
  const length = sequenceDuration(clips);
  return data.map((_, i) => data[Math.min(data.length - 1, Math.floor(sourceTime(clips, (i + .5) / data.length * length) / duration * data.length))] ?? 0);
}
export function nextRetainedTime(clips: VideoClip[], time: number): number {
  for (const c of clips) { if (time < c.end) return Math.max(time, c.start); }
  return clips[clips.length - 1]?.end ?? 0;
}
export function mapCaptionTracks(tracks: CaptionTrack[], clips: VideoClip[]): CaptionTrack[] {
  return tracks.map(track => ({ ...track, segments: track.segments.flatMap(segment => clips.flatMap(c => {
    const start = Math.max(c.start, segment.startMs / 1000), end = Math.min(c.end, segment.endMs / 1000);
    if (end <= start) return [];
    return [{ ...segment, id: `${segment.id}-${c.id}`, startMs: (sequenceTime(clips, c.start, c.id) + start - c.start) * 1000, endMs: (sequenceTime(clips, c.start, c.id) + end - c.start) * 1000, words: segment.words?.filter(word=>word.startMs<end*1000&&word.endMs>start*1000).map(word=>({...word,startMs:(sequenceTime(clips,c.start,c.id)+Math.max(start,word.startMs/1000)-c.start)*1000,endMs:(sequenceTime(clips,c.start,c.id)+Math.min(end,word.endMs/1000)-c.start)*1000})) }];
  })) }));
}
