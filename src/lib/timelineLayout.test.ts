import { describe, expect, it } from "vitest";
import { timelineHeightBounds } from "./timelineLayout";

describe("adaptive timeline height", () => {
  it("collapses to the actual rows instead of leaving a black empty floor", () => {
    expect(timelineHeightBounds(1)).toEqual({ minimum: 124, maximum: 124 });
    expect(timelineHeightBounds(3)).toEqual({ minimum: 188, maximum: 188 });
  });

  it("remains resizable for layered projects and caps excessive height", () => {
    expect(timelineHeightBounds(10)).toEqual({ minimum: 190, maximum: 440 });
    expect(timelineHeightBounds(30)).toEqual({ minimum: 190, maximum: 620 });
  });
});
