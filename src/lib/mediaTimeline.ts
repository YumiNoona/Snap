import type { Layer } from "./types";

/** Project sequence-timed media into the renderer's source clock without changing local playback. */
export function projectMediaLayers(layers: Layer[], sourceTime: number, sequenceTime: number): Layer[] {
  return layers.map(layer => layer.timeSpace === "sequence" ? {
    ...layer, start: layer.start + sourceTime - sequenceTime, end: layer.end + sourceTime - sequenceTime,
  } : layer);
}

export function mediaLayerName(layer: Layer): string {
  return layer.type === "image" || layer.type === "video" ? layer.path.split(/[\\/]/).pop() || "Media" : layer.type;
}

/** Splitting an imported video retains its source offset and relative animation timing. */
export function splitMediaLayer(layer: Layer, at: number, fps: number): Layer[] {
  const rate=Number.isFinite(fps)&&fps>0?fps:30;
  const time=Math.round(at*rate)/rate;
  if (time-layer.start<1/rate-1e-7 || layer.end-time<1/rate-1e-7) return [layer];
  const offset=time-layer.start;
  return [{...layer,end:time,exitTransition:undefined}, {...layer,id:`${layer.type}-${crypto.randomUUID()}`,start:time,transition:undefined,
    ...(layer.type==="video"?{sourceOffset:(layer.sourceOffset??0)+offset}:{}),
    animation:layer.animation?.map(key=>({...key,time:key.time-offset})),
  }];
}
