import { describe, expect, it } from "vitest";
import { COLOR_PRESETS, GRADIENT_PRESETS, getGradientPreset } from "./wallpapers";

describe("background presets", () => {
  it("keeps the curated grids at the intended sizes", () => {
    expect(GRADIENT_PRESETS).toHaveLength(24);
    expect(COLOR_PRESETS).toHaveLength(24);
  });

  it("round-trips a serialized custom gradient", () => {
    expect(getGradientPreset("custom-gradient|linear|125|#111111|#8855ff|#ffeeaa")).toEqual({
      id: "custom-gradient|linear|125|#111111|#8855ff|#ffeeaa",
      name: "Custom gradient",
      type: "linear",
      angle: 125,
      colors: [
        { color: "#111111", offset: 0 },
        { color: "#8855ff", offset: 50 },
        { color: "#ffeeaa", offset: 100 },
      ],
    });
  });
});
