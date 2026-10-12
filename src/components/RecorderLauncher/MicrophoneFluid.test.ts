import { expect, it } from "vitest";
import { fluidLevel } from "./MicrophoneFluid";
it("responds to actual amplitude with silence gating and safe clamping", () => {
  expect(fluidLevel(0)).toBe(0); expect(fluidLevel(.001)).toBe(0);
  expect(fluidLevel(NaN)).toBe(0); expect(fluidLevel(-1)).toBe(0);
  expect(fluidLevel(.08)).toBeGreaterThan(fluidLevel(.01));
  expect(fluidLevel(1)).toBe(1);
});
