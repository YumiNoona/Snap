import { expect, it } from "vitest";
import { motionEase } from "./easing";
import { resolveZoom } from "./canvasDraw";
it("solves cubic Bezier time and hold interpolation consistently", () => {
  expect(motionEase(0.5, "custom", [0.5, 0, 0.5, 1])).toBeCloseTo(0.5);
  expect(motionEase(0.5, "custom", [0.1, 1, 0.2, 1])).toBeGreaterThan(0.9);
  expect(motionEase(0.99, "hold")).toBe(0);
  expect(motionEase(1, "hold")).toBe(1);
});
it("uses custom handles inside the zoom incoming window", () => {
  const keys = [
    { time: 0, duration: 0, x: 0.5, y: 0.5, scale: 1 },
    {
      time: 1000,
      duration: 500,
      x: 0.5,
      y: 0.5,
      scale: 2,
      easing: "custom",
      bezier: [0.1, 1, 0.2, 1] as [number, number, number, number],
    },
  ];
  expect(resolveZoom(keys, 400, true, false).scale).toBe(1);
  expect(resolveZoom(keys, 750, true, false).scale).toBeGreaterThan(1.9);
});
