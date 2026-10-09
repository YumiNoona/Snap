import { it,expect,vi } from "vitest";
import { FootageTransitions,transitionProgress,applyLayerTransition } from "./transitions";
it("clamps transition duration and progress at clip and layer boundaries",()=>{
 expect(transitionProgress({effect:"fade",duration:2},.25,.5)).toBe(.5);expect(transitionProgress({effect:"none",duration:1},0)).toBe(1);expect(transitionProgress({effect:"slide",duration:.5},10)).toBe(1);
});
it("changes layer opacity and clips wipe effects without changing timing",()=>{
 const ctx={globalAlpha:.8,translate:vi.fn(),beginPath:vi.fn(),rect:vi.fn(),clip:vi.fn()} as unknown as CanvasRenderingContext2D;
 applyLayerTransition(ctx,{effect:"fade",duration:1},.5,{x:0,y:0,w:100,h:50});expect(ctx.globalAlpha).toBeCloseTo(.4);
 applyLayerTransition(ctx,{effect:"wipe",duration:1},.5,{x:0,y:0,w:100,h:50});expect(ctx.rect).toHaveBeenCalledWith(0,0,50,50);
});
it("adds no canvas copying when transitions are disabled",()=>{
 const create=vi.fn();vi.stubGlobal("document",{createElement:create});try{new FootageTransitions().draw({} as CanvasRenderingContext2D,{id:"a",start:0,end:1},.5);expect(create).not.toHaveBeenCalled();}finally{vi.unstubAllGlobals();}
});

it("does not substitute an unrelated last-viewed frame when scrubbing a transition",()=>{const create=vi.fn();vi.stubGlobal("document",{createElement:create});try{const transitions=new FootageTransitions();transitions.draw({} as CanvasRenderingContext2D,{id:"b",start:1,end:2,transition:{effect:"dissolve",duration:.5}},1.1);expect(create).not.toHaveBeenCalled();}finally{vi.unstubAllGlobals();}});
it("releases prepared boundary buffers and requires the matching incoming clip",()=>{const drawImage=vi.fn(),canvases:{width:number;height:number;getContext:()=>unknown}[]=[];vi.stubGlobal("document",{createElement:()=>{const canvas={width:0,height:0,getContext:()=>({drawImage})};canvases.push(canvas);return canvas;}});try{const t=new FootageTransitions();t.setOutgoing("b",{width:320,height:180} as HTMLCanvasElement);expect(drawImage).toHaveBeenCalledTimes(1);t.draw({} as CanvasRenderingContext2D,{id:"c",start:0,end:1,transition:{effect:"fade",duration:.3}},.1);expect(canvases).toHaveLength(1);t.clear();expect(canvases[0].width).toBe(0);expect(canvases[0].height).toBe(0);}finally{vi.unstubAllGlobals();}});

it("prepares the current and next boundary with a bounded cache",()=>{const canvases:{width:number;height:number;getContext:()=>unknown}[]=[];vi.stubGlobal("document",{createElement:()=>{const canvas={width:0,height:0,getContext:()=>({drawImage:vi.fn()})};canvases.push(canvas);return canvas;}});try{const t=new FootageTransitions(),source={width:320,height:180} as HTMLCanvasElement;t.setOutgoing("b",source);t.setOutgoing("c",source);expect(t.isReady("b")).toBe(true);expect(t.isReady("c")).toBe(true);t.setOutgoing("d",source);expect(t.isReady("b")).toBe(false);expect(canvases[0].width).toBe(0);t.clear();expect(canvases.every(c=>c.width===0&&c.height===0)).toBe(true);}finally{vi.unstubAllGlobals();}});
it("shares directional wipe and easing rules with layer transitions",()=>{const ctx={globalAlpha:1,translate:vi.fn(),beginPath:vi.fn(),rect:vi.fn(),clip:vi.fn()} as unknown as CanvasRenderingContext2D;applyLayerTransition(ctx,{effect:"wipe",duration:1,direction:"down",easing:"linear"},.25,{x:10,y:20,w:80,h:40});expect(ctx.rect).toHaveBeenCalledWith(10,50,80,10);applyLayerTransition(ctx,{effect:"slide",duration:1,direction:"up",easing:"ease-in"},.5,{x:0,y:0,w:80,h:40});expect(ctx.translate).toHaveBeenCalledWith(0,35);});
