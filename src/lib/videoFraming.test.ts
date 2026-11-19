import { describe, expect, it } from "vitest";
import {
  drawSplitFrame,
  fitRect,
  normalizedRect,
  videoFrame,
} from "./videoFraming";
import { DEFAULT_EDITOR_CONFIG } from "./types";
import { captureLayout, formatLayout } from "./editorFinishing";

describe("proportion-preserving framing", () => {
  it("fills both stacked streaming panels while preserving source proportions", () => {
    const calls: number[][] = [];
    const ctx = {
      save() {},
      restore() {},
      beginPath() {},
      rect() {},
      clip() {},
      fillRect() {},
      drawImage(_v: unknown, ...args: number[]) {
        calls.push(args);
      },
    } as unknown as CanvasRenderingContext2D;
    drawSplitFrame(
      ctx,
      {} as CanvasImageSource,
      1920,
      1080,
      { x: 0, y: 0, w: 1080, h: 1920 },
      {
        camera: { x: 0, y: 0, w: 0.25, h: 0.35 },
        content: { x: 0, y: 0, w: 1, h: 1 },
        fraction: 0.38,
        cameraFit: "cover",
        contentFit: "cover",
      },
    );
    expect(calls).toHaveLength(2);
    for (const [, , sw, sh, , , dw, dh] of calls) {
      expect(dw).toBe(1080);
      expect(sw / sh).toBeCloseTo(dw / dh);
    }
    expect(calls[0][7] + calls[1][7]).toBeCloseTo(1920);
  });
  it("fits wide footage into vertical output without removing either edge", () => {
    const source = { x: 0, y: 0, w: 1920, h: 1080 };
    const fitted = fitRect(source, { x: 0, y: 0, w: 1080, h: 1920 }, "contain");
    expect(fitted.source).toEqual(source);
    expect(fitted.target.w / fitted.target.h).toBeCloseTo(16 / 9);
    expect(fitted.target.y).toBeGreaterThan(0);
  });
  it("fills by cropping rather than stretching", () => {
    const { source, target } = fitRect(
      { x: 0, y: 0, w: 1920, h: 1080 },
      { x: 0, y: 0, w: 1080, h: 1920 },
      "cover",
    );
    expect(source.w).toBeLessThan(1920);
    expect(source.w / source.h).toBeCloseTo(target.w / target.h);
    expect(target.h).toBe(1920);
  });
  it("keeps source proportions with equal padding even at the original ratio", () => {
    const frame = videoFrame(DEFAULT_EDITOR_CONFIG, 1920, 1080, 1920, 1080);
    expect(frame.w / frame.h).toBeCloseTo(16 / 9);
    expect(frame.x).toBeGreaterThanOrEqual(DEFAULT_EDITOR_CONFIG.padding);
  });
  it("fits a deliberate source crop without a second destructive crop", () => {
    const frame = videoFrame(
      {
        ...DEFAULT_EDITOR_CONFIG,
        padding: 0,
        crop: { x: 0.1, y: 0, w: 0.5, h: 1 },
      },
      1080,
      1920,
      1920,
      1080,
    );
    expect(frame.w / frame.h).toBeCloseTo(8 / 9);
  });
  it("keeps padding proportional at preview and export resolutions", () => {
    const full = videoFrame(DEFAULT_EDITOR_CONFIG, 1080, 1920, 1920, 1080);
    const preview = videoFrame(DEFAULT_EDITOR_CONFIG, 270, 480, 1920, 1080);
    expect(preview.x * 4).toBeCloseTo(full.x);
    expect(preview.y * 4).toBeCloseTo(full.y);
    expect(preview.w * 4).toBeCloseTo(full.w);
    expect(preview.h * 4).toBeCloseTo(full.h);
  });
  it("rejects invalid dimensions and clamps source rectangles", () => {
    expect(
      fitRect(
        { x: 0, y: 0, w: NaN, h: 4 },
        { x: 0, y: 0, w: 2, h: 2 },
        "contain",
      ).target.w,
    ).toBe(0);
    expect(normalizedRect({ x: 2, y: -1, w: 5, h: Infinity })).toEqual({
      x: 0.99,
      y: 0,
      w: 0.010000000000000009,
      h: 1,
    });
  });
  it("draws two synchronized views with uniform scaling", () => {
    const calls: number[][] = [];
    const ctx = {
      save() {},
      restore() {},
      beginPath() {},
      rect() {},
      clip() {},
      fillRect() {},
      drawImage(_image: unknown, ...args: number[]) {
        calls.push(args);
      },
    } as unknown as CanvasRenderingContext2D;
    drawSplitFrame(
      ctx,
      {} as CanvasImageSource,
      1920,
      1080,
      { x: 0, y: 0, w: 1080, h: 1920 },
      {
        camera: { x: 0, y: 0, w: 0.25, h: 0.25 },
        content: { x: 0, y: 0, w: 1, h: 1 },
        fraction: 0.3,
        contentFit: "contain",
      },
    );
    expect(calls).toHaveLength(2);
    for (const [, , sw, sh, , , dw, dh] of calls)
      expect(sw / sh).toBeCloseTo(dw / dh);
  });
  it("retains fit and split settings in independent format snapshots", () => {
    const split = {
      camera: { x: 0, y: 0, w: 0.2, h: 0.3 },
      content: { x: 0, y: 0, w: 1, h: 1 },
      fraction: 0.3,
      contentFit: "contain" as const,
    };
    const config = {
      ...DEFAULT_EDITOR_CONFIG,
      videoFit: "contain" as const,
      splitLayout: split,
    };
    expect(captureLayout(config, [], [], "Reels").layout.splitLayout).toEqual(
      split,
    );
    expect(formatLayout(config, "square").videoFit).toBe("contain");
  });
});
