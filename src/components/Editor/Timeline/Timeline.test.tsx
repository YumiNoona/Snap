import { createElement, useState, type ComponentProps } from "react";
import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import Timeline from "./index";
import { DEFAULT_EDITOR_CONFIG, type VideoClip } from "../../../lib/types";
vi.mock("react-dom", () => ({ createPortal: (node: unknown) => node }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (path: string) => path }));

it("redraws loaded audio waveforms when the editor theme changes", async () => {
  const { invoke } = await import("@tauri-apps/api/core");
  const waveform = vi.mocked(invoke).mockResolvedValue([0.2, 0.5]);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  let color = "#a1a1aa";
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => color }));
  const warn = vi.spyOn(console, "error").mockImplementation(() => {});
  const context = { clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: "" };
  const props = { editorTheme: "dark", inputLogPath: "", audioTracks: [{ id: "system", kind: "system", path: "audio.wav", label: "Desktop", muted: false, volume: 1 }], duration: 5, currentTime: 0, keyframes: [], config: { ...DEFAULT_EDITOR_CONFIG, trimEnd: 5 }, playing: false, playbackStatus: "paused", layers: [], captionTracks: [], selectedActionId: null, selectedLayerId: null, selectedCaption: null, selectedZoomRegion: null } as unknown as ComponentProps<typeof Timeline>;
  let renderer!: ReturnType<typeof create>;
  try {
    await act(async () => { renderer = create(createElement(Timeline, props), { createNodeMock: node => node.type === "canvas" ? { parentElement: { clientWidth: 100, clientHeight: 30 }, getContext: () => context } : { clientWidth: 100, getBoundingClientRect: () => ({ left: 0, width: 100 }) } }); });
    expect(context.fillStyle).toBe("#a1a1aa");
    const initialDraws = context.fillRect.mock.calls.length;
    const initialLoads = waveform.mock.calls.length;
    color = "#52525b";
    await act(async () => renderer.update(createElement(Timeline, { ...props, editorTheme: "light" })));
    expect(context.fillStyle).toBe("#52525b");
    expect(context.fillRect.mock.calls.length).toBeGreaterThan(initialDraws);
    expect(waveform).toHaveBeenCalledTimes(initialLoads);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    vi.restoreAllMocks(); vi.unstubAllGlobals(); warn.mockRestore();
  }
});

it("splits with the toolbar and razor, selects footage and ripple deletes it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const warn = vi.spyOn(console, "error").mockImplementation(() => {});
  let current: VideoClip[] | null = null;
  const seek = vi.fn();
  function Harness() {
    const [videoClips, setVideoClips] = useState<VideoClip[] | null>(null);
    current = videoClips;
    const props = {
      editorTheme: "dark", inputLogPath: "", audioTracks: [], duration: 10, currentTime: 4,
      keyframes: [], config: { ...DEFAULT_EDITOR_CONFIG, trimEnd: 10, videoClips },
      playing: false, playbackStatus: "paused", layers: [], captionTracks: [],
      selectedActionId: null, selectedLayerId: null, selectedCaption: null, selectedZoomRegion: null,
      onVideoClipsChange: setVideoClips, onSeek: seek,
    } as unknown as ComponentProps<typeof Timeline>;
    return createElement(Timeline, props);
  }
  let renderer!: ReturnType<typeof create>;
  const mouse = (clientX: number) => ({ clientX, preventDefault: vi.fn(), stopPropagation: vi.fn(), currentTarget: { focus: vi.fn() } });
  try {
    await act(async () => { renderer = create(createElement(Harness), { createNodeMock: () => ({ clientWidth: 1000, getBoundingClientRect: () => ({ left: 0, width: 1000 }) }) }); });
    const button = (label: string) => renderer.root.findByProps({ "aria-label": label });
    await act(async () => { button("Split at playhead").props.onClick(); });
    expect(current!.map(c => [c.start, c.end])).toEqual([[0, 4], [4, 10]]);
    await act(async () => { button("Razor tool").props.onClick(); });
    await act(async () => { button("Footage segment 2").props.onClick(mouse(700)); });
    expect(current!.map(c => [c.start, c.end])).toEqual([[0, 4], [4, 7], [7, 10]]);
    await act(async () => { button("Selection tool").props.onClick(); });
    await act(async () => { button("Footage segment 2").props.onClick(mouse(500)); });
    expect(button("Ripple delete selected footage").props.disabled).toBe(false);
    await act(async () => { button("Ripple delete selected footage").props.onClick(); });
    expect(current!.map(c => [c.start, c.end])).toEqual([[0, 4], [7, 10]]);
    expect(button("Footage segment 2").props.style.left).toBe(button("Footage segment 1").props.style.width);
    expect(seek).toHaveBeenCalledWith(5, expect.any(String));
    await act(async () => { renderer.root.findAllByProps({ title: "Trim segment end" })[0].props.onMouseDown(mouse(400)); });
    const callbacks = vi.mocked(document.addEventListener).mock.calls;
    const move = callbacks.filter(call => call[0] === "mousemove").pop()![1] as unknown as (event: { clientX: number }) => void;
    const up = callbacks.filter(call => call[0] === "mouseup").pop()![1] as unknown as () => void;
    await act(async () => { move({ clientX: 300 }); });
    expect(current![0].end).toBe(4); // Drag is a draft until mouse release.
    await act(async () => { up(); });
    expect(current![0].end).toBeCloseTo(3.3);
    await act(async () => { renderer.root.findByProps({ title: "Switch between joined sequence and original source timeline" }).props.onClick(); });
    expect(button("Footage segment 2").props.style.left).toBe(700);
    await act(async () => { button("Restore original footage").props.onClick(); });
    expect(current).toBeNull();
    expect(button("Footage segment 1").props.style.width).toBe(1000);
  } finally {
    if (renderer) await act(async () => { renderer.unmount(); });
    warn.mockRestore(); vi.unstubAllGlobals();
  }
});

it("reorders clips with pointer dragging, supports the final boundary and cancels safely", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const warn=vi.spyOn(console,"error").mockImplementation(()=>{});
  let current: VideoClip[]=[];
  function Harness() {
    const [videoClips,setVideoClips]=useState<VideoClip[]>([{id:"a",start:0,end:3},{id:"b",start:3,end:6},{id:"c",start:6,end:9}]); current=videoClips;
    return createElement(Timeline, {editorTheme:"dark",inputLogPath:"",audioTracks:[],duration:9,currentTime:1,keyframes:[],config:{...DEFAULT_EDITOR_CONFIG,trimEnd:9,videoClips},playing:false,playbackStatus:"paused",layers:[],captionTracks:[],selectedActionId:null,selectedLayerId:null,selectedCaption:null,selectedZoomRegion:null,onVideoClipsChange:setVideoClips,onSeek:vi.fn()} as unknown as ComponentProps<typeof Timeline>);
  }
  let renderer!:ReturnType<typeof create>;
  const event=(clientX:number)=>({clientX,button:0,target:{closest:()=>null},preventDefault:vi.fn(),stopPropagation:vi.fn(),currentTarget:{focus:vi.fn()}});
  const callback=(name:string)=>vi.mocked(window.addEventListener).mock.calls.filter(call=>call[0]===name).slice(-1)[0][1] as (event:unknown)=>void;
  try {
    await act(async()=>{renderer=create(createElement(Harness),{createNodeMock:()=>({clientWidth:1000,getBoundingClientRect:()=>({left:0,right:1000,width:1000})})});});
    const segment=(i:number)=>renderer.root.findByProps({"aria-label":`Footage segment ${i}`});
    await act(async()=>{segment(1).props.onPointerDown(event(100));callback("pointermove")(event(990));});
    expect(current.map(c=>c.id)).toEqual(["a","b","c"]);
    expect(renderer.root.findByProps({"aria-label":"Clip insertion position"}).props.style.left).toBe("100%");
    await act(async()=>{callback("pointerup")({});});
    expect(current.map(c=>c.id)).toEqual(["b","c","a"]);
    await act(async()=>{segment(3).props.onPointerDown(event(900));callback("pointermove")(event(0));callback("pointerup")({});});
    expect(current.map(c=>c.id)).toEqual(["a","b","c"]);
    await act(async()=>{segment(1).props.onPointerDown(event(100));callback("pointermove")(event(900));callback("pointercancel")({});});
    expect(current.map(c=>c.id)).toEqual(["a","b","c"]);
    await act(async()=>{segment(1).props.onClick(event(100));renderer.root.findByProps({"aria-label":"Clip settings"}).props.onClick();});
    expect(renderer.root.findByProps({"aria-label":"Clip trim settings"})).toBeDefined();
    await act(async()=>{segment(2).props.onClick({...event(400),ctrlKey:true});});
    await act(async()=>{segment(1).props.onPointerDown(event(100));callback("pointermove")(event(990));callback("pointerup")({});});
    expect(current.map(c=>c.id)).toEqual(["c","a","b"]);
    expect(window.removeEventListener).toHaveBeenCalledWith("pointermove",expect.any(Function));
  } finally {if(renderer)await act(async()=>renderer.unmount());warn.mockRestore();vi.unstubAllGlobals();}
});

it("shows added tilt keys in the timeline, including duplicated footage occurrences", async () => {
  const {default:ScreenTiltTools}=await import("../Panels/ScreenTiltTools");
  const {DEFAULT_SCREEN_TILT}=await import("../../../lib/screenTilt");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  vi.stubGlobal("window",{addEventListener:vi.fn(),removeEventListener:vi.fn()});
  vi.stubGlobal("document",{addEventListener:vi.fn(),removeEventListener:vi.fn()});
  vi.stubGlobal("ResizeObserver",class{observe(){}disconnect(){}});
  const warn=vi.spyOn(console,"error").mockImplementation(()=>{}),seek=vi.fn(),retime=vi.fn();
  function Harness(){const [config,setConfig]=useState({...DEFAULT_EDITOR_CONFIG,trimEnd:5,screenTilt:{...DEFAULT_SCREEN_TILT,enabled:true},videoClips:[{id:"a",start:0,end:5},{id:"b",start:0,end:5}]});return createElement("div",null,createElement(ScreenTiltTools,{config,time:2,onChange:setConfig as never}),createElement(Timeline,{editorTheme:"dark",inputLogPath:"",audioTracks:[],duration:5,currentTime:2,keyframes:[],config,playing:false,playbackStatus:"paused",layers:[],captionTracks:[],selectedActionId:null,selectedLayerId:null,selectedCaption:null,selectedZoomRegion:null,onSeek:seek,onAnimationKeyChange:retime} as unknown as ComponentProps<typeof Timeline>));}
  let renderer!:ReturnType<typeof create>;
  try{
    await act(async()=>{renderer=create(createElement(Harness),{createNodeMock:()=>({clientWidth:1000,style:{},getBoundingClientRect:()=>({left:0,right:1000,width:1000})})});});
    expect(renderer.root.findAllByProps({"aria-label":"3D tilt keyframe at 2.000 seconds"})).toHaveLength(0);
    const add=renderer.root.findByProps({"aria-label":"Add keyframe"});
    await act(async()=>add.props.onClick());
    expect(renderer.root.findByProps({"aria-label":"Update keyframe"}).children.every(child=>typeof child!=="string")).toBe(true);
    await act(async()=>renderer.root.findByProps({"aria-haspopup":"listbox"}).props.onClick());
    const easingOptions=renderer.root.findAllByProps({role:"option"});
    expect(easingOptions.map(option=>option.findByType("span").children.join(""))).toEqual(["Linear","Ease in","Ease out","Smooth","Sine","Gentle"]);
    await act(async()=>easingOptions[2].props.onClick());
    expect(renderer.root.findByProps({"aria-haspopup":"listbox"}).findByType("span").children).toEqual(["Ease out"]);
    const keys=renderer.root.findAllByProps({"aria-label":"3D tilt keyframe at 2.000 seconds"});
    expect(keys).toHaveLength(2);expect(keys.map(key=>key.props.style.left)).toEqual([200,700]);
    await act(async()=>keys[1].props.onClick({stopPropagation:vi.fn()}));expect(seek).toHaveBeenLastCalledWith(2,"b");
    const element={style:{}};
    await act(async()=>keys[1].props.onPointerDown({clientX:700,button:0,currentTarget:element,stopPropagation:vi.fn()}));
    const calls=vi.mocked(window.addEventListener).mock.calls;
    const move=calls.filter(call=>call[0]==="pointermove").slice(-1)[0][1] as (event:unknown)=>void;
    const up=calls.filter(call=>call[0]==="pointerup").slice(-1)[0][1] as ()=>void;
    await act(async()=>{move({clientX:800});up();});expect(retime).toHaveBeenLastCalledWith("tilt","tilt",2,3);
  }finally{if(renderer)await act(async()=>renderer.unmount());warn.mockRestore();vi.unstubAllGlobals();}
});
