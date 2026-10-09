import { describe, expect, it } from "vitest";
import { timelineHeightBounds, timelineInspectorLayout } from "./timelineLayout";

describe("adaptive timeline height", () => {
  it("keeps a readable opening height and room to resize before tracks finish loading", () => {
    expect(timelineHeightBounds(1)).toEqual({ minimum: 220, maximum: 320 });
    expect(timelineHeightBounds(3)).toEqual({ minimum: 240, maximum: 320 });
  });

  it("remains resizable for layered projects and caps excessive height", () => {
    expect(timelineHeightBounds(10)).toEqual({ minimum: 280, maximum: 492 });
    expect(timelineHeightBounds(30)).toEqual({ minimum: 280, maximum: 620 });
  });
});

it("fits floating inspectors above the timeline or inside a short viewport",()=>{expect(timelineInspectorLayout(520,720)).toEqual({maxHeight:494});expect(timelineInspectorLayout(150,400)).toEqual({position:"absolute",top:-134,bottom:"auto",maxHeight:368});});
