import { describe, expect, it } from "vitest";
import { captionAnimationFrame, revealCaptionText } from "./captionAnimation";

describe("caption entrance animations", () => {
  it("reveals text progressively without returning an empty active caption", () => {
    expect(revealCaptionText("Reveal text", 0)).toBe("R");
    expect(revealCaptionText("Reveal text", 1)).toBe("Reveal text");
  });

  it("settles every animated preset into the stable frame", () => {
    for (const preset of ["fade", "reveal", "pop", "rise", "slide", "blur", "bounce"] as const) {
      const frame = captionAnimationFrame(preset, 2_000);
      expect(frame.alpha).toBe(1);
      expect(frame.scale).toBeCloseTo(1);
      expect(frame.rise).toBe(0);
      expect(frame.reveal).toBe(1);
    }
  });
});
