import { describe, expect, it } from "vitest";
import { drawCaptionTrack, resolveLayerFade, resolveMagnifierSample, resolveMaskCameraFocus } from "./canvasDraw";
import type { CaptionTrack } from "./types";

describe("caption canvas isolation", () => {
  it("starts a fresh path before filling the caption background", () => {
    const operations: string[] = [];
    const context = {
      globalAlpha: 1,
      save: () => operations.push("save"),
      restore: () => operations.push("restore"),
      measureText: (value: string) => ({ width: value.length * 10 }),
      beginPath: () => operations.push("beginPath"),
      moveTo: () => operations.push("moveTo"),
      lineTo: () => operations.push("lineTo"),
      arcTo: () => operations.push("arcTo"),
      closePath: () => operations.push("closePath"),
      fill: () => operations.push("fill"),
      translate: () => operations.push("translate"),
      scale: () => operations.push("scale"),
      strokeText: () => operations.push("strokeText"),
      fillText: () => operations.push("fillText"),
    } as unknown as CanvasRenderingContext2D;
    const track: CaptionTrack = {
      id: "cc",
      name: "Captions",
      language: "en",
      sourceTrackIds: ["mic"],
      visible: true,
      burnedIn: true,
      style: {
        fontFamily: "Arial", fontSize: 42, fontWeight: 700,
        color: "#fff", backgroundColor: "rgba(0,0,0,.68)",
        outlineColor: "#000", outlineWidth: 0, shadow: false,
        align: "center", x: .5, y: .86, maxWidth: .82, animation: "none",
      },
      segments: [{ id: "line", startMs: 0, endMs: 1_000, text: "Safe caption", language: "en", sourceTrackIds: ["mic"], userEdited: false }],
    };

    drawCaptionTrack(context, track, 500, { x: 0, y: 0, w: 1_920, h: 1_080 });

    expect(operations.indexOf("beginPath")).toBeGreaterThan(-1);
    expect(operations.indexOf("beginPath")).toBeLessThan(operations.indexOf("fill"));
  });

  it("anchors left and right aligned captions to the matching box edge", () => {
    const drawAt = (align: "left" | "right") => {
      const xPositions: number[] = [];
      const context = {
        globalAlpha: 1,
        save: () => undefined,
        restore: () => undefined,
        measureText: (value: string) => ({ width: value.length * 10 }),
        beginPath: () => undefined,
        moveTo: () => undefined,
        lineTo: () => undefined,
        arcTo: () => undefined,
        closePath: () => undefined,
        fill: () => undefined,
        translate: () => undefined,
        scale: () => undefined,
        strokeText: () => undefined,
        fillText: (_value: string, x: number) => xPositions.push(x),
      } as unknown as CanvasRenderingContext2D;
      const track: CaptionTrack = {
        id: "aligned", name: "Captions", language: "en", sourceTrackIds: ["mic"], visible: true, burnedIn: true,
        style: {
          fontFamily: "Segoe UI Variable", fontSize: 42, fontWeight: 700,
          color: "#fff", backgroundColor: "#000", outlineColor: "#000", outlineWidth: 0,
          shadow: false, align, x: .5, y: .86, maxWidth: .82, animation: "none",
        },
        segments: [{ id: "line", startMs: 0, endMs: 1_000, text: "Aligned", language: "en", sourceTrackIds: ["mic"], userEdited: false }],
      };
      drawCaptionTrack(context, track, 500, { x: 0, y: 0, w: 1_920, h: 1_080 });
      return xPositions[0];
    };

    expect(drawAt("left")).toBeLessThan(960);
    expect(drawAt("right")).toBeGreaterThan(960);
  });
});

describe("mask camera transitions", () => {
  const mask = {
    id: "lens", type: "mask" as const, mask: "magnifier" as const,
    start: 2, end: 6, x: .1, y: .2, w: .3, h: .2,
    intensity: 2, focusCamera: true, transitionDuration: .5,
  };

  it("eases in, holds, and returns to the normal camera", () => {
    expect(resolveLayerFade(mask, 2)).toBe(0);
    expect(resolveLayerFade(mask, 2.5)).toBe(1);
    expect(resolveLayerFade(mask, 5.75)).toBeCloseTo(.5, 5);
    expect(resolveLayerFade(mask, 6)).toBe(0);
  });

  it("focuses on the mask center with a useful magnification", () => {
    const focus = resolveMaskCameraFocus([mask], 3);
    expect(focus?.x).toBeCloseTo(.25);
    expect(focus?.y).toBeCloseTo(.3);
    expect(focus?.scale).toBeGreaterThan(1);
    expect(focus?.mix).toBe(1);
  });

  it("samples a smaller centered region for a real magnifier effect", () => {
    const sample = resolveMagnifierSample(
      { x: 0, y: 0, w: 1920, h: 1080 },
      { x: 100, y: 50, w: 960, h: 540 },
      { x: 340, y: 185, w: 240, h: 135 },
      2,
    );
    expect(sample.w).toBeCloseTo(240);
    expect(sample.h).toBeCloseTo(135);
    expect(sample.x + sample.w / 2).toBeCloseTo(720);
    expect(sample.y + sample.h / 2).toBeCloseTo(405);
  });

  it("keeps a magnifier sample inside the source near frame edges", () => {
    const sample = resolveMagnifierSample(
      { x: 20, y: 10, w: 1000, h: 500 },
      { x: 0, y: 0, w: 1000, h: 500 },
      { x: 970, y: 470, w: 100, h: 80 },
      4,
    );
    expect(sample.x).toBeGreaterThanOrEqual(20);
    expect(sample.y).toBeGreaterThanOrEqual(10);
    expect(sample.x + sample.w).toBeLessThanOrEqual(1020);
    expect(sample.y + sample.h).toBeLessThanOrEqual(510);
  });
});
