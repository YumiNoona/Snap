import { describe,expect,it,vi } from "vitest";
import {beginScreenTilt,finishScreenTilt,releaseScreenTilt,DEFAULT_SCREEN_TILT,resolveScreenTilt,projectScreenPoint} from "./screenTilt";

const frame={x:80,y:60,w:800,h:450};
describe("3D screen tilt",()=>{
  it("keeps neutral geometry exact and projects perspective with finite corners",()=>{
    for(const point of [{x:80,y:60},{x:880,y:510},{x:480,y:285}])expect(projectScreenPoint(point.x,point.y,frame,DEFAULT_SCREEN_TILT)).toEqual(point);
    const pose={...DEFAULT_SCREEN_TILT,tiltY:30,tiltX:15};
    const left=projectScreenPoint(80,60,frame,pose),right=projectScreenPoint(880,60,frame,pose);
    expect(left.y).not.toBeCloseTo(right.y);
    for(const point of [left,right,projectScreenPoint(880,510,frame,{...pose,perspective:1.5,scale:2})]){expect(Number.isFinite(point.x)).toBe(true);expect(Number.isFinite(point.y)).toBe(true);}
  });
  it("interpolates source-time keys and holds the first and last poses",()=>{
    const config={...DEFAULT_SCREEN_TILT,enabled:true,keys:[{...DEFAULT_SCREEN_TILT,time:4,tiltY:30,easing:"linear" as const},{...DEFAULT_SCREEN_TILT,time:0,tiltY:0,easing:"linear" as const}]};
    expect(resolveScreenTilt(config,2).tiltY).toBe(15);
    expect(resolveScreenTilt(config,-1).tiltY).toBe(0);
    expect(resolveScreenTilt(config,20).tiltY).toBe(30);
    expect(resolveScreenTilt({...config,enabled:false},2).tiltY).toBe(0);
    expect(config.keys[0].time).toBe(4);
  });
  it("does no buffer work when disabled or flat and reuses active render buffers",()=>{
    const offscreen={clearRect:vi.fn()};const buffer={width:0,height:0,getContext:()=>offscreen};
    const create=vi.fn(()=>buffer);vi.stubGlobal("document",{createElement:create});
    const ctx={canvas:{width:1280,height:720},save:vi.fn(),restore:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),closePath:vi.fn(),clip:vi.fn(),transform:vi.fn(),drawImage:vi.fn()} as unknown as CanvasRenderingContext2D;
    try {
      expect(beginScreenTilt(ctx,undefined,0,frame)).toBeNull();
      expect(beginScreenTilt(ctx,{...DEFAULT_SCREEN_TILT,enabled:true},0,frame)).toBeNull();
      expect(create).not.toHaveBeenCalled();
      const config={...DEFAULT_SCREEN_TILT,enabled:true,tiltY:20};
      const first=beginScreenTilt(ctx,config,0,frame);const second=beginScreenTilt(ctx,config,1,frame);
      expect(first!.canvas).toBe(second!.canvas);expect(create).toHaveBeenCalledTimes(1);
      finishScreenTilt(ctx,second);expect(ctx.drawImage).toHaveBeenCalled();expect(ctx.save).toHaveBeenCalledTimes(vi.mocked(ctx.restore).mock.calls.length);
      for(const call of vi.mocked(ctx.transform).mock.calls)expect(call.every(Number.isFinite)).toBe(true);
      releaseScreenTilt(ctx.canvas);
      expect(buffer.width).toBe(0);expect(buffer.height).toBe(0);
      const allocations=create.mock.calls.length;
      beginScreenTilt(ctx,config,2,frame);
      expect(create.mock.calls.length).toBe(allocations+1);
    }finally{vi.unstubAllGlobals();}
  });
});
