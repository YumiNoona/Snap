import { expect, it, vi } from "vitest";
import { loadCachedVideo, pendingVideoRepair, reconcileVideoLayers, releaseVideo } from "./canvasDraw";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, convertFileSrc: (path: string) => `asset:${path}` }));
it("repairs unsupported imported codecs once, retains original identity, and discards released results", async () => {
  const media = () => ({ src:"", pause:vi.fn(), load:vi.fn(), removeAttribute:vi.fn(), getAttribute:()=>"asset:compatible.mp4" });
  vi.stubGlobal("document", { createElement: media }); vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  let resolve!: (path: string) => void;
  invoke.mockImplementation(() => new Promise<string>(r => { resolve = r; }));
  try {
    const cache = new Map<string,HTMLVideoElement>();
    const video = loadCachedVideo("original.mkv",cache,"clip");
    video.onerror?.(new Event("error")); const promise = pendingVideoRepair(video);
    video.onerror?.(new Event("error")); expect(invoke).toHaveBeenCalledTimes(1);
    resolve("compatible.mp4"); await promise;
    expect(video.src).toBe("asset:compatible.mp4");
    reconcileVideoLayers([{id:"clip",type:"video",path:"original.mkv",start:0,end:5,x:0,y:0,w:1,h:1}],2,false,cache);
    expect(cache.get("clip")).toBe(video);
    const second = loadCachedVideo("second.mkv",cache,"second");
    second.onerror?.(new Event("error")); const cancelled = pendingVideoRepair(second);
    releaseVideo(second); resolve("discarded.mp4"); await cancelled;
    expect(second.src).not.toBe("asset:discarded.mp4"); expect(second.onerror).toBeNull();
  } finally { vi.unstubAllGlobals(); }
});
