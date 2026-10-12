import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import MediaPreview from "./MediaPreview";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, convertFileSrc: (path: string) => `asset:${path}` }));
it("uses a cached video still, retries failure, and ignores stale async thumbnails", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.spyOn(console,"error").mockImplementation(()=>{});
  let resolve!: (file: string) => void;
  invoke.mockImplementationOnce(() => new Promise<string>(r => { resolve = r; }));
  let renderer!: ReturnType<typeof create>;
  try {
    await act(async () => { renderer = create(createElement(MediaPreview,{path:"old.mkv",kind:"video",name:"Old"})); });
    await act(async () => { renderer.update(createElement(MediaPreview,{path:"new.png",kind:"image",name:"New"})); });
    await act(async () => { resolve("stale.jpg"); });
    expect(renderer.root.findByType("img").props.src).toBe("asset:new.png");
    await act(async () => renderer.root.findByType("img").props.onError());
    expect(renderer.root.findAllByType("img")).toHaveLength(0);
    await act(async () => renderer.root.findByProps({"aria-label":"Retry New preview"}).props.onClick());
    expect(renderer.root.findByType("img").props.src).toBe("asset:new.png");
  } finally { if(renderer) await act(async()=>renderer.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});
