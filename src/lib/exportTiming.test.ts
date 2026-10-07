import { expect, it } from "vitest";
import { exportPlaybackRate, outputDuration, renderProgress } from "./exportTiming";

it("uses output time for duration while progress follows the source fraction", () => {
  for (const rate of [.5, 1, 2]) {
    expect(outputDuration(10, 30, rate)).toBe(20 / rate);
    expect(renderProgress(20, 10, 30)).toBe(.5);
  }
  expect(exportPlaybackRate(NaN)).toBe(1);
  expect(renderProgress(40, 10, 30)).toBe(.97);
});
