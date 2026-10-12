import { animatedLayer } from "./layerAnimation";
import { drawVisualLayer, drawMaskLayer, resolveLayerFade, reconcileVideoLayers } from "./canvasDraw";
import type { Layer } from "./types";
const snapshots = new WeakMap<CanvasRenderingContext2D, HTMLCanvasElement>();
export function drawGapLayers(ctx:CanvasRenderingContext2D,layers:Layer[],time:number,playing:boolean,cache:Map<string,HTMLVideoElement>,frame:{x:number;y:number;w:number;h:number},playbackRate=1) {
  reconcileVideoLayers(layers,time,playing,cache);
  const active = layers.filter(layer => layer.timeSpace === "sequence" && time >= layer.start && time < layer.end);
  const ordered = [...active.filter(layer => layer.type === "image" || layer.type === "video"), ...active.filter(layer => layer.type === "mask"), ...active.filter(layer => layer.type === "text" || layer.type === "shape")];
  for (const original of ordered) {
    if (original.type === "mask") {
      const layer = animatedLayer(original, time);
      if (layer.type !== "mask") continue;
      let snapshot = snapshots.get(ctx);
      if (!snapshot) { snapshot = document.createElement("canvas"); snapshots.set(ctx, snapshot); }
      if (snapshot.width !== ctx.canvas.width) snapshot.width = ctx.canvas.width;
      if (snapshot.height !== ctx.canvas.height) snapshot.height = ctx.canvas.height;
      const g = snapshot.getContext("2d"); if (!g) continue;
      g.clearRect(0, 0, snapshot.width, snapshot.height); g.drawImage(ctx.canvas, 0, 0);
      const whole = { x: 0, y: 0, w: snapshot.width, h: snapshot.height };
      ctx.save(); ctx.beginPath(); ctx.rect(frame.x, frame.y, frame.w, frame.h); ctx.clip();
      drawMaskLayer(ctx, { ...layer, opacity: (layer.opacity ?? 1) * resolveLayerFade(layer, time) }, snapshot, whole, whole, { x: frame.x + layer.x * frame.w, y: frame.y + layer.y * frame.h, w: layer.w * frame.w, h: layer.h * frame.h });
      ctx.restore(); continue;
    }
    const layer=animatedLayer(original,time); if(layer.type==="mask")continue;
    const x=frame.x+layer.x*frame.w,y=frame.y+layer.y*frame.h,w=layer.w*frame.w,h=layer.h*frame.h;
    ctx.save();ctx.globalAlpha=Math.max(0,Math.min(1,layer.opacity??1));ctx.translate(x+w/2,y+h/2);ctx.rotate((layer.rotation??0)*Math.PI/180);ctx.scale(layer.flipX?-1:1,layer.flipY?-1:1);ctx.translate(-x-w/2,-y-h/2);
    drawVisualLayer(ctx,layer,time,playing,cache,x,y,w,h,playbackRate);ctx.restore();
  }
}
