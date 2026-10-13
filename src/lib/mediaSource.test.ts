import { expect, it, vi } from "vitest";
const convert = vi.hoisted(() => vi.fn((path: string, scheme?: string) => `${scheme}://${path}`));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: convert }));
import { mediaSrc } from "./mediaSource";
import { assetSrc } from "./canvasDraw";

it("uses editor read-ahead only for selected local media and preserves existing URLs", () => {
  expect(mediaSrc("E:\\Recordings\\10 minute demo.mp4")).toBe("snap-media://E:\\Recordings\\10 minute demo.mp4");
  expect(convert).toHaveBeenCalledWith("E:\\Recordings\\10 minute demo.mp4", "snap-media");
  for (const url of ["/Cursors/Bee/Cursor.png", "http://asset.localhost/a%20b.png", "https://demo.test/video.mp4", "blob:demo", "data:image/png;base64,a", "asset://localhost/file.png"]) {
    expect(assetSrc(url)).toBe(url); expect(mediaSrc(url)).toBe(url);
  }
});
