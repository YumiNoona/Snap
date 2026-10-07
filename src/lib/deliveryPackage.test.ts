import { expect, it } from "vitest";
import { buildDeliveryPackage } from "./deliveryPackage";
import type { CaptionTrack, Keyframe } from "./types";

it("includes only exported captions and clamps chapter endpoints at both trim boundaries", () => {
  const captions = [{ visible: true, segments: [
    { startMs: 0, endMs: 1000, text: "Outside" },
    { startMs: 4000, endMs: 6000, text: "Included" },
    { startMs: 11000, endMs: 13000, text: "Later" },
  ] }, { visible: false, segments: [{ startMs: 6000, endMs: 7000, text: "Hidden" }] }] as CaptionTrack[];
  const frames: Keyframe[] = [
    { time: 4000, duration: 1000, scale: 2, x: .5, y: .5, easing: "linear", regionId: "one" },
    { time: 15000, duration: 1000, scale: 1, x: .5, y: .5, easing: "linear", regionId: "one" },
  ];
  const result = buildDeliveryPackage(captions, frames, 5, 10, 2);
  expect(result.transcript).toBe("Included");
  expect(JSON.parse(result.chapters)).toEqual([{ title: "Chapter 1", startSeconds: 0, endSeconds: 2.5 }]);
  expect(result.thumbnailTimeSeconds).toBeCloseTo(.875);
});
