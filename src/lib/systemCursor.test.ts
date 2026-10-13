import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_EDITOR_CONFIG } from "./types";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, convertFileSrc: (path: string) => path }));
const native = () => ({ width: 20, height: 30, hotspotX: 2, hotspotY: 3, png: [137,80,78,71,13,10,26,10], invertPng: null as number[] | null });

beforeEach(() => {
  vi.resetModules(); invoke.mockReset();
  vi.stubGlobal("Image", class {
    src = ""; complete = true; naturalWidth = 20; naturalHeight = 30;
    decode = vi.fn().mockResolvedValue(undefined);
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("reads and decodes one real Windows asset shared by concurrent preview/picker/export requests", async () => {
  let finish!: (cursor: ReturnType<typeof native>) => void;
  invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { loadSystemCursor } = await import("./systemCursor");
  const first = loadSystemCursor();
  const second = loadSystemCursor(true);
  finish(native());
  const [preview, picker] = await Promise.all([first, second]);
  expect(preview).toBe(picker);
  expect(preview?.hotspot).toEqual({ x: 10, y: 10 });
  expect(preview?.imageUrl).toMatch(/^data:image\/png;base64,/);
  expect(await loadSystemCursor()).toBe(preview);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("get_system_cursor");
});

it("refreshes a changed user pointer and keeps the previous asset if a refresh fails", async () => {
  invoke.mockResolvedValueOnce(native()).mockResolvedValueOnce({ ...native(), hotspotX: 18 }).mockRejectedValueOnce(new Error("Unavailable"));
  const { loadSystemCursor } = await import("./systemCursor");
  const original = await loadSystemCursor();
  const changed = await loadSystemCursor(true);
  expect(changed).not.toBe(original);
  expect(changed?.hotspot.x).toBe(90);
  expect(await loadSystemCursor(true)).toBe(changed);
  expect(invoke).toHaveBeenCalledTimes(3);
});

it("rejects invalid native pointers instead of creating a distorted or invalid cursor", async () => {
  invoke.mockResolvedValueOnce({ ...native(), hotspotX: 99 })
    .mockResolvedValueOnce({ ...native(), png: [1,2,3,4,5,6,7,8] })
    .mockResolvedValueOnce({ ...native(), width: 21 });
  const { loadSystemCursor } = await import("./systemCursor");
  expect(await loadSystemCursor()).toBeNull();
  expect(await loadSystemCursor()).toBeNull();
  expect(await loadSystemCursor()).toBeNull();
});

function context() {
  const draws: { args: unknown[]; operation: string; alpha: number }[] = [];
  const stack: { operation: string; alpha: number; fill: string }[] = [];
  const ctx = {
    globalCompositeOperation: "source-over", globalAlpha: .7, fillStyle: "",
    save() { stack.push({ operation: this.globalCompositeOperation, alpha: this.globalAlpha, fill: this.fillStyle }); },
    restore() { const state = stack.pop()!; this.globalCompositeOperation = state.operation; this.globalAlpha = state.alpha; this.fillStyle = state.fill; },
    drawImage(...args: unknown[]) { draws.push({ args, operation: this.globalCompositeOperation, alpha: this.globalAlpha }); },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, draws };
}

it("uses native pixels and hotspot at the selected size, without applying an old orange cursor tint", async () => {
  invoke.mockResolvedValue(native());
  const { loadSystemCursor, drawSystemCursor } = await import("./systemCursor");
  const asset = await loadSystemCursor();
  const { ctx, draws } = context();
  drawSystemCursor(ctx, 100, 90, { ...DEFAULT_EDITOR_CONFIG.cursorStyle, size: 24, color: "#d58a55" }, asset);
  drawSystemCursor(ctx, 100, 90, { ...DEFAULT_EDITOR_CONFIG.cursorStyle, size: 24, color: "#ff0000" }, asset);
  expect(draws[0]).toEqual(draws[1]);
  expect(draws[0].args[0]).toBe(asset?.image);
  expect(draws[0].args.slice(1)).toEqual([98.4, 87.6, 16, 24]);
  expect(ctx.globalAlpha).toBe(.7);
});

it("composites inverted Windows pointer pixels against the footage and restores the canvas state", async () => {
  const packet = native(); packet.invertPng = packet.png;
  invoke.mockResolvedValue(packet);
  const { loadSystemCursor, drawSystemCursor } = await import("./systemCursor");
  const asset = await loadSystemCursor();
  const { ctx, draws } = context();
  drawSystemCursor(ctx, 100, 90, DEFAULT_EDITOR_CONFIG.cursorStyle, asset);
  expect(draws).toHaveLength(2);
  expect(draws[1].args[0]).toBe(asset?.invertImage);
  expect(draws[1].operation).toBe("difference");
  expect(ctx.globalCompositeOperation).toBe("source-over");
  expect(ctx.globalAlpha).toBe(.7);
});

it("uses a neutral white fallback when native loading is unavailable, not a colored arrow", async () => {
  const { drawSystemCursor } = await import("./systemCursor");
  const fills: string[] = [];
  const ctx = {
    fillStyle: "", save: () => {}, restore: () => {}, translate: () => {},
    beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, closePath: () => {},
    stroke: () => {}, fill(this: { fillStyle: string }) { fills.push(this.fillStyle); },
  } as unknown as CanvasRenderingContext2D;
  drawSystemCursor(ctx, 0, 0, { ...DEFAULT_EDITOR_CONFIG.cursorStyle, color: "#d58a55" }, null);
  expect(fills).toEqual(["#ffffff"]);
});
