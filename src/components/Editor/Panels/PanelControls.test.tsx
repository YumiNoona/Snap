import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { it, expect, vi } from "vitest";
import { SelectRow } from "./PanelControls";
import ScreenTiltTools from "./ScreenTiltTools";
import { DEFAULT_EDITOR_CONFIG } from "../../../lib/types";
import { DEFAULT_SCREEN_TILT } from "../../../lib/screenTilt";

it("places the custom menu above a low trigger and keeps keyboard navigation inside it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { innerHeight:340,addEventListener:vi.fn(),removeEventListener:vi.fn() });
  const doc={activeElement:null as unknown}; vi.stubGlobal("document",doc);
  const options=Array.from({length:3},()=>({focus(){doc.activeElement=this;}}));
  const trigger={getBoundingClientRect:()=>({top:285,bottom:320}),focus(){doc.activeElement=this;}};
  const menu={querySelector:()=>options[0],querySelectorAll:()=>options};
  const change=vi.fn(); const warn=vi.spyOn(console,"error").mockImplementation(()=>{});
  let renderer:ReturnType<typeof create>|undefined;
  const key=(value:string)=>({key:value,stopPropagation:vi.fn(),preventDefault:vi.fn()});
  try {
    await act(async()=>{renderer=create(createElement(SelectRow,{label:"Easing",value:"linear",options:["linear","sine","smoother"],onChange:change}),{createNodeMock:node=>(node.props as Record<string,unknown>).role==="listbox"?menu:(node.props as Record<string,unknown>)["aria-haspopup"]?trigger:{closest:()=>({getBoundingClientRect:()=>({top:0,bottom:340})}),contains:()=>true}});});
    await act(async()=>renderer!.root.findByProps({"aria-label":"Easing","aria-haspopup":"listbox"}).props.onClick());
    const list=renderer!.root.findByProps({role:"listbox"});
    expect(list.props.style.bottom).toBe("calc(100% + 6px)");
    expect(doc.activeElement).toBe(options[0]);
    const end=key("End");await act(async()=>list.props.onKeyDown(end));
    expect(doc.activeElement).toBe(options[2]);expect(end.stopPropagation).toHaveBeenCalledOnce();
    const left=key("ArrowLeft");await act(async()=>list.props.onKeyDown(left));expect(left.preventDefault).toHaveBeenCalledOnce();
    await act(async()=>list.props.onKeyDown(key("Escape")));
    expect(doc.activeElement).toBe(trigger);expect(renderer!.root.findAllByProps({role:"listbox"})).toHaveLength(0);
  } finally {if(renderer)await act(async()=>renderer!.unmount());warn.mockRestore();vi.unstubAllGlobals();}
});

it("preserves neighbouring 120fps tilt keys and blocks edits to locked tilt", async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  const warn=vi.spyOn(console,"error").mockImplementation(()=>{});const change=vi.fn();
  const config={...DEFAULT_EDITOR_CONFIG,screenTilt:{...DEFAULT_SCREEN_TILT,enabled:true,keys:[{...DEFAULT_SCREEN_TILT,time:0,easing:"linear" as const},{...DEFAULT_SCREEN_TILT,time:1/120,easing:"sine" as const}]}};
  let renderer:ReturnType<typeof create>|undefined;
  try {
    await act(async()=>{renderer=create(createElement(ScreenTiltTools,{config,time:0,frameRate:120,onChange:change}));});
    await act(async()=>renderer!.root.findByProps({"aria-label":"Update keyframe"}).props.onClick());
    expect(change.mock.calls[0][0].screenTilt.keys).toHaveLength(2);
    expect(change.mock.calls[0][0].screenTilt.keys[1].time).toBe(1/120);
    await act(async()=>renderer!.update(createElement(ScreenTiltTools,{config:{...config,lockedTracks:["tilt"]},time:0,frameRate:120,onChange:change})));
    expect(renderer!.root.findByType("fieldset").props.disabled).toBe(true);
    await act(async()=>renderer!.root.findByProps({"aria-label":"Update keyframe"}).props.onClick());
    expect(change).toHaveBeenCalledOnce();
  }finally{if(renderer)await act(async()=>renderer!.unmount());warn.mockRestore();vi.unstubAllGlobals();}
});
