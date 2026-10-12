import { describe, it, expect } from "vitest";
import { normalizeCurve, parseCube, sampleCurve, sampleLut } from "./colorLut";
describe("Cube LUTs", () => {
  it("respects red-fastest 3D ordering and interpolates channels", () => {
    const values = Array.from(
        { length: 8 },
        (_, i) =>
          `${1 - (i % 2)} ${Math.floor(i / 2) % 2} ${Math.floor(i / 4)}`,
      ).join("\n"),
      lut = parseCube(
        `TITLE "Invert red"\nLUT_3D_SIZE 2\n${values}`,
        "fixture",
        "lut",
      );
    expect(sampleLut(lut, [0.25, 0.5, 0.75])).toEqual([0.75, 0.5, 0.75]);
    expect(JSON.parse(JSON.stringify(lut)).name).toBe("Invert red");
  });
  it("supports 1D tables and non-default input domains", () => {
    const lut = parseCube(
      "LUT_1D_SIZE 2\nDOMAIN_MIN -1 -1 -1\nDOMAIN_MAX 1 1 1\n0 0 0\n1 .5 .25",
      "one",
    );
    expect(sampleLut(lut, [0, 0, 0])).toEqual([0.5, 0.25, 0.125]);
  });
  it("rejects malformed, incomplete and unsupported hybrid LUTs", () => {
    for (const text of [
      "LUT_3D_SIZE 1",
      "LUT_3D_SIZE 2\n0 0 0",
      "LUT_1D_SIZE 2\nLUT_3D_SIZE 2",
      "LUT_1D_SIZE 2\nNaN 0 0\n1 1 1",
    ])
      expect(() => parseCube(text, "bad")).toThrow();
  });
});
describe("RGB curves", () => {
  it("preserves identity and endpoints", () => {
    for (let i = 0; i <= 100; i++)
      expect(sampleCurve(undefined, i / 100)).toBeCloseTo(i / 100, 7);
    expect(normalizeCurve([{ x: 0.5, y: 0.7 }])).toEqual([
      { x: 0, y: 0 },
      { x: 0.5, y: 0.7 },
      { x: 1, y: 1 },
    ]);
  });
  it("keeps a monotonic tone curve monotonic without overshoot", () => {
    const p = [
        { x: 0, y: 0.1 },
        { x: 0.2, y: 0.12 },
        { x: 0.7, y: 0.8 },
        { x: 1, y: 0.9 },
      ],
      v = Array.from({ length: 1001 }, (_, i) => sampleCurve(p, i / 1000));
    expect(v.every((n, i) => !i || n >= v[i - 1])).toBe(true);
    expect(v[0]).toBeCloseTo(0.1);
    expect(v[1000]).toBeCloseTo(0.9);
  });
});
