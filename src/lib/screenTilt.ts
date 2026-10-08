import { motionEase } from "./easing";
import type { Keyframe } from "./types";

export interface ScreenTiltPose { tiltX:number; tiltY:number; rotation:number; scale:number; perspective:number }
export interface ScreenTiltKey extends ScreenTiltPose { time:number; easing:Keyframe["easing"] }
export interface ScreenTiltConfig extends ScreenTiltPose { enabled:boolean; keys:ScreenTiltKey[] }
export const DEFAULT_SCREEN_TILT:ScreenTiltConfig={enabled:false,tiltX:0,tiltY:0,rotation:0,scale:1,perspective:2.5,keys:[]};
const fields=["tiltX","tiltY","rotation","scale","perspective"] as const;
const finite=(value:number,fallback:number,min:number,max:number)=>Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;
function safePose(pose:ScreenTiltPose):ScreenTiltPose { return {tiltX:finite(pose.tiltX,0,-45,45),tiltY:finite(pose.tiltY,0,-45,45),rotation:finite(pose.rotation,0,-180,180),scale:finite(pose.scale,1,.25,2),perspective:finite(pose.perspective,2.5,1.5,6)}; }
export function resolveScreenTilt(config:ScreenTiltConfig|undefined,time:number):ScreenTiltPose {
  if(!config?.enabled)return {...DEFAULT_SCREEN_TILT};
  const keys=(config.keys??[]).filter(k=>Number.isFinite(k.time)).slice().sort((a,b)=>a.time-b.time);
  if(!keys.length)return safePose(config);
  if(time<=keys[0].time)return safePose(keys[0]);
  const right=keys.findIndex(k=>k.time>time);
  if(right<0)return safePose(keys[keys.length-1]);
  const a=safePose(keys[right-1]),b=safePose(keys[right]);
  const mix=motionEase((time-keys[right-1].time)/Math.max(.000001,keys[right].time-keys[right-1].time),keys[right].easing);
  const pose={...a};for(const field of fields)pose[field]=a[field]+(b[field]-a[field])*mix;return pose;
}
export function projectScreenPoint(x:number,y:number,frame:{x:number;y:number;w:number;h:number},raw:ScreenTiltPose):{x:number;y:number} {
  const pose=safePose(raw),r=Math.PI/180,cx=frame.x+frame.w/2,cy=frame.y+frame.h/2;
  const px=(x-cx)*pose.scale,py=(y-cy)*pose.scale;
  const rx=pose.tiltX*r,ry=pose.tiltY*r,rz=pose.rotation*r;
  const yy=py*Math.cos(rx),zz=py*Math.sin(rx);
  const xx=px*Math.cos(ry)+zz*Math.sin(ry),z=-px*Math.sin(ry)+zz*Math.cos(ry);
  const distance=Math.max(frame.w,frame.h)*pose.perspective;
  const factor=distance/Math.max(distance*.2,distance+z);
  return {x:cx+(xx*Math.cos(rz)-yy*Math.sin(rz))*factor,y:cy+(xx*Math.sin(rz)+yy*Math.cos(rz))*factor};
}
interface TiltPass {ctx:CanvasRenderingContext2D;canvas:HTMLCanvasElement;pose:ScreenTiltPose;frame:{x:number;y:number;w:number;h:number}}
const surfaces=new WeakMap<HTMLCanvasElement,HTMLCanvasElement>();
/** Allocate only when a non-flat effect is active. The weak cache follows the preview/export canvas lifetime. */
export function beginScreenTilt(ctx:CanvasRenderingContext2D,config:ScreenTiltConfig|undefined,time:number,frame:TiltPass["frame"]):TiltPass|null {
  if(!config?.enabled)return null;
  const pose=resolveScreenTilt(config,time);
  if(Math.abs(pose.tiltX)+Math.abs(pose.tiltY)+Math.abs(pose.rotation)<.0001&&Math.abs(pose.scale-1)<.0001)return null;
  let canvas=surfaces.get(ctx.canvas);if(!canvas){canvas=document.createElement("canvas");surfaces.set(ctx.canvas,canvas);}
  if(canvas.width!==ctx.canvas.width||canvas.height!==ctx.canvas.height){canvas.width=ctx.canvas.width;canvas.height=ctx.canvas.height;}
  const offscreen=canvas.getContext("2d");if(!offscreen)return null;
  offscreen.clearRect(0,0,canvas.width,canvas.height);
  return {ctx:offscreen,canvas,pose,frame};
}
interface WarpRenderer {canvas:HTMLCanvasElement;gl:WebGLRenderingContext;program:WebGLProgram;texture:WebGLTexture;buffer:WebGLBuffer}
const renderers=new WeakMap<HTMLCanvasElement,WarpRenderer|null>();
function createWarpRenderer():WarpRenderer|null {
  const canvas=document.createElement("canvas");
  const gl=canvas.getContext("webgl",{alpha:true,premultipliedAlpha:true,antialias:true,preserveDrawingBuffer:false,depth:false,stencil:false});
  if(!gl || typeof gl.createShader!=="function")return null;
  const shaders:WebGLShader[]=[];
  const shader=(type:number,source:string)=>{const item=gl.createShader(type);if(!item)return null;shaders.push(item);gl.shaderSource(item,source);gl.compileShader(item);return gl.getShaderParameter(item,gl.COMPILE_STATUS)?item:null;};
  const vertex=shader(gl.VERTEX_SHADER,"attribute vec4 position;attribute vec2 uv;varying vec2 textureUV;void main(){gl_Position=position;textureUV=uv;}");
  const fragment=shader(gl.FRAGMENT_SHADER,"precision highp float;varying vec2 textureUV;uniform sampler2D image;void main(){gl_FragColor=texture2D(image,textureUV);}");
  const program=gl.createProgram(),texture=gl.createTexture(),buffer=gl.createBuffer();
  if(vertex&&fragment&&program){gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);}
  shaders.forEach(item=>gl.deleteShader(item));
  if(!program||!texture||!buffer||!gl.getProgramParameter(program,gl.LINK_STATUS)){if(program)gl.deleteProgram(program);if(texture)gl.deleteTexture(texture);if(buffer)gl.deleteBuffer(buffer);gl.getExtension("WEBGL_lose_context")?.loseContext();return null;}
  gl.useProgram(program);gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
  return {canvas,gl,program,texture,buffer};
}
export function releaseScreenTilt(canvas:HTMLCanvasElement):void {
  const source=surfaces.get(canvas);if(source){source.width=0;source.height=0;}surfaces.delete(canvas);
  const renderer=renderers.get(canvas);
  if(renderer){renderer.gl.deleteTexture(renderer.texture);renderer.gl.deleteBuffer(renderer.buffer);renderer.gl.deleteProgram(renderer.program);renderer.gl.getExtension("WEBGL_lose_context")?.loseContext();renderer.canvas.width=0;renderer.canvas.height=0;}
  renderers.delete(canvas);
}
function drawGpuTilt(ctx:CanvasRenderingContext2D,pass:TiltPass):boolean {
  let renderer=renderers.get(ctx.canvas);if(renderer===undefined){renderer=createWarpRenderer();renderers.set(ctx.canvas,renderer);}
  if(!renderer||renderer.gl.isContextLost())return false;
  const {gl,canvas,program,texture,buffer}=renderer,{pose,frame}=pass;
  if(canvas.width!==pass.canvas.width||canvas.height!==pass.canvas.height){canvas.width=pass.canvas.width;canvas.height=pass.canvas.height;}
  const width=canvas.width,height=canvas.height,cx=frame.x+frame.w/2,cy=frame.y+frame.h/2,distance=Math.max(frame.w,frame.h)*pose.perspective,r=Math.PI/180;
  const vertices:number[]=[];
  for(const [u,v] of [[0,0],[1,0],[0,1],[1,1]]){
    const px=(u*width-cx)*pose.scale,py=(v*height-cy)*pose.scale;
    const yy=py*Math.cos(pose.tiltX*r),zz=py*Math.sin(pose.tiltX*r);
    const xx=px*Math.cos(pose.tiltY*r)+zz*Math.sin(pose.tiltY*r),z=-px*Math.sin(pose.tiltY*r)+zz*Math.cos(pose.tiltY*r);
    const ww=Math.max(.2,1+z/distance),rx=xx*Math.cos(pose.rotation*r)-yy*Math.sin(pose.rotation*r),ry=xx*Math.sin(pose.rotation*r)+yy*Math.cos(pose.rotation*r);
    vertices.push((2*cx/width-1)*ww+2*rx/width,(1-2*cy/height)*ww-2*ry/height,0,ww,u,v);
  }
  gl.viewport(0,0,width,height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STREAM_DRAW);
  const position=gl.getAttribLocation(program,"position"),uv=gl.getAttribLocation(program,"uv");
  gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,4,gl.FLOAT,false,24,0);gl.enableVertexAttribArray(uv);gl.vertexAttribPointer(uv,2,gl.FLOAT,false,24,16);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,pass.canvas);gl.uniform1i(gl.getUniformLocation(program,"image"),0);
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);ctx.drawImage(canvas,0,0);return true;
}
/** Shared perspective-correct GPU plane; a subdivided canvas fallback supports unavailable WebGL. */
/** Subdivided projective plane, shared by preview and export; background and floating overlays stay flat. */
export function finishScreenTilt(ctx:CanvasRenderingContext2D,pass:TiltPass|null):void {
  if(!pass)return;
  try { if(drawGpuTilt(ctx,pass))return; }
  catch {
    // A lost/unsupported upload must not interrupt playback. Keep the canvas fallback for this surface.
    const renderer=renderers.get(ctx.canvas);
    if(renderer){renderer.gl.deleteTexture(renderer.texture);renderer.gl.deleteBuffer(renderer.buffer);renderer.gl.deleteProgram(renderer.program);renderer.gl.getExtension("WEBGL_lose_context")?.loseContext();}
    renderers.set(ctx.canvas,null);
  }
  const {canvas,pose,frame}=pass;
  const columns=canvas.width>1280?24:12,rows=Math.max(6,Math.round(columns*canvas.height/canvas.width));
  const triangle=(src:{x:number;y:number}[],dst:{x:number;y:number}[])=>{
    const [a,b,c]=src,[d,e,f]=dst;
    const dx=b.x-a.x,dy=b.y-a.y,ex=c.x-a.x,ey=c.y-a.y,det=dx*ey-ex*dy;
    const aa=((e.x-d.x)*ey-(f.x-d.x)*dy)/det,cc=((f.x-d.x)*dx-(e.x-d.x)*ex)/det;
    const bb=((e.y-d.y)*ey-(f.y-d.y)*dy)/det,dd=((f.y-d.y)*dx-(e.y-d.y)*ex)/det;
    ctx.save();ctx.beginPath();
    // Slightly expand the clip to avoid transparent hairlines between adjacent triangles.
    const center={x:(d.x+e.x+f.x)/3,y:(d.y+e.y+f.y)/3};
    const expanded=dst.map(p=>{const length=Math.hypot(p.x-center.x,p.y-center.y)||1;return {x:p.x+(p.x-center.x)/length*1.5,y:p.y+(p.y-center.y)/length*1.5};});
    ctx.moveTo(expanded[0].x,expanded[0].y);ctx.lineTo(expanded[1].x,expanded[1].y);ctx.lineTo(expanded[2].x,expanded[2].y);ctx.closePath();ctx.clip();
    ctx.transform(aa,bb,cc,dd,d.x-aa*a.x-cc*a.y,d.y-bb*a.x-dd*a.y);
    ctx.drawImage(canvas,0,0);ctx.restore();
  };
  for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
    const x=col*canvas.width/columns,y=row*canvas.height/rows,w=canvas.width/columns,h=canvas.height/rows;
    const points=[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
    const projected=points.map(p=>projectScreenPoint(p.x,p.y,frame,pose));
    triangle([points[0],points[1],points[2]],[projected[0],projected[1],projected[2]]);
    triangle([points[0],points[2],points[3]],[projected[0],projected[2],projected[3]]);
  }
}
