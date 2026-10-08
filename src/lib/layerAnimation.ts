import type { Layer, LayerAnimationKey } from "./types";
import { motionEase } from "./easing";

/** Animation times are local to the layer, in seconds. Both renderers use this. */
export function animatedLayer(layer: Layer, sourceTime: number): Layer {
  const keys = [...(layer.animation ?? [])].filter(k => [k.time,k.x,k.y,k.scale,k.opacity,k.rotation].every(Number.isFinite)).sort((a,b) => a.time-b.time);
  if (!keys.length) return layer;
  const time = sourceTime-layer.start;
  const right = keys.findIndex(k => k.time > time);
  let pose: LayerAnimationKey;
  if (right === 0) pose = keys[0];
  else if (right < 0) pose = keys[keys.length-1];
  else {
    const a = keys[right-1], b = keys[right];
    const t = motionEase((time-a.time)/Math.max(.0001,b.time-a.time),b.easing);
    const lerp = (x:number,y:number) => x+(y-x)*t;
    pose = {...b,x:lerp(a.x,b.x),y:lerp(a.y,b.y),scale:lerp(a.scale,b.scale),opacity:lerp(a.opacity,b.opacity),rotation:lerp(a.rotation,b.rotation)};
  }
  const scale = Math.max(.05,Math.min(10,pose.scale));
  return {...layer,x:pose.x,y:pose.y,w:layer.w*scale,h:layer.h*scale,opacity:Math.max(0,Math.min(1,pose.opacity)),rotation:pose.rotation};
}

export function moveLayerGroup(layers: Layer[], changed: Layer): Layer[] {
  const old = layers.find(l => l.id === changed.id);
  if (!old) return layers;
  return layers.map(l => l.id === changed.id ? changed : old.groupId && l.groupId === old.groupId ? {...l,x:l.x+changed.x-old.x,y:l.y+changed.y-old.y} : l);
}

export function anchoredLayer(layer:Layer,view:{x:number;y:number;w:number;h:number},width:number,height:number):Layer {
  if(!layer.screenAnchored)return layer;
  return {...layer,x:(layer.x*width-view.x)/Math.max(1,view.w),y:(layer.y*height-view.y)/Math.max(1,view.h),w:layer.w*width/Math.max(1,view.w),h:layer.h*height/Math.max(1,view.h)};
}

export function editLayerAtTime(layers:Layer[],changed:Layer,time:number):Layer[] {
  const base=layers.find(l=>l.id===changed.id);
  if(!base)return layers;
  const pose=animatedLayer(base,time);
  const dx=changed.x-pose.x,dy=changed.y-pose.y;
  return layers.map(layer=>{
    if(layer.id!==changed.id && (!base.groupId||layer.groupId!==base.groupId))return layer;
    const previous=animatedLayer(layer,time);
    const next=layer.id===changed.id?changed:{...previous,x:previous.x+dx,y:previous.y+dy};
    if(!layer.animation?.length)return {...layer,x:next.x,y:next.y,w:next.w,h:next.h,opacity:next.opacity,rotation:next.rotation};
    const local=Math.max(0,Math.min(layer.end-layer.start,time-layer.start));
    const existing=layer.animation.find(k=>Math.abs(k.time-local)<1/60);
    const key:LayerAnimationKey={time:local,x:next.x,y:next.y,scale:next.w/Math.max(.001,layer.w),opacity:next.opacity??1,rotation:next.rotation??0,easing:existing?.easing??"ease-in-out"};
    return {...layer,animation:[...layer.animation.filter(k=>Math.abs(k.time-local)>=1/60),key].sort((a,b)=>a.time-b.time)};
  });
}
