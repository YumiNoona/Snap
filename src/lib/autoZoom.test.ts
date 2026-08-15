import { describe, expect, it } from "vitest";
import { generateKeyframes, interpolateKeyframe } from "./autoZoom";
import type { InputEvent } from "./types";

const event = (ts: number, type: string, x: number | null, y: number | null): InputEvent => ({
  ts, type, x, y, key: type === "keydown" ? "a" : null, button: type === "mousedown" ? "left" : null,
});

describe("Auto Zoom", () => {
  it("keeps an idle recording stable and full-screen", () => {
    expect(generateKeyframes([], 1920, 1080, 10_000)).toEqual([
      expect.objectContaining({ time: 0, x: 0.5, y: 0.5, scale: 1 }),
    ]);
  });

  it("merges repeated nearby clicks into one stable camera region", () => {
    const frames = generateKeyframes([
      event(1_000, "mousedown", 800, 500),
      event(1_350, "mousedown", 820, 510),
      event(1_700, "mousedown", 810, 490),
    ], 1920, 1080, 8_000);
    const regionIds = new Set(frames.filter((frame) => frame.scale > 1.02).map((frame) => frame.regionId));

    expect(regionIds.size).toBe(1);
    expect(frames.every((frame, index) => index === 0 || frame.time >= frames[index - 1].time)).toBe(true);
  });

  it("keeps edge clicks inside the visible camera bounds", () => {
    const frames = generateKeyframes([event(1_000, "mousedown", 2, 2)], 1920, 1080, 5_000);
    const focused = frames.find((frame) => frame.scale > 1.02);

    expect(focused).toBeDefined();
    expect(focused!.x).toBeGreaterThan(0.25);
    expect(focused!.y).toBeGreaterThan(0.25);
  });

  it("uses smooth bounded interpolation", () => {
    const start = { time: 0, duration: 500, x: 0.5, y: 0.5, scale: 1, easing: "ease-in-out" as const };
    const end = { ...start, time: 1_000, x: 0.7, y: 0.6, scale: 1.8 };
    const middle = interpolateKeyframe(start, end, 500);

    expect(middle).toEqual({ x: 0.6, y: 0.55, scale: 1.4 });
  });

  it("respects camera style scale limits", () => {
    const frames = generateKeyframes(
      [event(1_000, "mousedown", 960, 540)], 1920, 1080, 5_000, 600,
      { maxScale: 1.3, minScale: 1.08 },
    );
    expect(Math.max(...frames.map((frame) => frame.scale))).toBeLessThanOrEqual(1.3);
  });

  it("does not move the camera for typing below the configured intent threshold", () => {
    const typing = [0, 1, 2, 3].map((index) => event(1_000 + index * 80, "keydown", 600, 400));
    const frames = generateKeyframes(typing, 1920, 1080, 5_000, 600, { typingSensitivity: 6 });
    expect(frames.every((frame) => frame.scale === 1)).toBe(true);
  });
});
