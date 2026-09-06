import { describe, it, expect } from "vitest";
import { drawTextLayer, motionEase, resolveZoom, drawVideoWithMotionBlur } from "./canvasDraw";
import type { TextLayer } from "./types";

describe("editor rendering regressions", () => {
  it("uses the selected camera curve in the shared preview/export renderer", () => {
    const frames = [{ time: 0, duration: 0, x: 0, y: 0, scale: 1 }, { time: 1000, duration: 1000, x: 1, y: 1, scale: 2, easing: "linear" }];
    expect(resolveZoom(frames, 250, true, false).scale).toBe(1.25);
    expect(resolveZoom(frames, 250, true, false, "ease-in").scale).toBeCloseTo(1.015625);
    for (const curve of ["linear", "ease-in", "ease-out", "sine", "smoother"]) {
      expect(motionEase(0, curve)).toBe(0);
      expect(motionEase(1, curve)).toBe(1);
      let last = 0;
      for (let i = 0; i <= 100; i++) { const value = motionEase(i / 100, curve); expect(value).toBeGreaterThanOrEqual(last); last = value; }
    }
  });

  it.each(["left", "center", "right"] as const)("moves the text background with %s aligned text", align => {
    const path: number[][] = [], text: number[][] = [];
    const ctx = { save() {}, restore() {}, beginPath() {}, closePath() {}, lineTo() {}, arcTo() {}, fill() {}, rect: (x: number, y: number) => path.push([x,y]), clip() {},
      moveTo: (x: number, y: number) => path.push([x,y]), measureText: (s: string) => ({ width: s.length * 10 }),
      fillText: (_s: string, x: number, y: number) => text.push([x,y]) } as unknown as CanvasRenderingContext2D;
    const layer = { content: "Hello", fontSize: 20, style: "boxed", color: "#fff", align, padding: 10, cornerRadius: 0 } as TextLayer;
    drawTextLayer(ctx, layer, 0, 0, 200, 100);
    const expectedLeft = align === "left" ? 0 : align === "right" ? 130 : 65;
    expect(path[0][0]).toBe(expectedLeft);
    expect(text[0][0]).toBe(align === "left" ? 10 : align === "right" ? 190 : 100);
  });

  it("does not overwrite motion trails with a final opaque frame", () => {
    const alphas: number[] = [];
    const ctx = { globalAlpha: 1, save() {}, restore(this: { globalAlpha: number }) { this.globalAlpha = 1; }, drawImage(this: { globalAlpha: number }) { alphas.push(this.globalAlpha); } } as unknown as CanvasRenderingContext2D;
    const rect = { x: 0, y: 0, w: 100, h: 100 };
    drawVideoWithMotionBlur(ctx, {} as CanvasImageSource, rect, rect, { enabled: true, panAmount: 100, zoomAmount: 100, cursorAmount: 0 }, { x: 10, y: 0, scale: .01 });
    expect(alphas[0]).toBe(1);
    expect(alphas[alphas.length - 1]).toBeLessThan(1);
  });
});
