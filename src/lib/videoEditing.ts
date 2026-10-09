import type { CaptionTrack, VideoClip } from "./types";

export const MIN_CLIP_SECONDS = 1 / 240;
export const clipSpeed = (clip: VideoClip) => clip.gap ? 1 : Number.isFinite(clip.speed) ? Math.max(.25, Math.min(4, clip.speed!)) : 1;
export const clipDuration = (clip: VideoClip) => (clip.end - clip.start) / clipSpeed(clip);
export const frameDuration = (fps = 30) => 1 / (Number.isFinite(fps) && fps >= 1 ? Math.min(240, fps) : 30);
export function retainedClips(clips: VideoClip[] | null | undefined, start: number, end: number): VideoClip[] {
  return (clips ?? [{ id: "recording", start, end }]).filter(c => c && typeof c.id === "string" && Number.isFinite(c.start) && Number.isFinite(c.end))
    .flatMap(c => {
      const from = c.gap ? 0 : Math.max(start, c.start), to = c.gap ? c.end - c.start : Math.min(end, c.end);
      if (to - from < MIN_CLIP_SECONDS - 1e-6) return [];
      return [{ ...c, start: from, end: to }];
    }).map((clip,index,list)=>clip.transition&&(index===0||list[index-1].gap)?{...clip,transition:undefined}:clip);
}
export function sequenceDuration(clips: VideoClip[]): number { return clips.reduce((sum, c) => sum + clipDuration(c), 0); }
export function splitClip(clips: VideoClip[], time: number, clipId?: string, fps = 30): VideoClip[] {
  const minimum = frameDuration(fps);
  const target = clipId ?? clips.find(c => time - c.start >= minimum - 1e-7 && c.end - time >= minimum - 1e-7)?.id;
  if (clips.length >= 1000) return clips;
  return clips.flatMap(c => !c.gap && c.id === target && time - c.start >= minimum - 1e-7 && c.end - time >= minimum - 1e-7
    ? [{ ...c, end: time }, { ...c, id: `clip-${crypto.randomUUID()}`, sourceClipId:c.id, transition:undefined, start: time }] : [c]);
}
/** Source clock -> joined sequence clock; removed intervals map to the join. */
export function sequenceTime(clips: VideoClip[], time: number, clipId?: string): number {
  const target = clipId ? clips.findIndex(c => c.id === clipId) : clips.findIndex(c => time >= c.start && time < c.end);
  let elapsed = 0;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    if (i === target) return elapsed + Math.max(0, Math.min(c.end - c.start, time - c.start)) / clipSpeed(c);
    if (target < 0 && time < c.start) return elapsed;
    elapsed += clipDuration(c);
  }
  return elapsed;
}
export function sequenceClip(clips: VideoClip[], time: number): { clip: VideoClip; source: number } | null {
  let remaining = Math.max(0, time);
  for (let index = 0; index < clips.length; index++) {
    const clip = clips[index], length = clipDuration(clip);
    if (remaining < length - 1e-9 || index === clips.length - 1) return { clip, source: clip.start + Math.min(length, remaining) * clipSpeed(clip) };
    remaining -= length;
  }
  return null;
}
/** Joined sequence clock -> source clock, choosing the next clip at joins. */
export function sourceTime(clips: VideoClip[], time: number): number {
  let remaining = Math.max(0, time);
  for (const clip of clips) {
    const length = clipDuration(clip);
    if (remaining < length - 1e-9) return clip.start + remaining * clipSpeed(clip);
    remaining -= length;
  }
  return clips[clips.length - 1]?.end ?? 0;
}
export function retainedWaveform(data: number[], clips: VideoClip[], duration: number): number[] {
  if (!data.length || duration <= 0) return [];
  const length = sequenceDuration(clips);
  return data.map((_, i) => sequenceClip(clips, (i + .5) / data.length * length)?.clip.gap ? 0 : data[Math.min(data.length - 1, Math.floor(sourceTime(clips, (i + .5) / data.length * length) / duration * data.length))] ?? 0);
}
export function nextRetainedTime(clips: VideoClip[], time: number): number {
  for (const c of clips) { if (time < c.end) return Math.max(time, c.start); }
  return clips[clips.length - 1]?.end ?? 0;
}
export function mapCaptionTracks(tracks: CaptionTrack[], clips: VideoClip[]): CaptionTrack[] {
  const mapped = new Map<string, CaptionTrack>();
  for (const clip of clips.filter(clip => !clip.gap)) {
    for (const [index, track] of (clip.effects?.captions ?? tracks).entries()) {
      const id = clip.effects ? `${track.id ?? index}-${clip.id}` : track.id ?? `track-${index}`;
      const output = mapped.get(id) ?? { ...track, id, segments: [] };
      for (const segment of track.segments) {
        const start = Math.max(clip.start, segment.startMs / 1000), end = Math.min(clip.end, segment.endMs / 1000);
        if (end <= start) continue;
        const mapTime = (source: number) => (sequenceTime(clips, clip.start, clip.id) + (source - clip.start) / clipSpeed(clip)) * 1000;
        output.segments.push({ ...segment, id: `${segment.id}-${clip.id}`, startMs: mapTime(start), endMs: mapTime(end), words: segment.words?.filter(word => word.startMs < end * 1000 && word.endMs > start * 1000).map(word => ({ ...word, startMs: mapTime(Math.max(start, word.startMs / 1000)), endMs: mapTime(Math.min(end, word.endMs / 1000)) })) });
      }
      mapped.set(id, output);
    }
  }
  return [...mapped.values()];
}
