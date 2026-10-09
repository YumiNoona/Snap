import type { VideoClip } from "./types";
import { frameDuration, clipDuration, clipSpeed, sequenceTime } from "./videoEditing";

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
  const copies=selected.map(c=>{if(c.groupId&&!groups.has(c.groupId))groups.set(c.groupId,`group-${crypto.randomUUID()}`);return {...structuredClone(c),id:`clip-${crypto.randomUUID()}`,sourceClipId:c.id,groupId:c.groupId?groups.get(c.groupId):undefined};});
  const after=clips.findIndex(c=>c.id===selected[selected.length-1].id)+1;
  return [...clips.slice(0,after),...copies,...clips.slice(after)];
}
export function combineClips(clips: VideoClip[], ids: string[]): VideoClip[] {
  const indices = clips.flatMap((c, i) => ids.includes(c.id) ? [i] : []);
  if (indices.some(index=>clips[index].gap) || indices.length < 2 || indices.some((index, i) => i > 0 && index !== indices[i - 1] + 1)) return clips;
  if(indices.some((index,i)=>i>0&&(Math.abs(clips[index].start-clips[index-1].end)>.001 || clipSpeed(clips[index])!==clipSpeed(clips[index-1]) || clips[index].gap || clips[index-1].gap || JSON.stringify(clips[index].effects)!==JSON.stringify(clips[index-1].effects)))) {
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
export function rollCut(clips: VideoClip[], leftId: string, delta: number, sourceDuration: number, fps = 30): VideoClip[] {
  const index = clips.findIndex(c => c.id === leftId), left = clips[index], right = clips[index + 1];
  if (!left || !right || left.gap || right.gap) return clips;
  const MIN_CLIP_SECONDS = frameDuration(fps);
  const factor=clipSpeed(right)/clipSpeed(left);
  const shift = Math.max(Math.max(MIN_CLIP_SECONDS - (left.end - left.start), -right.start/factor),
    Math.min(Math.min((right.end - right.start - MIN_CLIP_SECONDS)/factor, sourceDuration - left.end), delta));
  return clips.map((c, i) => i === index ? { ...c, end: c.end + shift } : i === index + 1 ? { ...c, start: c.start + shift*factor } : c);
}

/** Adjoining empty intervals are one free placement region. Preserve its first ID. */
export function mergeGaps(clips: VideoClip[]): VideoClip[] {
  const result: VideoClip[] = [];
  for (const clip of clips) {
    const previous = result[result.length - 1];
    if (clip.gap && previous?.gap) result[result.length - 1] = { ...previous, start: 0, end: clipDuration(previous) + clipDuration(clip) };
    else result.push(clip);
  }
  return result;
}

/** Delete normally leaves a typed gap; ripple deletion is deliberately explicit. */
export function deleteClips(clips: VideoClip[], ids: string[], ripple = false): VideoClip[] {
  const selected = new Set(ids);
  const includesFootage=clips.some(clip=>selected.has(clip.id)&&!clip.gap);
  return clips.flatMap(clip => !selected.has(clip.id) || clip.gap&&includesFootage&&!ripple ? [clip] : ripple || clip.gap ? [] : [{ id: `gap-${crypto.randomUUID()}`, start: 0, end: clipDuration(clip), gap: true }]);
}

export function changeClipSpeed(clips: VideoClip[], id: string, speed: number, ripple = false): VideoClip[] {
  if (!Number.isFinite(speed) || speed < .25 || speed > 4) return clips;
  const index = clips.findIndex(clip => clip.id === id);
  if (index < 0 || clips[index].gap) return clips;
  const updated = { ...clips[index], speed };
  const delta = clipDuration(updated) - clipDuration(clips[index]);
  if (ripple || Math.abs(delta) < 1e-6) return clips.map(clip => clip.id === id ? updated : clip);
  const next = clips[index + 1];
  if (delta > 0 && next && (!next.gap || clipDuration(next) + 1e-6 < delta)) return clips;
  const rest = clips.slice(index + 1);
  if (next?.gap) {
    rest.shift();
    const length = clipDuration(next) - delta;
    if (length > 1e-6) rest.unshift({ ...next, start: 0, end: length });
  } else if (delta < 0) rest.unshift({ id: `gap-${crypto.randomUUID()}`, start: 0, end: -delta, gap: true });
  return [...clips.slice(0,index), updated, ...rest];
}

/** Move to a precise timeline position without shifting other footage. */
export function placeClip(clips: VideoClip[], id: string, at: number): VideoClip[] {
  const target = clips.find(clip => clip.id === id);
  if (!target || target.gap || !Number.isFinite(at) || at < 0) return clips;
  const start = sequenceTime(clips, target.start, id), end = at + clipDuration(target);
  if (Math.abs(at - start) < 1e-6) return clips;
  const remaining = mergeGaps(deleteClips(clips,[id]));
  let elapsed = 0;
  const output: VideoClip[] = [];
  let inserted = false;
  for (const clip of remaining) {
    const length = clipDuration(clip), boundary = elapsed + length;
    if (!inserted && clip.gap && at >= elapsed - 1e-6 && end <= boundary + 1e-6) {
      if (at > elapsed + 1e-6) output.push({ ...clip, end: at-elapsed });
      output.push(target);
      if (end < boundary - 1e-6) output.push({ id: `gap-${crypto.randomUUID()}`, start:0,end:boundary-end,gap:true });
      inserted=true;
    } else output.push(clip);
    elapsed=boundary;
  }
  if (!inserted && at >= elapsed - 1e-6) {
    if (at > elapsed) output.push({ id: `gap-${crypto.randomUUID()}`,start:0,end:at-elapsed,gap:true });
    output.push(target);inserted=true;
  }
  return inserted ? output : clips;
}

export function trimClipRange(clips:VideoClip[],id:string,start:number,end:number,ripple=false):VideoClip[] {
  const index=clips.findIndex(clip=>clip.id===id),clip=clips[index];
  if(!clip||clip.gap||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end-start<1/240-1e-6)return clips;
  const leading=(start-clip.start)/clipSpeed(clip),trailing=(clip.end-end)/clipSpeed(clip);
  const before=clips.slice(0,index),after=clips.slice(index+1);
  if(!ripple){
    if(leading<0&&(!before.length||!before[before.length-1].gap||clipDuration(before[before.length-1])+leading<-1e-6))return clips;
    if(trailing<0&&after.length&&(!after[0].gap||clipDuration(after[0])+trailing<-1e-6))return clips;
    const adjust=(items:VideoClip[],delta:number,front:boolean)=>{
      const neighbour=front?items[0]:items[items.length-1];
      const length=delta+(neighbour?.gap?clipDuration(neighbour):0);
      if(neighbour?.gap){if(front)items.shift();else items.pop();}
      if(length>1e-6){const gap={id:neighbour?.gap?neighbour.id:`gap-${crypto.randomUUID()}`,start:0,end:length,gap:true};if(front)items.unshift(gap);else items.push(gap);}
    };
    adjust(before,leading,false);adjust(after,trailing,true);
  }
  return [...before,{...clip,start,end},...after];
}
