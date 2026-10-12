import {createElement,useState} from "react";
import {act,create} from "react-test-renderer";
import {it,expect,vi} from "vitest";
import BackgroundImages from "./BackgroundImages";
import {WALLPAPER_PRESETS} from "../../../lib/wallpapers";
vi.mock("../../../lib/canvasDraw",()=>({assetSrc:(path:string)=>path,preloadImageAsset:vi.fn()}));

it("shows imported backgrounds, keeps them after preset changes, and restores them on reopen",async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  const saved = new Map<string,string>();
  vi.stubGlobal("localStorage",{getItem:(key:string)=>saved.get(key)||null,setItem:(key:string,value:string)=>saved.set(key,value)});
  const warn=vi.spyOn(console,"error").mockImplementation(()=>{});
  const path="C:\\Pictures\\My background.jpg";
  let selected="";
  function Harness(){const [value,setValue]=useState("wallpaper-blue-waves");selected=value;return createElement(BackgroundImages,{value,active:true,onSelect:setValue,onImport:async()=>setValue(path)});}
  let renderer!:ReturnType<typeof create>;
  try {
    await act(async()=>{renderer=create(createElement(Harness));});
    const add=()=>renderer.root.findByProps({title:"Add your own image"});
    await act(async()=>add().props.onClick());
    expect(selected).toBe(path);
    expect(renderer.root.findByProps({"aria-label":"Use background My background.jpg"}).props["aria-pressed"]).toBe(true);
    expect(renderer.root.findAllByType("img")).toHaveLength(WALLPAPER_PRESETS.length+1);
    await act(async()=>renderer.root.findByProps({"aria-label":"Use background Abstract"}).props.onClick());
    expect(selected).toBe("wallpaper-abstract");
    expect(renderer.root.findByProps({"aria-label":"Use background My background.jpg"}).props["aria-pressed"]).toBe(false);
    await act(async()=>add().props.onClick());
    expect(renderer.root.findAllByProps({"aria-label":"Use background My background.jpg"})).toHaveLength(1);
    await act(async()=>renderer.unmount());
    await act(async()=>{renderer=create(createElement(BackgroundImages,{value:"wallpaper-abstract",active:true,onSelect:vi.fn(),onImport:async()=>{}}));});
    expect(renderer.root.findAllByProps({"aria-label":"Use background My background.jpg"})).toHaveLength(1);
  } finally {
    if(renderer)await act(async()=>renderer.unmount());
    vi.restoreAllMocks();vi.unstubAllGlobals();warn.mockRestore();
  }
});

it("recognizes existing preset file URLs and tolerates invalid saved background lists",async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  vi.stubGlobal("localStorage",{getItem:()=>"{broken",setItem:()=>{throw Error("Storage unavailable");}});
  const warn=vi.spyOn(console,"error").mockImplementation(()=>{});
  let renderer!:ReturnType<typeof create>;
  try {
    await act(async()=>{renderer=create(createElement(BackgroundImages,{value:"/Wallpapers/BlueWaves.jpg",active:true,onSelect:vi.fn(),onImport:async()=>{}}));});
    expect(renderer.root.findByProps({"aria-label":"Use background Blue Waves"}).props["aria-pressed"]).toBe(true);
    expect(renderer.root.findAllByType("img")).toHaveLength(WALLPAPER_PRESETS.length);
  } finally {
    if(renderer)await act(async()=>renderer.unmount());
    vi.restoreAllMocks();vi.unstubAllGlobals();warn.mockRestore();
  }
});
