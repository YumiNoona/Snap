import { describe,it,expect } from "vitest";
import { duplicateClips,moveClips,combineClips,slipClip,rollCut } from "./clipOperations";
import { sequenceClip,sequenceTime,retainedClips,mapCaptionTracks } from "./videoEditing";
import { animatedLayer,anchoredLayer,moveLayerGroup } from "./layerAnimation";
import { audioEnvelope,audioPosition } from "./audioEditing";
import { generateKeyframes } from "./autoZoom";
import { DEFAULT_EDITOR_CONFIG,type Layer,type AudioTrack,type CaptionTrack } from "./types";
const clips=[{id:"a",start:0,end:2},{id:"b",start:4,end:6},{id:"c",start:8,end:10}];
describe("editor assembly",()=>{
  it("preserves arbitrary clip order and finds duplicate occurrences by identity",()=>{
    const reordered=moveClips(clips,["c","a"],3);
    expect(reordered.map(c=>c.id)).toEqual(["b","a","c"]);
    const copied=duplicateClips(clips,["a"]);
    expect(copied).toHaveLength(4);expect(copied[1].id).not.toBe("a");
    expect(sequenceTime(copied,1,copied[1].id)).toBe(3);
    expect(sequenceClip(copied,3)).toEqual({clip:copied[1],source:1});
    expect(retainedClips([clips[2],clips[0]],0,10).map(c=>c.id)).toEqual(["c","a"]);
  });
  it("slips within source bounds and rolls while preserving duration",()=>{
    expect(slipClip(clips,"b",20,10)[1]).toMatchObject({start:8,end:10});
    const rolled=rollCut(clips,"a",1,10);
    expect(rolled.slice(0,2).map(c=>[c.start,c.end])).toEqual([[0,3],[5,6]]);
    expect(rollCut(clips,"a",30,10)[1].end-rollCut(clips,"a",30,10)[1].start).toBeCloseTo(.1);
    expect(combineClips([{id:"a",start:0,end:2},{id:"b",start:2,end:4}],["a","b"])).toEqual([{id:"a",start:0,end:4}]);
  });
  it("repeats captions in the right sequence positions",()=>{
    const tracks=[{segments:[{id:"s",text:"Hello",startMs:0,endMs:1000}]}] as CaptionTrack[];
    expect(mapCaptionTracks(tracks,[clips[2],clips[0],{...clips[0],id:"duplicate"}])[0].segments.map(s=>s.startMs)).toEqual([2000,4000]);
  });
});
describe("shared render and sound timing",()=>{
  const layer={id:"l",type:"shape",shape:"rectangle",color:"red",strokeWidth:1,x:0,y:0,w:.2,h:.2,start:5,end:10,groupId:"g",animation:[{time:0,x:0,y:0,scale:1,opacity:1,rotation:0,easing:"linear"},{time:2,x:1,y:.5,scale:2,opacity:0,rotation:90,easing:"linear"}]} as Layer;
  it("interpolates local animation and transforms a screen anchor with the camera",()=>{
    const pose=animatedLayer(layer,6);expect(pose).toMatchObject({x:.5,y:.25,opacity:.5,rotation:45});expect(pose.w).toBeCloseTo(.3);
    expect(anchoredLayer({...layer,screenAnchored:true,x:.5,y:.5},{x:25,y:25,w:50,h:50},100,100)).toMatchObject({x:.5,y:.5,w:.4,h:.4});
    expect(moveLayerGroup([layer,{...layer,id:"other",x:.2}],{...layer,x:.1})[1].x).toBeCloseTo(.3);
  });
  const audio={id:"a",kind:"imported",path:"a.wav",label:"Music",muted:false,volume:1,linked:false,start:3,sourceStart:2,sourceEnd:6,fadeIn:1,fadeOut:1,volumeKeys:[{time:0,volume:1},{time:2,volume:.5}]} as AudioTrack;
  it("moves independent audio and applies source fades and volume envelopes",()=>{
    expect(audioPosition(audio,9,2).active).toBe(false);expect(audioPosition(audio,9,4)).toEqual({time:3,active:true});
    expect(audioEnvelope(audio,2,10)).toBe(0);expect(audioEnvelope(audio,3,10)).toBe(.75);expect(audioEnvelope(audio,5.5,10)).toBe(.25);
    expect(audioPosition({...audio,linked:true},3,9)).toEqual({time:3,active:true});
  });
  it("excludes distracting activity and keeps protected areas in frame",()=>{
    const events=[{ts:1000,type:"mousedown",x:700,y:400,key:null,button:"left"}];
    expect(generateKeyframes(events,1000,800,5000,600,{excludedRanges:[{start:500,end:1500}]}).every(k=>k.scale===1)).toBe(true);
    const frames=generateKeyframes(events,1000,800,5000,600,{...DEFAULT_EDITOR_CONFIG.autoZoom,protectedAreas:[{x:0,y:0,w:1,h:1}]});
    expect(frames.every(k=>k.scale===1)).toBe(true);
  });
});
