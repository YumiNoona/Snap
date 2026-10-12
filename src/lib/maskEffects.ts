import type { MaskLayer } from "./types";
import { animatedLayer, anchoredLayer } from "./layerAnimation";

export const MASK_EFFECTS = [
  { value: "spotlight", label: "Spotlight" },
  { value: "blur", label: "Blur" },
  { value: "magnifier", label: "Magnifier" },
  { value: "pixelate", label: "Mosaic" },
  { value: "redact", label: "Redaction" },
  { value: "colorFocus", label: "Color focus" },
] as const;

export function maskSupportsCameraFocus(mask: MaskLayer["mask"]) {
  return mask === "spotlight" || mask === "magnifier" || mask === "colorFocus";
}

export function maskDefaults(mask: MaskLayer["mask"]): Partial<MaskLayer> {
  const privacy = mask === "redact";
  return {
    intensity: mask === "blur" ? 12 : mask === "pixelate" ? 16 : mask === "magnifier" ? 2.4 : 1,
    feather: mask === "magnifier" ? 12 : privacy ? 0 : 8,
    shape: ["magnifier", "pixelate", "redact"].includes(mask) ? "rectangle" : "ellipse",
    opacity: 1, focusCamera: false, focusStrength: .82, screenAnchored: true,
    inverted: false, expansion: 0,
    transitionDuration: privacy ? 0 : .55, exitTransitionDuration: privacy ? 0 : .65,
    transitionCurve: "smoother", coverColor: "#151515",
  };
}

/** Resolve tracking in source space BEFORE mapping into the cropped/zoomed view.
 * Rendering, handles and hit testing must use exactly this same pose. */
export function maskPose(layer: MaskLayer, time: number, view: { x: number; y: number; w: number; h: number }, width: number, height: number, cursor?: { x: number; y: number } | null): MaskLayer {
  let pose = animatedLayer(layer, time) as MaskLayer;
  if (pose.followCursor && cursor) {
    pose = { ...pose, screenAnchored: true,
      x: Math.max(0, Math.min(1 - pose.w, cursor.x / width - pose.w / 2)),
      y: Math.max(0, Math.min(1 - pose.h, cursor.y / height - pose.h / 2)) };
  }
  return anchoredLayer(pose, view, width, height) as MaskLayer;
}

export const maskLabel = (mask: MaskLayer["mask"]) => MASK_EFFECTS.find(effect => effect.value === mask)?.label ?? "Mask";
