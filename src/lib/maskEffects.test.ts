import { expect, it, vi } from "vitest";
import { maskDefaults, maskSupportsCameraFocus, maskPose, MASK_EFFECTS } from "./maskEffects";
import { drawMaskLayer, resolveLayerFade, resolveMaskCameraFocus } from "./canvasDraw";
import type { MaskLayer } from "./types";

function layer(mask: MaskLayer["mask"]): MaskLayer {
  return { id: mask, type: "mask", mask, start: 1, end: 4, x: .2, y: .2, w: .4, h: .4, intensity: 1, ...maskDefaults(mask) };
}
it("offers six distinct masks and never auto-focuses privacy masks", () => {
  expect(MASK_EFFECTS).toHaveLength(6);
  for (const mask of ["blur", "pixelate", "redact"] as const) {
    expect(maskSupportsCameraFocus(mask)).toBe(false);
    expect(resolveMaskCameraFocus([{ ...layer(mask), focusCamera: true }], 2)).toBeNull();
  }
  expect(resolveMaskCameraFocus([layer("colorFocus")], 2)).toBeNull();
  expect(resolveMaskCameraFocus([{ ...layer("colorFocus"), focusCamera: true }], 2)).not.toBeNull();
});
it("keeps redaction opaque and covers whole pixels without filtering or fades", () => {
  const mask = { ...layer("redact"), opacity: .1, coverColor: "#12340000", transitionDuration: 2 };
  expect(resolveLayerFade(mask, 1)).toBe(1);
  expect(resolveLayerFade(mask, 4)).toBe(1);
  expect(resolveLayerFade(mask, 4.01)).toBe(0);
  const fillRect = vi.fn();
  const ctx = { save: vi.fn(), restore: vi.fn(), fillRect, globalAlpha: .1, filter: "blur(12px)" } as unknown as CanvasRenderingContext2D;
  drawMaskLayer(ctx, mask, {} as CanvasImageSource, { x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 100, h: 100 }, { x: 10.2, y: 10.7, w: 20.3, h: 20.6 });
  expect(ctx.globalAlpha).toBe(1);
  expect(ctx.filter).toBe("none");
  expect(ctx.fillStyle).toBe("#151515");
  expect(fillRect).toHaveBeenCalledWith(10, 10, 21, 22);
});
it("renders mosaic with nearest-neighbor blocks and color focus with a grayscale surround", () => {
  const contexts: Record<string, unknown>[] = [];
  vi.stubGlobal("document", { createElement: () => {
    const context = { translate: vi.fn(), rotate: vi.fn(), setTransform: vi.fn(), rect: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), arcTo: vi.fn(), closePath: vi.fn(), ellipse: vi.fn(), clip: vi.fn(), fill: vi.fn(), drawImage: vi.fn() };
    contexts.push(context);
    return { width: 0, height: 0, getContext: () => context };
  } });
  const ctx = { canvas: { width: 100, height: 100 }, globalAlpha: 1, save: vi.fn(), restore: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
  const rect = { x: 10, y: 10, w: 20, h: 20 }, frame = { x: 0, y: 0, w: 100, h: 100 };
  try {
    drawMaskLayer(ctx, layer("pixelate"), {} as CanvasImageSource, frame, frame, rect);
    expect(contexts[0].imageSmoothingEnabled).toBe(false);
    expect(contexts[0].drawImage).toHaveBeenCalledTimes(2);
    expect(contexts[1].fill).toHaveBeenCalled();
    drawMaskLayer(ctx, layer("colorFocus"), {} as CanvasImageSource, frame, frame, rect);
    expect(contexts[0].drawImage).toHaveBeenCalledTimes(4);
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);
  } finally { vi.unstubAllGlobals(); }
});
it.each(MASK_EFFECTS.map(effect => effect.value))("keeps %s selection and effect at the same cropped/zoomed source location", mask => {
  const pose = maskPose(layer(mask), 2, { x: 100, y: 50, w: 500, h: 250 }, 1000, 500);
  expect(pose.x).toBeCloseTo(.2); expect(pose.y).toBeCloseTo(.2);
  expect(pose.w).toBeCloseTo(.8); expect(pose.h).toBeCloseTo(.8);
  const tracked = maskPose({ ...layer(mask), w: .1, h: .1, followCursor: true }, 2, { x: 100, y: 50, w: 500, h: 250 }, 1000, 500, { x: 350, y: 175 });
  expect(tracked.x + tracked.w / 2).toBeCloseTo(.5);
  expect(tracked.y + tracked.h / 2).toBeCloseTo(.5);
});
it("supports a hard cut and reaches full visibility even on a short mask", () => {
  const mask = { ...layer("blur"), start: 0, end: .1, transitionDuration: 1, exitTransitionDuration: 1 };
  expect(resolveLayerFade(mask, .05)).toBe(1);
  expect(resolveLayerFade({ ...mask, transitionDuration: 0, exitTransitionDuration: 0 }, 0)).toBe(1);
});
it("camera focus uses the cropped source clock and follows the real cursor only when requested", () => {
  const mask = { ...layer("magnifier"), focusCamera: true, followCursor: true };
  const focus = resolveMaskCameraFocus([mask], 2, { x:.2,y:.1,w:.6,h:.8 }, { x:.5,y:.5 });
  expect(focus?.x).toBeCloseTo(.5); expect(focus?.y).toBeCloseTo(.5);
});
