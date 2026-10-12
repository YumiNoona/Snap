import type { CubeLut, CurvePoint } from "./colorGrade";
const clamp = (n: number) => Math.max(0, Math.min(1, n));
export const IDENTITY_CURVE: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];
export function normalizeCurve(points?: CurvePoint[]): CurvePoint[] {
  const clean = (points ?? IDENTITY_CURVE)
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: clamp(p.x), y: clamp(p.y) }))
    .sort((a, b) => a.x - b.x);
  const unique = clean
    .filter((p, i) => !i || p.x - clean[i - 1].x > 0.0001)
    .slice(0, 32);
  if (!unique.length) return IDENTITY_CURVE;
  if (unique[0].x > 0) unique.unshift({ x: 0, y: 0 });
  if (unique[unique.length - 1].x < 1) unique.push({ x: 1, y: 1 });
  return unique;
}
/** Shape-preserving cubic interpolation avoids ringing and overshoot. */
export function sampleCurve(
  points: CurvePoint[] | undefined,
  x: number,
): number {
  const p = normalizeCurve(points);
  x = clamp(x);
  const slopes = p.slice(1).map((q, i) => (q.y - p[i].y) / (q.x - p[i].x));
  const tangent = (i: number) =>
    i === 0
      ? slopes[0]
      : i === p.length - 1
        ? slopes[slopes.length - 1]
        : slopes[i - 1] * slopes[i] <= 0
          ? 0
          : 2 / (1 / slopes[i - 1] + 1 / slopes[i]);
  let i = 0;
  while (i < p.length - 2 && x > p[i + 1].x) i++;
  const h = p[i + 1].x - p[i].x,
    t = (x - p[i].x) / h;
  return clamp(
    (2 * t ** 3 - 3 * t * t + 1) * p[i].y +
      (t ** 3 - 2 * t * t + t) * h * tangent(i) +
      (-2 * t ** 3 + 3 * t * t) * p[i + 1].y +
      (t ** 3 - t * t) * h * tangent(i + 1),
  );
}
export function parseCube(
  text: string,
  name: string,
  id: string = crypto.randomUUID(),
): CubeLut {
  if (text.length > 32 * 1024 * 1024) throw new Error("LUT exceeds 32 MB");
  let size = 0,
    dimension: 1 | 3 = 3,
    title = name,
    min = [0, 0, 0],
    max = [1, 1, 1];
  const values: number[] = [];
  for (const [i, raw] of text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .entries()) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const tokens = line.split(/\s+/),
      key = tokens[0];
    if (key === "TITLE") {
      title = line.slice(5).trim().replace(/^"|"$/g, "") || name;
      continue;
    }
    if (key === "LUT_1D_SIZE" || key === "LUT_3D_SIZE") {
      if (size)
        throw new Error(
          "Combined shaper/3D LUTs must be exported as a single .cube table",
        );
      dimension = key === "LUT_1D_SIZE" ? 1 : 3;
      size = Number(tokens[1]);
      if (
        !Number.isInteger(size) ||
        size < 2 ||
        size > (dimension === 3 ? 65 : 65536)
      )
        throw new Error("Use a 2–65 point 3D LUT or a 2–65536 point 1D LUT");
      continue;
    }
    if (key === "DOMAIN_MIN" || key === "DOMAIN_MAX") {
      const n = tokens.slice(1).map(Number);
      if (n.length !== 3 || n.some((v) => !Number.isFinite(v)))
        throw new Error(`Invalid domain on line ${i + 1}`);
      if (key === "DOMAIN_MIN") min = n;
      else max = n;
      continue;
    }
    if (key === "LUT_1D_INPUT_RANGE" || key === "LUT_3D_INPUT_RANGE") {
      const lo = Number(tokens[1]),
        hi = Number(tokens[2]);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo)
        throw new Error("Invalid input range");
      min = [lo, lo, lo];
      max = [hi, hi, hi];
      continue;
    }
    const n = tokens.map(Number);
    if (!size || n.length !== 3 || n.some((v) => !Number.isFinite(v)))
      throw new Error(`Invalid LUT entry on line ${i + 1}`);
    values.push(...n);
    if (values.length > (dimension === 3 ? size ** 3 : size) * 3)
      throw new Error("Too many LUT entries");
  }
  if (!size || values.length !== (dimension === 3 ? size ** 3 : size) * 3)
    throw new Error("LUT table is incomplete");
  if (max.some((v, i) => v <= min[i]))
    throw new Error("LUT domain maximum must exceed minimum");
  const bytes = new Uint8Array(new Float32Array(values).buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return {
    id,
    name: title,
    size,
    dimension,
    domainMin: min,
    domainMax: max,
    data: btoa(binary),
  };
}
const decoded = new WeakMap<CubeLut, Float32Array>();
export function lutValues(lut: CubeLut): Float32Array {
  let values = decoded.get(lut);
  if (!values) {
    const bytes = Uint8Array.from(atob(lut.data), (c) => c.charCodeAt(0));
    values = new Float32Array(bytes.buffer);
    decoded.set(lut, values);
  }
  return values;
}
/** Cube files are ordered with red changing fastest. */
export function sampleLut(lut: CubeLut, rgb: number[]): number[] {
  const v = lutValues(lut),
    n = lut.size,
    p = rgb.map(
      (c, i) =>
        clamp((c - lut.domainMin[i]) / (lut.domainMax[i] - lut.domainMin[i])) *
        (n - 1),
    );
  if (lut.dimension === 1)
    return p.map((x, c) => {
      const a = Math.floor(x),
        b = Math.min(n - 1, a + 1);
      return v[a * 3 + c] + (v[b * 3 + c] - v[a * 3 + c]) * (x - a);
    });
  const lo = p.map(Math.floor),
    hi = lo.map((x) => Math.min(n - 1, x + 1)),
    f = p.map((x, i) => x - lo[i]),
    out = [0, 0, 0];
  for (let z = 0; z < 2; z++)
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 2; x++) {
        const index =
          ((z ? hi[2] : lo[2]) * n * n +
            (y ? hi[1] : lo[1]) * n +
            (x ? hi[0] : lo[0])) *
          3;
        const w =
          (x ? f[0] : 1 - f[0]) * (y ? f[1] : 1 - f[1]) * (z ? f[2] : 1 - f[2]);
        for (let c = 0; c < 3; c++) out[c] += v[index + c] * w;
      }
  return out;
}
