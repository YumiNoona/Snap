import { describe, it, expect } from "vitest";
import { filmstripFrames } from "./timelineFilmstrip";
describe("timeline filmstrip", () => {
  it("samples across the entire source interval", () =>
    expect(filmstripFrames(0, 10, 10, 1040)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]));
  it("only uses frames from a trimmed clip", () =>
    expect(filmstripFrames(5, 8, 10, 312)).toEqual([5, 6, 7]));
  it("handles short clips and bounds atlas indices", () => {
    expect(filmstripFrames(0, 1, 10, 10)).toEqual([0]);
    expect(filmstripFrames(20, 30, 10, 104)).toEqual([9]);
  });
  it("rejects invalid media and limits nodes while zoomed in", () => {
    expect(filmstripFrames(0, 0, 10, 200)).toEqual([]);
    expect(filmstripFrames(0, 1, NaN, 200)).toEqual([]);
    expect(filmstripFrames(0, 10, 10, 1e9)).toHaveLength(200);
  });
});
