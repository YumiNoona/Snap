import type { AudioTrack } from "./types";
import type { VideoClip } from "./types";
import { sequenceDuration,sourceTime } from "./videoEditing";
export const isAudioLinked=(track:AudioTrack)=>track.linked??true;
export function audioPosition(track:AudioTrack,source:number,sequence:number) {
  const start=track.sourceStart??0, end=track.sourceEnd??Infinity;
  const time=isAudioLinked(track)?source:sequence-(track.start??0)+start;
  return {time:Math.max(0,time),active:time>=start&&time<end};
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
    const position=audioPosition(track,sourceTime(clips,sequence),sequence);
    if(!position.active||position.time>=duration)return 0;
    const bucket=Math.min(data.length-1,Math.floor(position.time/duration*data.length));
    return (data[bucket]??0)*Math.min(1,audioEnvelope(track,position.time,duration));
  });
}
