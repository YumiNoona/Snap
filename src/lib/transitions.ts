import { motionEase } from "./easing";
import { clipSpeed } from "./videoEditing";
import type { ClipTransition, VideoClip, TransitionEffect } from "./types";
export const TRANSITION_EFFECTS:TransitionEffect[]=["none","fade","dissolve","slide","push","wipe","zoom"];
export function transitionProgress(transition:ClipTransition|undefined,elapsed:number,maximum=Infinity):number {
  if(!transition||transition.effect==="none")return 1;
  const length=Math.max(.001,Math.min(maximum,Number.isFinite(transition.duration)?transition.duration:.3));
  return Math.max(0,Math.min(1,elapsed/length));
}
export function applyLayerTransition(ctx:CanvasRenderingContext2D,effect:ClipTransition|undefined,progress:number,frame:{x:number;y:number;w:number;h:number},exiting=false) {
  if(!effect||progress>=1||effect.effect==="none")return;
  const t=effect.easing?motionEase(progress,effect.easing):progress*progress*(3-2*progress),remaining=1-t;
  const vertical=effect.direction==="up"||effect.direction==="down",sign=effect.direction==="right"||effect.direction==="down"?-1:1;
  if(effect.effect==="fade"||effect.effect==="dissolve"||effect.effect==="zoom")ctx.globalAlpha*=t;
  if(effect.effect==="slide"||effect.effect==="push")ctx.translate(vertical?0:(exiting?-1:1)*sign*frame.w*remaining,vertical?(exiting?-1:1)*sign*frame.h*remaining:0);
  if(effect.effect==="wipe"){ctx.beginPath();ctx.rect(frame.x+(vertical?0:sign<0?frame.w*(1-t):0),frame.y+(vertical&&sign<0?frame.h*(1-t):0),vertical?frame.w:frame.w*t,vertical?frame.h*t:frame.h);ctx.clip();}
  if(effect.effect==="zoom"){const scale=1+.15*remaining;ctx.translate(frame.x+frame.w/2,frame.y+frame.h/2);ctx.scale(scale,scale);ctx.translate(-frame.x-frame.w/2,-frame.y-frame.h/2);}
}
/** Two bounded boundary snapshots and one reusable incoming frame, before overlays. */
export class FootageTransitions {
  private previous:HTMLCanvasElement|undefined;
  private boundaries=new Map<string,HTMLCanvasElement>();
  setOutgoing(id:string,source:HTMLCanvasElement){
    let outgoing=this.boundaries.get(id);
    if(!outgoing){outgoing=document.createElement("canvas");this.boundaries.set(id,outgoing);}
    outgoing.width=source.width;outgoing.height=source.height;
    outgoing.getContext("2d")!.drawImage(source,0,0);
    while(this.boundaries.size>2){const oldest=this.boundaries.keys().next().value!;const canvas=this.boundaries.get(oldest)!;canvas.width=canvas.height=0;this.boundaries.delete(oldest);}
  }
  isReady(id:string){return this.boundaries.has(id);}
  draw(ctx:CanvasRenderingContext2D,clip:VideoClip|undefined,time:number,_next?:VideoClip){
    if(!clip||clip.gap||!clip.transition||!this.boundaries.has(clip.id))return;
    const canvas=ctx.canvas,w=canvas.width,h=canvas.height;
    const elapsed=(time-clip.start)/clipSpeed(clip);
    if(transitionProgress(clip.transition,elapsed,(clip.end-clip.start)/clipSpeed(clip))>=1)return;
    if(!this.previous)this.previous=document.createElement("canvas");
    const previous=this.previous,outgoing=this.boundaries.get(clip.id)!;
    if(outgoing.width!==w||outgoing.height!==h)return;
    if(previous.width!==w||previous.height!==h){previous.width=w;previous.height=h;}
    const previousCtx=previous.getContext("2d")!;
    previousCtx.clearRect(0,0,w,h);previousCtx.drawImage(canvas,0,0);
    const progress=transitionProgress(clip.transition,(time-clip.start)/clipSpeed(clip),(clip.end-clip.start)/clipSpeed(clip)),t=clip.transition.easing?motionEase(progress,clip.transition.easing):progress*progress*(3-2*progress);
    if(t>=1)return;
    ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;
    ctx.clearRect(0,0,w,h);
    const direction=clip.transition.direction??"left",vertical=direction==="up"||direction==="down",sign=direction==="right"||direction==="down"?-1:1;
    const distance=Math.round((vertical?h:w)*t),incoming=(vertical?h:w)-distance;
    if(clip.transition.effect==="fade"){ctx.fillStyle="#000000";ctx.fillRect(0,0,w,h);ctx.globalAlpha=t<.5?1-t*2:t*2-1;ctx.drawImage(t<.5?outgoing:previous,0,0);ctx.restore();return;}
    if(clip.transition.effect==="push")ctx.drawImage(outgoing,vertical?0:-sign*distance,vertical?-sign*distance:0);else ctx.drawImage(outgoing,0,0);
    if(clip.transition.effect==="wipe"){ctx.beginPath();ctx.rect(vertical?0:sign<0?w-distance:0,vertical&&sign<0?h-distance:0,vertical?w:distance,vertical?distance:h);ctx.clip();ctx.drawImage(previous,0,0);}
    else if(clip.transition.effect==="slide"||clip.transition.effect==="push")ctx.drawImage(previous,vertical?0:sign*incoming,vertical?sign*incoming:0);
    else if(clip.transition.effect==="zoom"){ctx.globalAlpha=t;const scale=1+.15*(1-t);ctx.drawImage(previous,-w*(scale-1)/2,-h*(scale-1)/2,w*scale,h*scale);}
    else {ctx.globalAlpha=t;ctx.drawImage(previous,0,0);}
    ctx.restore();
  }
  clear(){if(this.previous)this.previous.width=this.previous.height=0;for(const canvas of this.boundaries.values())canvas.width=canvas.height=0;this.boundaries.clear();this.previous=undefined;}
}
