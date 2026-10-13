import { describe, expect, it } from "vitest";
import { generateKeyframes, interpolateKeyframe } from "./autoZoom";
import { resolveZoom } from "./canvasDraw";
import { collectZoomRegions } from "./zoomRegions";
import type { InputEvent } from "./types";

const event = (ts: number, type: string, x: number | null, y: number | null): InputEvent => ({
  ts, type, x, y, key: type === "keydown" ? "a" : null, button: type === "mousedown" ? "left" : null,
});

describe("Auto Zoom", () => {
  it("keeps an idle recording stable and full-screen", () => {
    expect(generateKeyframes([], 1920, 1080, 10_000)).toEqual([
      expect.objectContaining({ time: 0, x: 0.5, y: 0.5, scale: 1 }),
    ]);
  });

  it("merges repeated nearby clicks into one stable camera region", () => {
    const frames = generateKeyframes([
      event(1_000, "mousedown", 800, 500),
      event(1_350, "mousedown", 820, 510),
      event(1_700, "mousedown", 810, 490),
    ], 1920, 1080, 8_000);
    const regionIds = new Set(frames.filter((frame) => frame.scale > 1.02).map((frame) => frame.regionId));

    expect(regionIds.size).toBe(1);
    expect(frames.every((frame, index) => index === 0 || frame.time >= frames[index - 1].time)).toBe(true);
  });

  it("keeps edge clicks inside the visible camera bounds", () => {
    const frames = generateKeyframes([event(1_000, "mousedown", 2, 2)], 1920, 1080, 5_000);
    const focused = frames.find((frame) => frame.scale > 1.02);

    expect(focused).toBeDefined();
    expect(focused!.x).toBeGreaterThan(0.25);
    expect(focused!.y).toBeGreaterThan(0.25);
  });

  it("uses smooth bounded interpolation", () => {
    const start = { time: 0, duration: 500, x: 0.5, y: 0.5, scale: 1, easing: "ease-in-out" as const };
    const end = { ...start, time: 1_000, x: 0.7, y: 0.6, scale: 1.8 };
    const middle = interpolateKeyframe(start, end, 500);

    expect(middle).toEqual({ x: 0.6, y: 0.55, scale: 1.4 });
  });

  it("respects camera style scale limits", () => {
    const frames = generateKeyframes(
      [event(1_000, "mousedown", 960, 540)], 1920, 1080, 5_000, 600,
      { maxScale: 1.3, minScale: 1.08 },
    );
    expect(Math.max(...frames.map((frame) => frame.scale))).toBeLessThanOrEqual(1.3);
  });

  it("bakes the selected camera curve into generated moves", () => {
    const frames = generateKeyframes(
      [event(1_000, "mousedown", 960, 540)], 1920, 1080, 5_000, 600,
      { curve: "smoother" },
    );
    expect(frames.filter((frame) => frame.duration > 0).every((frame) => frame.easing === "smoother")).toBe(true);
  });

  it("does not move the camera for typing below the configured intent threshold", () => {
    const typing = [0, 1, 2, 3].map((index) => event(1_000 + index * 80, "keydown", 600, 400));
    const frames = generateKeyframes(typing, 1920, 1080, 5_000, 600, { typingSensitivity: 6 });
    expect(frames.every((frame) => frame.scale === 1)).toBe(true);
  });

  it("supports deliberate activity-follow shots without treating tiny pointer drift as a cut", () => {
    const moves = [event(500, "mousemove", 100, 100), event(1_100, "mousemove", 980, 520), event(1_700, "mousemove", 1_020, 540)];
    const frames = generateKeyframes(moves, 1920, 1080, 5_000, 600, { focusMode: "follow", deadZone: .1 });
    expect(frames.some((frame) => frame.scale > 1.02)).toBe(true);
    expect(new Set(frames.filter((frame) => frame.scale > 1.02).map((frame) => frame.regionId)).size).toBeLessThanOrEqual(2);
  });

  it("uses independent click framing strength", () => {
    const frames = generateKeyframes([event(800, "mousedown", 960, 540)], 1920, 1080, 4_000, 500, { singleClickScale: 2.1, maxScale: 2.2 });
    expect(Math.max(...frames.map((frame) => frame.scale))).toBeCloseTo(2.1);
  });

  it("arrives near the action instead of queuing pans behind long holds", () => {
    const clicks = Array.from({ length: 10 }, (_, i) => event(2000 + i * 2200, "mousedown", i % 2 ? 1500 : 450, 500));
    const frames = generateKeyframes(clicks,1920,1080,28_000,800,{ holdMs:4000, minimumShotMs:1200 });
    const moves = frames.filter(frame => frame.scale > 1.02 && frame.duration > 0);
    expect(moves).toHaveLength(10);
    moves.forEach((move,i) => expect(move.time).toBeLessThanOrEqual(clicks[i].ts + 200));
    frames.forEach((frame,i) => {
      if (!i) return;
      const prior=frames[i-1];
      if(frame.duration===0) expect([frame.x,frame.y,frame.scale]).toEqual([prior.x,prior.y,prior.scale]);
      expect(frame.time-frame.duration).toBeGreaterThanOrEqual(prior.time);
    });
  });

  it("frames rapid opposite-edge clicks together rather than chasing them late", () => {
    const frames=generateKeyframes([event(1000,"mousedown",100,500),event(1250,"mousedown",1820,500),event(1450,"mousedown",120,510)],1920,1080,8000);
    expect(frames.filter(frame=>frame.duration>0&&frame.scale>1.02)).toHaveLength(0);
    expect(Math.max(...frames.map(frame=>frame.scale))).toBe(1);
  });

  it("keeps repeated nearby holds continuous and resets promptly after real inactivity", () => {
    const frames=generateKeyframes([event(1000,"mousedown",700,400),event(2600,"mousedown",735,405),event(11_000,"mousedown",1200,700)],1920,1080,17_000,700);
    expect(collectZoomRegions(frames,17_000)).toHaveLength(2);
    expect(resolveZoom(frames,7000,true,false).scale).toBe(1);
    for(let ts=1;ts<17_000;ts+=4){
      const before=resolveZoom(frames,ts-1,true,false),after=resolveZoom(frames,ts,true,false);
      expect(Math.abs(after.scale-before.scale)).toBeLessThan(.006);
      expect(Math.hypot(after.x-before.x,after.y-before.y)).toBeLessThan(.004);
    }
  });

  it("honors clicks-only and both independent intent thresholds", () => {
    const keys=Array.from({length:10},(_,i)=>event(1000+i*60,"keydown",800,500));
    expect(generateKeyframes(keys,1920,1080,6000,600,{focusMode:"clicks"}).every(frame=>frame.scale===1)).toBe(true);
    const wheels=Array.from({length:5},(_,i)=>event(1000+i*60,"wheel",800,500));
    expect(generateKeyframes(wheels,1920,1080,6000,600,{scrollSensitivity:6}).every(frame=>frame.scale===1)).toBe(true);
    expect(generateKeyframes(keys,1920,1080,6000).some(frame=>frame.scale>1)).toBe(true);
  });

  it("recognizes typing intent even when the user clicks the field before typing", () => {
    const input=[event(1000,"mousedown",800,500),...Array.from({length:12},(_,i)=>event(1200+i*100,"keydown",800,500))];
    const frames=generateKeyframes(input,1920,1080,6000,700,{typingScale:1.3,singleClickScale:1.9});
    expect(Math.max(...frames.map(frame=>frame.scale))).toBeCloseTo(1.3);
    const clicksOnly=generateKeyframes(input,1920,1080,6000,700,{typingScale:1.3,singleClickScale:1.9,focusMode:"clicks"});
    expect(Math.max(...clicksOnly.map(frame=>frame.scale))).toBeCloseTo(1.9);
  });

  it("bounds ten-minute dense activity, timeline IDs and final-frame moves", () => {
    const events=Array.from({length:36_000},(_,i)=>event(i*16,"keydown",800,500));
    const frames=generateKeyframes(events,1920,1080,600_000);
    expect(frames.length).toBeLessThan(10);
    expect(collectZoomRegions(frames,600_000)).toHaveLength(1);
    expect(frames.every(frame=>Number.isFinite(frame.time)&&frame.time<=600_000)).toBe(true);
    expect(generateKeyframes([event(5900,"mousedown",800,500)],1920,1080,6000).every(frame=>frame.scale===1)).toBe(true);
  });

  it("keeps protected content visible and tolerates incomplete numeric settings", () => {
    const frames=generateKeyframes([event(1500,"mousedown",1400,700)],1920,1080,8000,NaN,{holdMs:NaN,maxScale:Infinity,protectedAreas:[{x:0,y:0,w:.15,h:.15}]});
    expect(frames.every(frame=>[frame.time,frame.duration,frame.x,frame.y,frame.scale].every(Number.isFinite))).toBe(true);
    frames.filter(frame=>frame.scale>1.02).forEach(frame=>{
      expect(frame.x-.5/frame.scale).toBeLessThanOrEqual(.001);
      expect(frame.y-.5/frame.scale).toBeLessThanOrEqual(.001);
    });
  });
});
