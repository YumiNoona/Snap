import { afterEach, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => path }));
import { clearImageAssets, loadCachedImage, readyImageAsset } from "./canvasDraw";
afterEach(() => { clearImageAssets(); vi.unstubAllGlobals(); });

it("decodes the first selected cursor without a second click and shares its cached bitmap", async () => {
  let image!: EventTarget & { complete: boolean; naturalWidth: number; decode: ReturnType<typeof vi.fn> };
  vi.stubGlobal("Image", class extends EventTarget {
    complete=false; naturalWidth=0; src=""; decode=vi.fn(async () => {}); removeAttribute(){}
    constructor(){ super(); image=this; }
  });
  const pending = readyImageAsset("/cursor.png", true);
  let painted = false; void pending.then(() => { painted = true; });
  expect(painted).toBe(false);
  image.complete = true; image.naturalWidth = 128; image.dispatchEvent(new Event("load"));
  const decoded = await pending;
  expect(painted).toBe(true); expect(image.decode).toHaveBeenCalledOnce();
  expect(loadCachedImage("/cursor.png", new Map())).toBe(decoded);
});

it("retries failed images only on explicit selection and does not issue network requests per frame", async () => {
  let count=0;
  vi.stubGlobal("Image", class extends EventTarget {
    complete=true; naturalWidth=++count === 1 ? 0 : 100; src=""; removeAttribute(){}; decode=async()=>{};
  });
  await expect(readyImageAsset("/retry.png")).rejects.toThrow();
  const cache = new Map<string, HTMLImageElement>();
  for(let frame=0;frame<60;frame++) loadCachedImage("/retry.png",cache);
  expect(count).toBe(1);
  expect((await readyImageAsset("/retry.png",true)).naturalWidth).toBe(100);
  expect(count).toBe(2);
});
