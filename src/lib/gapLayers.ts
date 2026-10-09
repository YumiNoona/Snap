import { animatedLayer } from "./layerAnimation";
import { drawVisualLayer, reconcileVideoLayers } from "./canvasDraw";
import type { Layer } from "./types";
export function drawGapLayers(ctx:CanvasRenderingContext2D,layers:Layer[],time:number,playing:boolean,cache:Map<string,HTMLVideoElement>,frame:{x:number;y:number;w:number;h:number},playbackRate=1) {
  reconcileVideoLayers(layers,time,playing,cache);
  for (const original of layers) {
    if(original.type==="mask"||time<original.start||time>=original.end)continue;
    const layer=animatedLayer(original,time); if(layer.type==="mask")continue;
    const x=frame.x+layer.x*frame.w,y=frame.y+layer.y*frame.h,w=layer.w*frame.w,h=layer.h*frame.h;
    ctx.save();ctx.globalAlpha=Math.max(0,Math.min(1,layer.opacity??1));ctx.translate(x+w/2,y+h/2);ctx.rotate((layer.rotation??0)*Math.PI/180);ctx.scale(layer.flipX?-1:1,layer.flipY?-1:1);ctx.translate(-x-w/2,-y-h/2);
    drawVisualLayer(ctx,layer,time,playing,cache,x,y,w,h,playbackRate);ctx.restore();
  }
}
