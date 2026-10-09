import { afterEach,expect,it,vi } from "vitest";
import { createElement } from "react";
import { act,create } from "react-test-renderer";
import { usePlaybackController } from "./usePlaybackController";
import { DEFAULT_EDITOR_CONFIG } from "../../../lib/types";
vi.mock("@tauri-apps/api/core",()=>({convertFileSrc:(p:string)=>p}));
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it("opens a reordered project at its first clip and plays repeated footage in sequence order",async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.spyOn(console,"error").mockImplementation(()=>{});
  vi.stubGlobal("window",{setTimeout,clearTimeout,setInterval,clearInterval,addEventListener:vi.fn(),removeEventListener:vi.fn()});
  vi.stubGlobal("HTMLMediaElement",{HAVE_METADATA:1,HAVE_CURRENT_DATA:2,HAVE_FUTURE_DATA:3});
  let pending:(()=>void)|null=null;vi.stubGlobal("requestAnimationFrame",(fn:()=>void)=>{pending=fn;return 1;});vi.stubGlobal("cancelAnimationFrame",()=>{pending=null;});
  const events=new EventTarget();
  const video=Object.assign(events,{currentTime:0,duration:3,readyState:4,seeking:false,ended:false,error:null,paused:true,playbackRate:1,defaultPlaybackRate:1,preservesPitch:true,play:async()=>{Object.assign(video,{paused:false});events.dispatchEvent(new Event("playing"));},pause:()=>{Object.assign(video,{paused:true});events.dispatchEvent(new Event("pause"));},load:()=>{}}) as unknown as HTMLVideoElement;
  let controller!:ReturnType<typeof usePlaybackController>;
  const orderedClips=[{id:"first",start:2,end:3},{id:"middle",start:0,end:1},{id:"repeat",start:2,end:3}];
  function Harness(){controller=usePlaybackController({videoPath:"demo.mp4",duration:3,trimStart:0,trimEnd:3,playbackRate:1,audioTracks:[],audioMix:DEFAULT_EDITOR_CONFIG.audio,videoClips:orderedClips});return null;}
  let renderer!:ReturnType<typeof create>;
  try{
    await act(async()=>{renderer=create(createElement(Harness));});
    await act(async()=>{controller.setMediaElement(video);});
    expect(controller.activeClipId).toBe("first");expect(video.currentTime).toBe(2);
    await act(async()=>{controller.togglePlay();});expect(video.paused).toBe(false);
    await act(async()=>{video.currentTime=2.996;pending?.();});expect(video.paused).toBe(false);
    await act(async()=>{video.currentTime=3;pending?.();});expect(controller.activeClipId).toBe("middle");expect(video.currentTime).toBe(0);
    await act(async()=>{video.currentTime=1;pending?.();});expect(controller.activeClipId).toBe("repeat");expect(video.currentTime).toBe(2);
    await act(async()=>{controller.pausePlayback();controller.seekSequence(2.5);});expect(controller.activeClipId).toBe("repeat");expect(video.currentTime).toBe(2.5);expect(controller.sequencePosition).toBe(2.5);
  }finally{if(renderer)await act(async()=>renderer.unmount());}
});

it("starts independent audio at its sequence offset, gates paused sound and releases audio resources",async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.spyOn(console,"error").mockImplementation(()=>{});
  let meter:(()=>void)|null=null,frame:(()=>void)|null=null;
  vi.stubGlobal("window",{setTimeout,clearTimeout,setInterval:(fn:()=>void)=>{meter=fn;return 1;},clearInterval:vi.fn(),addEventListener:vi.fn(),removeEventListener:vi.fn()});
  vi.stubGlobal("HTMLMediaElement",{HAVE_METADATA:1,HAVE_CURRENT_DATA:2,HAVE_FUTURE_DATA:3});
  vi.stubGlobal("requestAnimationFrame",(fn:()=>void)=>{frame=fn;return 1;});vi.stubGlobal("cancelAnimationFrame",()=>{frame=null;});
  const targets:number[]=[],close=vi.fn(async()=>{});
  vi.stubGlobal("AudioContext",class {currentTime=0;resume=async()=>{};close=close;destination={};createMediaElementSource(){return {connect:()=>{}};}createGain(){return {connect:()=>{},gain:{value:0,setTargetAtTime:(value:number)=>targets.push(value)}};}createAnalyser(){return {fftSize:256,connect:()=>{},getFloatTimeDomainData:(data:Float32Array)=>data.fill(0)};}});
  let audio!:HTMLAudioElement;
  vi.stubGlobal("Audio",class extends EventTarget {currentTime=0;duration=10;readyState=4;paused=true;src="";preload="";crossOrigin="";muted=false;volume=1;playbackRate=1;constructor(){super();audio=this as unknown as HTMLAudioElement;}load(){}removeAttribute(){this.src="";}async play(){this.paused=false;}pause(){this.paused=true;}});
  let wall=100;vi.spyOn(performance,"now").mockImplementation(()=>wall);
  const events=new EventTarget();const video=Object.assign(events,{currentTime:0,duration:8,readyState:4,seeking:false,ended:false,error:null,paused:true,playbackRate:1,play:async()=>{Object.assign(video,{paused:false});events.dispatchEvent(new Event("playing"));},pause:()=>{Object.assign(video,{paused:true});events.dispatchEvent(new Event("pause"));},load:()=>{}}) as unknown as HTMLVideoElement;
  let controller!:ReturnType<typeof usePlaybackController>;
  const options={videoPath:"demo.mp4",duration:8,trimStart:0,trimEnd:8,playbackRate:1,audioMix:DEFAULT_EDITOR_CONFIG.audio,audioTracks:[{id:"music",kind:"imported" as const,path:"music.wav",label:"Music",muted:false,volume:1,linked:false,start:1,sourceStart:2,sourceEnd:4,fadeIn:1}],videoClips:[{id:"first",start:4,end:8}]};
  function Harness(){controller=usePlaybackController(options);return null;}
  let renderer!:ReturnType<typeof create>;
  try{
    await act(async()=>{renderer=create(createElement(Harness));});await act(async()=>controller.setMediaElement(video));
    await act(async()=>{meter?.();});expect(targets[targets.length-1]).toBe(0);
    await act(async()=>controller.togglePlay());expect(audio.paused).toBe(true);
    await act(async()=>{wall=1000;video.currentTime=5.5;frame?.();meter?.();});expect(audio.currentTime).toBe(2.5);expect(audio.paused).toBe(false);expect(targets[targets.length-1]).toBe(.5);
    await act(async()=>{controller.pausePlayback();meter?.();});expect(targets[targets.length-1]).toBe(0);expect(audio.paused).toBe(true);
  }finally{if(renderer)await act(async()=>renderer.unmount());}
  expect(close).toHaveBeenCalledOnce();expect(audio.src).toBe("");
});

it("plays through gaps, pauses linked audio there, and applies the next clip speed",async()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.spyOn(console,"error").mockImplementation(()=>{});
 vi.stubGlobal("window",{setTimeout,clearTimeout,setInterval,clearInterval,addEventListener:vi.fn(),removeEventListener:vi.fn()});vi.stubGlobal("HTMLMediaElement",{HAVE_METADATA:1,HAVE_CURRENT_DATA:2,HAVE_FUTURE_DATA:3});
 let wall=100;vi.spyOn(performance,"now").mockImplementation(()=>wall);let frame:(()=>void)|null=null;
 vi.stubGlobal("requestAnimationFrame",(fn:()=>void)=>{frame=fn;return 1;});vi.stubGlobal("cancelAnimationFrame",()=>{frame=null;});
 const events=new EventTarget(),video=Object.assign(events,{currentTime:0,duration:6,readyState:4,seeking:false,ended:false,error:null,paused:true,playbackRate:1,play:async()=>{Object.assign(video,{paused:false});events.dispatchEvent(new Event("playing"));},pause:()=>{Object.assign(video,{paused:true});events.dispatchEvent(new Event("pause"));},load:()=>{}}) as unknown as HTMLVideoElement;
 let controller!:ReturnType<typeof usePlaybackController>;
 const clips=[{id:"a",start:0,end:1},{id:"gap",start:0,end:.5,gap:true},{id:"b",start:3,end:4,speed:2}];
 function Harness(){controller=usePlaybackController({videoPath:"gap.mp4",duration:6,trimStart:0,trimEnd:6,playbackRate:1,audioTracks:[],audioMix:DEFAULT_EDITOR_CONFIG.audio,videoClips:clips});return null;}
 let renderer!:ReturnType<typeof create>;
 try{await act(async()=>{renderer=create(createElement(Harness));});await act(async()=>controller.setMediaElement(video));await act(async()=>controller.togglePlay());
 await act(async()=>{video.currentTime=1;wall=1100;frame?.();});expect(controller.inGap).toBe(true);expect(video.paused).toBe(true);expect(controller.playing).toBe(true);
 await act(async()=>{wall=1350;frame?.();});expect(controller.sequencePosition).toBeCloseTo(1.25);
 await act(async()=>{wall=1650;frame?.();});expect(controller.activeClipId).toBe("b");expect(video.currentTime).toBe(3);expect(video.playbackRate).toBe(2);
 await act(async()=>{controller.pausePlayback();controller.seekSequence(1.2);});expect(controller.inGap).toBe(true);expect(controller.sequencePosition).toBeCloseTo(1.2);expect(controller.playing).toBe(false);
 }finally{if(renderer)await act(async()=>renderer.unmount());}
});
