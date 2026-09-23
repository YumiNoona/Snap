import { describe, expect, it } from "vitest";
import { createIvfHeader, wrapIvfFrame } from "./ivf";

describe("IVF export stream", () => {
  it("writes a VP8 header with dimensions, rate, and frame count", () => {
    const header = createIvfHeader(1920, 1080, 60, 1_800, "VP80");
    const view = new DataView(header.buffer);
    expect(new TextDecoder().decode(header.subarray(0, 4))).toBe("DKIF");
    expect(new TextDecoder().decode(header.subarray(8, 12))).toBe("VP80");
    expect(view.getUint16(12, true)).toBe(1920);
    expect(view.getUint16(14, true)).toBe(1080);
    expect(view.getUint32(16, true)).toBe(60);
    expect(view.getUint32(24, true)).toBe(1_800);
  });

  it("prefixes encoded frames with their byte size and presentation index", () => {
    const frame = wrapIvfFrame(new Uint8Array([5, 6, 7]), 42);
    const view = new DataView(frame.buffer);
    expect(view.getUint32(0, true)).toBe(3);
    expect(view.getBigUint64(4, true)).toBe(42n);
    expect(Array.from(frame.subarray(12))).toEqual([5, 6, 7]);
  });
});
