import { afterEach, expect, it, vi } from "vitest";
import { loadCachedVideo, reconcileVideoLayers } from "./canvasDraw";
import type { VideoLayer } from "./types";

function media() {
  let src = "";
  return { set src(value: string) { src = value; }, getAttribute: () => src,
    removeAttribute: () => { src = ""; }, pause: vi.fn(), load: vi.fn(), paused: false } as unknown as HTMLVideoElement;
}
function layer(id: string, start = 0): VideoLayer {
  return { id, type: "video", path: "/same.mp4", start, end: start + 3, x: 0, y: 0, w: 1, h: 1 };
}
afterEach(() => vi.unstubAllGlobals());

it("uses independent decoders for two clips sharing a source and releases deleted clips", () => {
  vi.stubGlobal("document", { createElement: () => media() });
  const cache = new Map<string, HTMLVideoElement>();
  const one = loadCachedVideo("/same.mp4", cache, "one");
  const two = loadCachedVideo("/same.mp4", cache, "two");
  expect(one).not.toBe(two);
  reconcileVideoLayers([layer("two")], 1, true, cache);
  expect(cache.has("one")).toBe(false);
  expect(one.pause).toHaveBeenCalled();
  expect(one.load).toHaveBeenCalled();
  expect(two.pause).not.toHaveBeenCalled();
  reconcileVideoLayers([layer("two")], 4, true, cache);
  expect(two.pause).toHaveBeenCalled();
});

it("bounds inactive decoder retention and releases replaced media", () => {
  vi.stubGlobal("document", { createElement: () => media() });
  const cache = new Map<string, HTMLVideoElement>();
  const layers = Array.from({ length: 20 }, (_, index) => layer(String(index), 10));
  for (const clip of layers) loadCachedVideo(clip.path, cache, clip.id);
  reconcileVideoLayers(layers, 0, false, cache);
  expect(cache.size).toBe(8);
  const replaced = cache.get("19")!;
  reconcileVideoLayers(layers.map((clip) => clip.id === "19" ? { ...clip, path: "/replacement.mp4" } : clip), 0, false, cache);
  expect(cache.has("19")).toBe(false);
  expect(replaced.load).toHaveBeenCalled();
});
