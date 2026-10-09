import { describe,it,expect } from "vitest";
import { deleteClips,changeClipSpeed,placeClip,trimClipRange,rollCut,slipClip,duplicateClips,combineClips } from "./clipOperations";
import { sequenceDuration,sequenceTime,sequenceClip,mapCaptionTracks } from "./videoEditing";
import { resolvedAudioClips,splitAudioClip,reconcileAudioClips,audioPosition,audioClipEnvelope,duplicateAudioClip,editAudioClip } from "./audioEditing";
import type { AudioTrack,CaptionTrack } from "./types";
import { createProject,migrateProject } from "./project";
const clips=[{id:"a",start:0,end:2},{id:"b",start:2,end:4},{id:"c",start:4,end:6}];
const track:AudioTrack={id:"system",kind:"system",path:"audio.wav",label:"Desktop",muted:false,volume:1};
describe("timeline assembly",()=>{
 it("moves a trimmed clip across adjoining gaps in either direction without rippling",()=>{
   const trimmed=trimClipRange(clips,"b",2.5,3.5);
   for(const at of [2,2.25,2.75,3]) {
     const moved=placeClip(trimmed,"b",at);
     expect(moved).not.toBe(trimmed);
     expect(sequenceTime(moved,2.5,"b")).toBeCloseTo(at);
     expect(sequenceTime(moved,4,"c")).toBe(4);
     expect(sequenceDuration(moved)).toBe(6);
     expect(moved.find(c=>c.id==="b")).toMatchObject({start:2.5,end:3.5});
   }
   expect(placeClip(trimmed,"b",1.99)).toBe(trimmed);
   expect(placeClip(trimmed,"b",3.01)).toBe(trimmed);
 });
 it("moves sped-up clips within newly freed space without changing source ranges",()=>{
   const fast=changeClipSpeed(clips,"b",2);
   const moved=placeClip(fast,"b",2.5);
   expect(sequenceTime(moved,2,"b")).toBe(2.5);
   expect(sequenceTime(moved,4,"c")).toBe(4);
   expect(sequenceDuration(moved)).toBe(6);
   expect(moved.find(c=>c.id==="b")).toMatchObject({start:2,end:4,speed:2});
 });
 it("deletes without shifting neighbouring clips and keeps ripple explicit",()=>{
   const normal=deleteClips(clips,["b"]);expect(normal[1].gap).toBe(true);expect(sequenceDuration(normal)).toBe(6);expect(sequenceTime(normal,4,"c")).toBe(4);
   expect(sequenceClip(normal,3)?.clip.gap).toBe(true);expect(sequenceDuration(deleteClips(clips,["b"],true))).toBe(4);
 });
 it("changes speed without overlaps or silently shifting later footage",()=>{
   const fast=changeClipSpeed(clips,"a",2);expect(sequenceDuration(fast)).toBe(6);expect(fast[1].gap).toBe(true);expect(sequenceTime(fast,2,"b")).toBe(2);
   expect(sequenceClip(fast,.5)?.source).toBe(1);expect(changeClipSpeed(clips,"a",.5)).toBe(clips);
   const ripple=changeClipSpeed(clips,"a",.5,true);expect(sequenceTime(ripple,2,"b")).toBe(4);
   const slower=changeClipSpeed(fast,"a",1);expect(slower).toHaveLength(3);
 });
 it("trims create space and precise placements reject occupied intervals",()=>{
   const trimmed=trimClipRange(clips,"b",2.5,3.5);expect(sequenceDuration(trimmed)).toBe(6);expect(sequenceTime(trimmed,4,"c")).toBe(4);
   expect(trimmed.filter(c=>c.gap)).toHaveLength(2);
   const empty=deleteClips(clips,["b"]);const moved=placeClip(empty,"a",2);expect(sequenceTime(moved,0,"a")).toBe(2);expect(sequenceDuration(moved)).toBe(6);
   expect(placeClip(clips,"a",3)).toBe(clips);
 });
 it("retimes caption words with clip speed and survives project reload",()=>{
   const fast=changeClipSpeed(clips,"a",2);const tracks=[{id:"speech",visible:true,segments:[{id:"line",text:"Hi",startMs:500,endMs:1500,words:[{text:"Hi",startMs:500,endMs:1500}]}]}] as CaptionTrack[];
   expect(mapCaptionTracks(tracks,fast)[0].segments[0]).toMatchObject({startMs:250,endMs:750,words:[{text:"Hi",startMs:250,endMs:750}]});
   const project=createProject("C:\\a.mp4","C:\\a.json");project.editor.videoClips=fast;
   expect(migrateProject(JSON.parse(JSON.stringify(project))).editor.videoClips).toEqual(fast);
 });
});
describe("audio clip assembly",()=>{
 it("splits audio independently, leaving video unchanged",()=>{
   const before=structuredClone(clips);const segments=resolvedAudioClips(track,clips,6);
   const split=splitAudioClip(track,clips,6,segments[0].id,1,60);
   expect(split.clips).toHaveLength(4);expect(split.clips![0]).toMatchObject({sourceStart:0,sourceEnd:1});expect(split.clips![1]).toMatchObject({sourceStart:1,sourceEnd:2});expect(clips).toEqual(before);
   expect(audioPosition({...split,clips:[]},1,1,clips).active).toBe(false);
 });
 it("linked segments follow cuts, gaps and per-clip speed",()=>{
   const explicit={...track,clips:resolvedAudioClips(track,clips,6)};
   const next=[{id:"a",start:0,end:1},{id:"new",start:1,end:2},clips[1],clips[2]];
   const reconciled=reconcileAudioClips([explicit],clips,next)[0];expect(reconciled.clips).toHaveLength(4);expect(reconciled.clips![1].videoClipId).toBe("new");
   const fast=changeClipSpeed(clips,"a",2);expect(resolvedAudioClips(explicit,fast,6)[0]).toMatchObject({start:0,end:1,speed:2});
   expect(audioPosition(explicit,NaN,1.5,fast).active).toBe(false);
   expect(audioPosition(explicit,.5,.25,fast)).toMatchObject({time:.5,speed:2,active:true});
 });
 it("unlinked audio continues through gaps with clip fades",()=>{
   const segments=resolvedAudioClips(track,clips,6);const independent={...track,linked:false,clips:[{...segments[0],start:1,fadeIn:.5,fadeOut:.5,volume:.8}]};
   const pos=audioPosition(independent,NaN,1.25,deleteClips(clips,["a"]));expect(pos).toMatchObject({time:.25,active:true});expect(audioClipEnvelope(pos.clip,pos.time)).toBeCloseTo(.4);
 });
});

it("rolls between different speeds without changing sequence duration",()=>{const clips=[{id:"a",start:0,end:2,speed:2},{id:"b",start:4,end:6,speed:.5}];const rolled=rollCut(clips,"a",.5,8,60);expect(sequenceDuration(rolled)).toBe(sequenceDuration(clips));});
it("duplicates audio into free space and rejects overlapping moves",()=>{const explicit={...track,clips:resolvedAudioClips(track,clips,6)};const copied=duplicateAudioClip(explicit,clips,6,explicit.clips[0].id);expect(copied.clips).toHaveLength(4);expect(copied.clips![3]).toMatchObject({start:6,linked:false});expect(editAudioClip(explicit,clips,6,explicit.clips[0].id,{linked:false,start:3})).toBe(explicit);});

it("linked audio slips with footage and duplicates only its own occurrence",()=>{
 const explicit={...track,clips:resolvedAudioClips(track,clips,8)};
 const slipped=reconcileAudioClips([explicit],clips,slipClip(clips,"a",1,8))[0];expect(slipped.clips![0]).toMatchObject({sourceStart:1,sourceEnd:3});
 const repeated=[clips[0],{...clips[0],id:"repeat"}];const audio={...track,clips:resolvedAudioClips(track,repeated,8)};
 const copied=reconcileAudioClips([audio],repeated,duplicateClips(repeated,["repeat"]))[0];expect(copied.clips).toHaveLength(3);
});
it("extending trims consumes adjacent gaps and preserves the next clip",()=>{const trimmed=trimClipRange(clips,"b",2.5,3.5);const restored=trimClipRange(trimmed,"b",2,4);expect(restored).toEqual(clips);expect(sequenceTime(restored,4,"c")).toBe(4);});

it("preserves existing gaps in a multi-clip delete and refuses to combine gaps",()=>{const withGap=deleteClips(clips,["b"]);expect(sequenceDuration(deleteClips(withGap,withGap.map(clip=>clip.id)))).toBe(6);expect(combineClips(withGap,withGap.map(clip=>clip.id))).toBe(withGap);expect(sequenceDuration(deleteClips(withGap,[withGap[1].id]))).toBe(4);});
