import { clipDuration, clipSpeed, sequenceTime, sequenceClip } from "./videoEditing";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_EDITOR_CONFIG, type VideoClip, type ExportSettings } from "./types";
import { runCanvasExport } from "./canvasExport";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), compositor: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, convertFileSrc: (path: string) => path }));
vi.mock("./exportCompositor", () => ({ createExportCompositor: mocks.compositor }));
const cleanups=new Set<()=>void>();
afterEach(() => {for(const cleanup of cleanups)cleanup();cleanups.clear();vi.unstubAllGlobals(); vi.clearAllMocks(); });

async function exerciseExport(rate: number, cancelAtCut = false, supplied?: VideoClip[]) {
  const controller = new AbortController();
  const clips = supplied ?? [{ id: "a", start: 0, end: 1 }, { id: "b", start: 3, end: 4 }];
  const length=clips.reduce((sum,clip)=>sum+clipDuration(clip),0);
  let activeIndex=0;
  let time = 0, paused = true, consumer: (() => void) | null = null;
  const target = new EventTarget();
  const canvas = { sourceTime: 0, clipId:clips[0].id, gap:false, getContext: () => ({ getImageData: () => ({ data: new Uint8Array(4) }) }) };
  const video = Object.assign(target, {
    get currentTime() { return time; },
    play: async () => { paused = false; }, pause: () => { paused = true; },
    ended: false, error: null, seeking: false, playbackRate: rate,
  });
  Object.defineProperty(video, "currentTime", { get: () => time, set: value => { time = value; if (cancelAtCut && value === 3) controller.abort(); queueMicrotask(() => target.dispatchEvent(new Event("seeked"))); } });
  const renderFrame = () => {
    const clip=clips[activeIndex];if (clip.gap||time>=clip.start&&time<clip.end) {canvas.clipId=clip.id;canvas.gap=!!clip.gap;canvas.sourceTime=clip.gap?0:time;consumer?.();}
  };
  const timers=new Set<ReturnType<typeof setTimeout>>();
  const cleanup=()=>{controller.abort();for(const timer of timers)clearTimeout(timer);timers.clear();};
  cleanups.add(cleanup);
  const destroy = vi.fn(()=>{for(const timer of timers)clearTimeout(timer);timers.clear();});
  const setClip = vi.fn((id:string)=>{activeIndex=clips.findIndex(clip=>clip.id===id);});
  mocks.compositor.mockResolvedValue({ video, canvas, clickTimesMs: [500, 2000, 3500], renderFrame, setClip, setFrameConsumer: (next: typeof consumer) => { consumer = next; }, destroy });
  mocks.invoke.mockImplementation(async (command: string) => command === "finalize_canvas_export" ? "done.mp4" : undefined);
  const frames: Array<{ source: number; timestamp: number; clipId:string;gap:boolean }> = [];
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {const timer=setTimeout(() => {
    timers.delete(timer);
    if (!paused) time += .025 * video.playbackRate;
    renderFrame(); callback();
  }, 0);timers.add(timer);return timer;});
  vi.stubGlobal("VideoFrame", class {
    source: number; timestamp: number;clipId:string;gap:boolean;
    constructor(source: typeof canvas, options: { timestamp: number }) { this.source = source.sourceTime;this.clipId=source.clipId;this.gap=source.gap;this.timestamp = options.timestamp; }
    close() {}
  });
  vi.stubGlobal("VideoEncoder", class {
    static async isConfigSupported() { return { supported: true }; }
    encodeQueueSize = 0; state = "configured";
    constructor(private callbacks: { output: (chunk: unknown) => void }) {}
    configure() {}
    encode(frame: { source: number; timestamp: number;clipId:string;gap:boolean }) {
      frames.push({ ...frame });
      this.callbacks.output({ byteLength: 1, timestamp: frame.timestamp, copyTo: (bytes: Uint8Array) => { bytes[0] = 1; } });
    }
    async flush() {} close() { this.state = "closed"; }
  });
  const settings = { format: "mp4", fps: 30, width: 640, height: 360, quality: "medium", outputPath: "done.mp4", captions: "none" } as ExportSettings;
  const config = { ...DEFAULT_EDITOR_CONFIG, videoClips: clips, playbackRate: rate, cursorStyle: { ...DEFAULT_EDITOR_CONFIG.cursorStyle, clickSound: true } };
  const operation = runCanvasExport("source.mp4", "events.json", [], config, [], [], null, settings, 0, 4, vi.fn(), controller.signal);
  if (cancelAtCut) {
    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    expect(destroy).toHaveBeenCalledOnce();
    expect(mocks.invoke.mock.calls.some(call => call[0] === "finalize_canvas_export")).toBe(false);
    expect(mocks.invoke.mock.calls.some(call => call[0] === "discard_canvas_export")).toBe(true);
    return;
  }
  await expect(operation).resolves.toBe("done.mp4");
  expect(frames).toHaveLength(Math.ceil(length / rate * 30));
  expect(frames.every(f => f.gap || f.source < 1 || (f.source >= 3 && f.source < 4))).toBe(true);
  expect(frames.some(f => f.source >= 3)).toBe(true);
  expect(frames.map(f => f.timestamp)).toEqual(frames.map((_, index) => Math.round(index * 1_000_000 / 30)));
  const request = mocks.invoke.mock.calls.find(call => call[0] === "finalize_canvas_export")![1].request;
  expect(request.sourceSegments).toEqual(clips.map(clip => ({start:clip.start,end:clip.end,speed:clipSpeed(clip),gap:!!clip.gap})));
  expect(request.exportDurationSeconds).toBe(length / rate);
  expect(request.clickTimesMs).toEqual(clips.filter(clip=>!clip.gap).flatMap(clip=>[500,2000,3500].filter(time=>time>=clip.start*1000&&time<clip.end*1000).map(time=>(sequenceTime(clips,clip.start,clip.id)*1000+(time-clip.start*1000)/clipSpeed(clip))/rate)));
  frames.forEach((frame,index)=>{const position=sequenceClip(clips,Math.min(length-1e-6,index/30*rate));if(!position)return;expect(frame.clipId).toBe(position.clip.id);if(!position.clip.gap){expect(frame.source).toBeGreaterThanOrEqual(position.clip.start);expect(frame.source).toBeLessThan(position.clip.end);}});
  expect(destroy).toHaveBeenCalledOnce();
  expect(setClip.mock.calls.map(call=>call[0])).toEqual(clips.map(clip=>clip.id));
  expect(mocks.compositor.mock.calls[0][9]).toBe(false);
}
it.each([.5, 1, 2])("exports joined frames and audio/click timestamps at %sx without encoding deleted footage", async rate => { await exerciseExport(rate); },15000);
it("cancels a cut-boundary seek and releases the compositor and staging output", async () => { await exerciseExport(1, true); },15000);

it("exports reordered and duplicated source ranges in the chosen order", async()=>{await exerciseExport(1,false,[{id:"b",start:3,end:4},{id:"a",start:0,end:1},{id:"repeat",start:3,end:4}]);},15000);

it("exports clip speed changes and leading/internal/trailing gaps with continuous frame timestamps",async()=>{await exerciseExport(1,false,[{id:"lead",start:0,end:.1,gap:true},{id:"a",start:0,end:1,speed:2},{id:"space",start:0,end:.2,gap:true},{id:"b",start:3,end:4,speed:.5},{id:"tail",start:0,end:.1,gap:true}]);},15000);
