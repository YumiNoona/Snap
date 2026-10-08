import type { VideoClip } from "./types";
import { MIN_CLIP_SECONDS } from "./videoEditing";

export function moveClips(clips: VideoClip[], ids: string[], destination: number): VideoClip[] {
  const selected = new Set(ids), moving = clips.filter(c => selected.has(c.id));
  const before = clips.slice(0, destination).filter(c => !selected.has(c.id)).length;
  const rest = clips.filter(c => !selected.has(c.id));
  return [...rest.slice(0, before), ...moving, ...rest.slice(before)];
}
export function duplicateClips(clips: VideoClip[], ids: string[]): VideoClip[] {
  const selected=clips.filter(c=>ids.includes(c.id));
  if (!selected.length || clips.length + selected.length > 1000) return clips;
  const groups=new Map<string,string>();
  const copies=selected.map(c=>{if(c.groupId&&!groups.has(c.groupId))groups.set(c.groupId,`group-${crypto.randomUUID()}`);return {...c,id:`clip-${crypto.randomUUID()}`,groupId:c.groupId?groups.get(c.groupId):undefined};});
  const after=clips.findIndex(c=>c.id===selected[selected.length-1].id)+1;
  return [...clips.slice(0,after),...copies,...clips.slice(after)];
}
export function combineClips(clips: VideoClip[], ids: string[]): VideoClip[] {
  const indices = clips.flatMap((c, i) => ids.includes(c.id) ? [i] : []);
  if (indices.length < 2 || indices.some((index, i) => i > 0 && index !== indices[i - 1] + 1)) return clips;
  if(indices.some((index,i)=>i>0&&Math.abs(clips[index].start-clips[index-1].end)>.001)) {
    const groupId=`group-${crypto.randomUUID()}`;
    return clips.map(c=>ids.includes(c.id)?{...c,groupId}:c);
  }
  const first = indices[0], last = indices[indices.length - 1];
  return [...clips.slice(0, first), { ...clips[first], end: clips[last].end }, ...clips.slice(last + 1)];
}
export function slipClip(clips: VideoClip[], id: string, delta: number, sourceDuration: number): VideoClip[] {
  return clips.map(c => {
    if (c.id !== id) return c;
    const shift = Math.max(-c.start, Math.min(sourceDuration - c.end, delta));
    return { ...c, start: c.start + shift, end: c.end + shift };
  });
}
export function rollCut(clips: VideoClip[], leftId: string, delta: number, sourceDuration: number): VideoClip[] {
  const index = clips.findIndex(c => c.id === leftId), left = clips[index], right = clips[index + 1];
  if (!left || !right) return clips;
  const shift = Math.max(Math.max(MIN_CLIP_SECONDS - (left.end - left.start), -right.start),
    Math.min(Math.min(right.end - right.start - MIN_CLIP_SECONDS, sourceDuration - left.end), delta));
  return clips.map((c, i) => i === index ? { ...c, end: c.end + shift } : i === index + 1 ? { ...c, start: c.start + shift } : c);
}
