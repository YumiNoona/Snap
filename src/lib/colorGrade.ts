export type ColorLook =
  | "original"
  | "fuji"
  | "midnight"
  | "cinema"
  | "warm"
  | "vivid"
  | "matte"
  | "mono";
export interface ColorGrade {
  enabled: boolean;
  look: ColorLook;
  intensity: number;
  exposure: number;
  contrast: number;
  saturation: number;
  warmth: number;
  vignette: number;
  lutId?: string;
  lutStrength?: number;
  curves?: Partial<Record<"master" | "red" | "green" | "blue", CurvePoint[]>>;
}
export interface CurvePoint {
  x: number;
  y: number;
}
export interface CubeLut {
  id: string;
  name: string;
  size: number;
  dimension: 1 | 3;
  domainMin: number[];
  domainMax: number[];
  data: string;
}
export interface AdjustmentLayer {
  id: string;
  name: string;
  start: number;
  end: number;
  enabled: boolean;
  opacity: number;
  mask?: {
    shape: "rectangle" | "ellipse";
    x: number;
    y: number;
    w: number;
    h: number;
    feather: number;
    inverted: boolean;
  };
  grade: ColorGrade;
}
export interface ColorComparison {
  enabled: boolean;
  split: number;
  reverse: boolean;
}
export const DEFAULT_COLOR_GRADE: ColorGrade = {
  enabled: true,
  look: "original",
  intensity: 100,
  exposure: 0,
  contrast: 0,
  saturation: 100,
  warmth: 0,
  vignette: 0,
};
// Original recipes, rather than copied camera LUTs. Tone controls follow the
// look, so exposure/contrast remain useful at every preset intensity.
export const COLOR_LOOKS: Array<{
  id: ColorLook;
  name: string;
  description: string;
  brightness: number;
  contrast: number;
  saturation: number;
  sepia: number;
  hue: number;
  grayscale: number;
}> = [
  {
    id: "original",
    name: "Original",
    description: "Unaltered",
    brightness: 1,
    contrast: 1,
    saturation: 1,
    sepia: 0,
    hue: 0,
    grayscale: 0,
  },
  {
    id: "fuji",
    name: "Fuji inspired",
    description: "Soft film",
    brightness: 1.04,
    contrast: 0.94,
    saturation: 0.92,
    sepia: 0.16,
    hue: -15,
    grayscale: 0,
  },
  {
    id: "midnight",
    name: "Midnight",
    description: "Deep & cool",
    brightness: 0.85,
    contrast: 1.16,
    saturation: 0.8,
    sepia: 0.2,
    hue: 170,
    grayscale: 0,
  },
  {
    id: "cinema",
    name: "Cinema",
    description: "Warm contrast",
    brightness: 1.02,
    contrast: 1.12,
    saturation: 0.88,
    sepia: 0.22,
    hue: -12,
    grayscale: 0,
  },
  {
    id: "warm",
    name: "Golden",
    description: "Warm glow",
    brightness: 1.06,
    contrast: 1.03,
    saturation: 1.04,
    sepia: 0.3,
    hue: -8,
    grayscale: 0,
  },
  {
    id: "vivid",
    name: "Vivid",
    description: "Rich color",
    brightness: 1.02,
    contrast: 1.07,
    saturation: 1.3,
    sepia: 0,
    hue: 0,
    grayscale: 0,
  },
  {
    id: "matte",
    name: "Matte",
    description: "Lifted blacks",
    brightness: 1.14,
    contrast: 0.82,
    saturation: 0.84,
    sepia: 0.1,
    hue: -10,
    grayscale: 0,
  },
  {
    id: "mono",
    name: "Mono",
    description: "Black & white",
    brightness: 1.02,
    contrast: 1.1,
    saturation: 1,
    sepia: 0,
    hue: 0,
    grayscale: 1,
  },
];
const bounded = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
export function normalizeColorGrade(
  value?: Partial<ColorGrade> | null,
): ColorGrade {
  const curves: ColorGrade["curves"] = {};
  for (const c of ["master", "red", "green", "blue"] as const) {
    const points = value?.curves?.[c];
    if (Array.isArray(points))
      curves[c] = points
        .slice(0, 32)
        .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
        .map((p) => ({
          x: Math.max(0, Math.min(1, p.x)),
          y: Math.max(0, Math.min(1, p.y)),
        }));
  }
  return {
    enabled: value?.enabled !== false,
    look: COLOR_LOOKS.some((look) => look.id === value?.look)
      ? value!.look!
      : "original",
    intensity: bounded(value?.intensity, 100, 0, 100),
    exposure: bounded(value?.exposure, 0, -2, 2),
    contrast: bounded(value?.contrast, 0, -50, 50),
    saturation: bounded(value?.saturation, 100, 0, 200),
    warmth: bounded(value?.warmth, 0, -100, 100),
    vignette: bounded(value?.vignette, 0, 0, 100),
    lutId: typeof value?.lutId === "string" ? value.lutId : undefined,
    lutStrength: bounded(value?.lutStrength, 100, 0, 100),
    curves: Object.keys(curves).length ? curves : undefined,
  };
}
export function colorGradeFilter(value?: Partial<ColorGrade> | null): string {
  const grade = normalizeColorGrade(value);
  if (!grade.enabled) return "none";
  const look = COLOR_LOOKS.find((item) => item.id === grade.look)!;
  const strength = grade.intensity / 100;
  const mix = (amount: number) => 1 + (amount - 1) * strength;
  const sepia = look.sepia * strength;
  const parts: string[] = [];
  if (sepia) {
    parts.push(`sepia(${sepia.toFixed(4)})`);
    if (look.hue) parts.push(`hue-rotate(${look.hue}deg)`);
  }
  if (look.grayscale && strength)
    parts.push(`grayscale(${strength.toFixed(4)})`);
  if (grade.warmth) {
    parts.push(`sepia(${(Math.abs(grade.warmth) * 0.003).toFixed(4)})`);
    if (grade.warmth < 0) parts.push("hue-rotate(180deg)");
  }
  const brightness = mix(look.brightness) * Math.pow(2, grade.exposure);
  const contrast = mix(look.contrast) * (1 + grade.contrast / 100);
  const saturation = (mix(look.saturation) * grade.saturation) / 100;
  if (Math.abs(brightness - 1) > 0.00001)
    parts.push(`brightness(${brightness.toFixed(4)})`);
  if (Math.abs(contrast - 1) > 0.00001)
    parts.push(`contrast(${contrast.toFixed(4)})`);
  if (Math.abs(saturation - 1) > 0.00001)
    parts.push(`saturate(${saturation.toFixed(4)})`);
  return parts.join(" ") || "none";
}
export function drawColorVignette(
  ctx: CanvasRenderingContext2D,
  value: ColorGrade | undefined,
  rect: { x: number; y: number; w: number; h: number },
) {
  const grade = normalizeColorGrade(value);
  if (!grade.enabled || !grade.vignette) return;
  ctx.save();
  const radius = Math.hypot(rect.w, rect.h) / 2;
  const gradient = ctx.createRadialGradient(
    rect.x + rect.w / 2,
    rect.y + rect.h / 2,
    radius * 0.25,
    rect.x + rect.w / 2,
    rect.y + rect.h / 2,
    radius,
  );
  gradient.addColorStop(0, "transparent");
  gradient.addColorStop(1, `rgba(0,0,0,${(grade.vignette / 100) * 0.8})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}
