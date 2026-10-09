import type { AudioTrack, AudioClip } from "./types";
import type { VideoClip } from "./types";
import { sequenceDuration,sourceTime,sequenceClip,sequenceTime,clipSpeed } from "./videoEditing";
export const isAudioLinked=(track:AudioTrack)=>track.linked??true;
export interface ResolvedAudioClip extends AudioClip { speed: number; end: number }
export function resolvedAudioClips(track:AudioTrack,clips:VideoClip[],duration:number):ResolvedAudioClip[] {
  const sourceStart=track.sourceStart??0,sourceEnd=Math.min(track.sourceEnd??duration,duration);
  const bases:AudioClip[]=track.clips??(isAudioLinked(track)?clips.filter(clip=>!clip.gap).flatMap(clip=>{
    const start=Math.max(sourceStart,clip.start),end=Math.min(sourceEnd,clip.end);
    return end>start?[{id:`${track.id}-${clip.id}`,sourceStart:start,sourceEnd:end,start:sequenceTime(clips,start,clip.id),videoClipId:clip.id}]:[];
  }):[{id:`${track.id}-audio`,sourceStart,sourceEnd,start:track.start??0}]);
  return bases.flatMap(segment=>{
    const linked=(segment.linked??isAudioLinked(track))&&!!segment.videoClipId;
    const video=linked?clips.find(clip=>clip.id===segment.videoClipId&&!clip.gap):undefined;
    if(linked&&!video)return [];
    const from=video?Math.max(video.start,segment.sourceStart):segment.sourceStart,to=video?Math.min(video.end,segment.sourceEnd):segment.sourceEnd;
    if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from)return [];
    const speed=video?clipSpeed(video):Math.max(.25,Math.min(4,segment.speed??1));
    const start=video?sequenceTime(clips,from,video.id):Math.max(0,segment.start);
    return [{...segment,sourceStart:from,sourceEnd:to,start,speed,end:start+(to-from)/speed}];
  }).sort((a,b)=>a.start-b.start);
}
export function audioPosition(track:AudioTrack,source:number,sequence:number,clips:VideoClip[]=[]) {
  if(track.clips!==undefined){
    const segment=resolvedAudioClips(track,clips,Infinity).find(clip=>sequence>=clip.start&&sequence<clip.end);
    return segment?{time:segment.sourceStart+(sequence-segment.start)*segment.speed,active:true,speed:segment.speed,clip:segment}:{time:0,active:false,speed:1};
  }
  const start=track.sourceStart??0,end=track.sourceEnd??Infinity;
  const time=isAudioLinked(track)?source:sequence-(track.start??0)+start;
  return {time:Number.isFinite(time)?Math.max(0,time):0,active:Number.isFinite(time)&&time>=start&&time<end,speed:undefined as number|undefined,clip:undefined as ResolvedAudioClip|undefined};
}
export function splitAudioClip(track:AudioTrack,clips:VideoClip[],duration:number,id:string,time:number,fps=30):AudioTrack {
  const segments=resolvedAudioClips(track,clips,duration),rate=Math.max(1,fps);
  const segment=segments.find(clip=>clip.id===id);
  if(!segment)return track;
  const source=Math.round((segment.sourceStart+(time-segment.start)*segment.speed)*rate)/rate;
  if(source-segment.sourceStart<1/rate-1e-6||segment.sourceEnd-source<1/rate-1e-6)return track;
  return {...track,clips:segments.flatMap(clip=>clip.id===id?[{...clip,sourceEnd:source,end:time,fadeOut:0},{...clip,id:`audio-${crypto.randomUUID()}`,sourceStart:source,start:time,fadeIn:0}]:[clip])};
}
export function audioClipEnvelope(clip:AudioClip|undefined,time:number):number {
  if(!clip)return 1;
  const length=clip.sourceEnd-clip.sourceStart,local=time-clip.sourceStart;
  return Math.max(0,Math.min(1,(clip.fadeIn??0)>0?local/Math.min(length,clip.fadeIn!):1,(clip.fadeOut??0)>0?(length-local)/Math.min(length,clip.fadeOut!):1)) * Math.max(0,Math.min(2,clip.volume??1));
}
export function reconcileAudioClips(tracks:AudioTrack[],previous:VideoClip[],next:VideoClip[]):AudioTrack[] {
  return tracks.map(track=>!track.clips?track:{...track,clips:track.clips.flatMap(segment=>{
    if(!(segment.linked??isAudioLinked(track))||!segment.videoClipId)return [segment];
    const old=previous.find(clip=>clip.id===segment.videoClipId);
    if(!old)return [segment];
    return next.filter(clip=>!clip.gap&&(clip.id===old.id||!previous.some(item=>item.id===clip.id)&&(clip.sourceClipId?clip.sourceClipId===old.id:clip.start>=old.start-1e-6&&clip.end<=old.end+1e-6))).flatMap((clip,index)=>{
      const slipped=clip.id===old.id&&Math.abs((clip.end-old.end)-(clip.start-old.start))<1e-6;
      const shift=slipped?clip.start-old.start:0;
      const from=Math.max(segment.sourceStart+shift,clip.start),to=Math.min(segment.sourceEnd+shift,clip.end);
      return to>from?[{...segment,id:index===0?segment.id:`audio-${crypto.randomUUID()}`,videoClipId:clip.id,sourceStart:from,sourceEnd:to}]:[];
    });
  })});
}
export function audioEnvelope(track:AudioTrack,time:number,duration:number):number {
  const start=track.sourceStart??0,end=Math.min(track.sourceEnd??duration,duration);
  if(time<start||time>=end)return 0;
  const fadeIn=track.fadeIn??0,fadeOut=track.fadeOut??0;
  const fade=Math.min(1,fadeIn>0?(time-start)/fadeIn:1,fadeOut>0?(end-time)/fadeOut:1);
  const keys=[...(track.volumeKeys??[])].filter(k=>Number.isFinite(k.time)&&Number.isFinite(k.volume)).sort((a,b)=>a.time-b.time);
  const local=time-start,right=keys.findIndex(k=>k.time>local);
  let volume=track.volume;
  if(keys.length) {
    if(right===0) volume=keys[0].volume;
    else if(right<0)volume=keys[keys.length-1].volume;
    else {const a=keys[right-1],b=keys[right];volume=a.volume+(b.volume-a.volume)*(local-a.time)/Math.max(.001,b.time-a.time);}
  }
  return Math.max(0,Math.min(2,volume))*Math.max(0,fade);
}

export function editedWaveform(data:number[],track:AudioTrack,clips:VideoClip[],duration:number):number[] {
  if(!data.length||duration<=0)return [];
  const length=sequenceDuration(clips);
  return data.map((_,index)=>{
    const sequence=(index+.5)/data.length*length;
    const position=audioPosition(track,sequenceClip(clips,sequence)?.clip.gap?NaN:sourceTime(clips,sequence),sequence,clips);
    if(!position.active||position.time>=duration)return 0;
    const bucket=Math.min(data.length-1,Math.floor(position.time/duration*data.length));
    return (data[bucket]??0)*Math.min(1,audioEnvelope(track,position.time,duration)*audioClipEnvelope(position.clip,position.time));
  });
}

export function duplicateAudioClip(track:AudioTrack,clips:VideoClip[],duration:number,id:string):AudioTrack {
  const segments=resolvedAudioClips(track,clips,duration),selected=segments.find(clip=>clip.id===id);
  if(!selected||segments.length>=1000)return track;
  const length=selected.end-selected.start;
  let start=selected.end;
  for(const segment of segments){if(segment.end<=start)continue;if(start+length<=segment.start)break;start=Math.max(start,segment.end);}
  return {...track,clips:[...segments,{...selected,id:`audio-${crypto.randomUUID()}`,start,linked:false}].sort((a,b)=>a.start-b.start)};
}
export function editAudioClip(track:AudioTrack,clips:VideoClip[],duration:number,id:string,patch:Partial<AudioClip>):AudioTrack {
  const segments=resolvedAudioClips(track,clips,duration);
  const next={...track,clips:segments.map(clip=>clip.id===id?{...clip,...patch}:clip)};
  const candidate=next.clips.find(clip=>clip.id===id);
  if(!candidate||!Number.isFinite(candidate.sourceStart)||!Number.isFinite(candidate.sourceEnd)||!Number.isFinite(candidate.start)||candidate.sourceStart<0||candidate.sourceEnd>duration||candidate.sourceEnd-candidate.sourceStart<1/240-1e-6||candidate.start<0)return track;
  const resolved=resolvedAudioClips(next,clips,duration);
  if(resolved.length!==segments.length)return track;
  if(resolved.some((clip,index)=>index>0&&clip.start<resolved[index-1].end-1e-6))return track;
  return next;
}
