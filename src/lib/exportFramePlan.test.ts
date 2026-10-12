import { expect, it } from "vitest";
import { exportFramePosition, motionSourceFps } from "./exportFramePlan";

it("samples exact source positions through speed changes and gaps", () => {
  const clips = [
    { id: "fast", start: 2, end: 4, speed: 2 },
    { id: "gap", start: 0, end: 0.5, gap: true },
    { id: "slow", start: 7, end: 8, speed: 0.5 },
  ];
  expect(exportFramePosition(clips, 15, 60, 1)).toMatchObject({
    source: 2.5,
    sequence: 0.25,
  });
  expect(exportFramePosition(clips, 60, 60, 1).clip.id).toBe("gap");
  expect(exportFramePosition(clips, 90, 60, 1)).toMatchObject({
    source: 7,
    sequence: 1.5,
  });
  expect(exportFramePosition(clips, 120, 60, 1)).toMatchObject({
    source: 7.25,
    sequence: 2,
  });
  expect(motionSourceFps(clips, 60, 1)).toBe(120);
  expect(motionSourceFps(clips, 60, 0.5)).toBe(240);
});
