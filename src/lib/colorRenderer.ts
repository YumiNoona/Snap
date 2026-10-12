import {
  colorGradeFilter,
  drawColorVignette,
  normalizeColorGrade,
  type ColorGrade,
  type ColorComparison,
  type CubeLut,
} from "./colorGrade";
import { lutValues, sampleCurve, sampleLut } from "./colorLut";
import type { EditorConfig } from "./types";
export function hasColorEffect(value?: ColorGrade): boolean {
  const g = normalizeColorGrade(value);
  return (
    g.enabled &&
    ((g.look !== "original" && g.intensity > 0) ||
      g.exposure !== 0 ||
      g.contrast !== 0 ||
      g.saturation !== 100 ||
      g.warmth !== 0 ||
      g.vignette > 0 ||
      (!!g.lutId && (g.lutStrength ?? 100) > 0) ||
      Object.values(g.curves ?? {}).some((p) =>
        p?.some((q) => Math.abs(q.x - q.y) > 0.0001),
      ))
  );
}
const vertex = `#version 300 es
in vec2 position; out vec2 uv; void main(){uv=(position+1.)*.5;gl_Position=vec4(position,0,1);}`;
const fragment = `#version 300 es
precision highp float; precision highp sampler3D;
in vec2 uv;out vec4 pixel;uniform sampler2D sourceTex;uniform sampler3D cubeTex;uniform sampler2D curveTex;uniform sampler2D oneTex;
uniform int lutSize;uniform int dimension;uniform float strength;uniform vec3 domainMin;uniform vec3 domainMax;
vec3 table(vec3 p){ivec3 a=ivec3(floor(p)),b=min(a+1,ivec3(lutSize-1));vec3 f=fract(p);
return mix(mix(mix(texelFetch(cubeTex,a,0).rgb,texelFetch(cubeTex,ivec3(b.x,a.y,a.z),0).rgb,f.x),mix(texelFetch(cubeTex,ivec3(a.x,b.y,a.z),0).rgb,texelFetch(cubeTex,ivec3(b.x,b.y,a.z),0).rgb,f.x),f.y),mix(mix(texelFetch(cubeTex,ivec3(a.x,a.y,b.z),0).rgb,texelFetch(cubeTex,ivec3(b.x,a.y,b.z),0).rgb,f.x),mix(texelFetch(cubeTex,ivec3(a.x,b.y,b.z),0).rgb,texelFetch(cubeTex,b,0).rgb,f.x),f.y),f.z);}
float one(float p,int c){int a=int(floor(p)),b=min(a+1,lutSize-1);return mix(texelFetch(oneTex,ivec2(a,0),0)[c],texelFetch(oneTex,ivec2(b,0),0)[c],fract(p));}
float curve(float p,int c){float x=clamp(p,0.,1.)*1023.;int a=int(floor(x)),b=min(a+1,1023);return mix(texelFetch(curveTex,ivec2(a,0),0)[c],texelFetch(curveTex,ivec2(b,0),0)[c],fract(x));}
void main(){vec4 s=texture(sourceTex,vec2(uv.x,1.-uv.y));vec3 c=s.rgb;
if(dimension>0){vec3 p=clamp((c-domainMin)/(domainMax-domainMin),0.,1.)*float(lutSize-1);vec3 l=dimension==3?table(p):vec3(one(p.r,0),one(p.g,1),one(p.b,2));c=mix(c,l,strength);}
c=vec3(curve(c.r,0),curve(c.g,1),curve(c.b,2));pixel=vec4(c,s.a);}`;
function gpu() {
  const canvas = document.createElement("canvas"),
    gl = canvas.getContext("webgl2", {
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
  if (!gl) return null;
  const program = gl.createProgram()!;
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const a = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(a);
  gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  const textures = Array.from({ length: 4 }, () => gl.createTexture()!);
  const bind = (i: number, target: number) => {
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(target, textures[i]);
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  const u = (name: string) => gl.getUniformLocation(program, name);
  ["sourceTex", "cubeTex", "curveTex", "oneTex"].forEach((n, i) =>
    gl.uniform1i(u(n), i),
  );
  // All samplers need complete textures even when bypassed.
  bind(1, gl.TEXTURE_3D);
  gl.texImage3D(
    gl.TEXTURE_3D,
    0,
    gl.RGB32F,
    2,
    2,
    2,
    0,
    gl.RGB,
    gl.FLOAT,
    new Float32Array(24),
  );
  bind(3, gl.TEXTURE_2D);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGB32F,
    2,
    1,
    0,
    gl.RGB,
    gl.FLOAT,
    new Float32Array(6),
  );
  let lastLut: CubeLut | undefined,
    lastCurves = "";
  return {
    canvas,
    render: (source: HTMLCanvasElement, grade: ColorGrade, lut?: CubeLut) => {
      if (gl.isContextLost()) throw new Error("Color GPU context was lost");
      if (
        lut?.dimension === 1 &&
        lut.size > gl.getParameter(gl.MAX_TEXTURE_SIZE)
      )
        throw new Error("LUT requires the CPU renderer");
      if (canvas.width !== source.width || canvas.height !== source.height) {
        canvas.width = source.width;
        canvas.height = source.height;
        gl.viewport(0, 0, canvas.width, canvas.height);
      }
      bind(0, gl.TEXTURE_2D);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source,
      );
      if (lut && lut !== lastLut) {
        if (lut.dimension === 3) {
          bind(1, gl.TEXTURE_3D);
          gl.texImage3D(
            gl.TEXTURE_3D,
            0,
            gl.RGB32F,
            lut.size,
            lut.size,
            lut.size,
            0,
            gl.RGB,
            gl.FLOAT,
            lutValues(lut),
          );
        } else {
          bind(3, gl.TEXTURE_2D);
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGB32F,
            lut.size,
            1,
            0,
            gl.RGB,
            gl.FLOAT,
            lutValues(lut),
          );
        }
        lastLut = lut;
      }
      const curveKey = JSON.stringify(grade.curves ?? {});
      if (curveKey !== lastCurves) {
        const data = new Float32Array(1024 * 3);
        for (let x = 0; x < 1024; x++)
          for (let c = 0; c < 3; c++)
            data[x * 3 + c] = sampleCurve(
              grade.curves?.[["red", "green", "blue"][c] as "red"],
              sampleCurve(grade.curves?.master, x / 1023),
            );
        bind(2, gl.TEXTURE_2D);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGB32F,
          1024,
          1,
          0,
          gl.RGB,
          gl.FLOAT,
          data,
        );
        lastCurves = curveKey;
      }
      gl.uniform1i(u("dimension"), lut?.dimension ?? 0);
      gl.uniform1i(u("lutSize"), lut?.size ?? 2);
      gl.uniform1f(u("strength"), (grade.lutStrength ?? 100) / 100);
      gl.uniform3fv(u("domainMin"), lut?.domainMin ?? [0, 0, 0]);
      gl.uniform3fv(u("domainMax"), lut?.domainMax ?? [1, 1, 1]);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      return canvas;
    },
    dispose: () => {
      textures.forEach((t) => gl.deleteTexture(t));
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
interface Resource {
  base: HTMLCanvasElement;
  work: HTMLCanvasElement;
  mask: HTMLCanvasElement;
  masked: HTMLCanvasElement;
  gpu: ReturnType<typeof gpu>;
}
const cache = new WeakMap<object, Resource>();
export function releaseColorRenderer(owner: object) {
  const r = cache.get(owner);
  r?.gpu?.dispose();
  cache.delete(owner);
}
function advanced(
  source: HTMLCanvasElement,
  g: ColorGrade,
  lut: CubeLut | undefined,
  r: Resource,
): CanvasImageSource {
  try {
    if (r.gpu) return r.gpu.render(source, g, lut);
  } catch {
    r.gpu?.dispose();
    r.gpu = null;
  }
  const ctx = source.getContext("2d")!,
    image = ctx.getImageData(0, 0, source.width, source.height),
    data = image.data;
  const curves = ["red", "green", "blue"].map((channel) =>
    Array.from({ length: 256 }, (_, i) =>
      sampleCurve(
        g.curves?.[channel as "red"],
        sampleCurve(g.curves?.master, i / 255),
      ),
    ),
  );
  for (let i = 0; i < data.length; i += 4) {
    const rgb = [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255],
      l = lut ? sampleLut(lut, rgb) : rgb;
    for (let c = 0; c < 3; c++) {
      const v = rgb[c] + ((l[c] - rgb[c]) * (g.lutStrength ?? 100)) / 100;
      data[i + c] =
        curves[c][Math.round(Math.max(0, Math.min(1, v)) * 255)] * 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return source;
}
/** Grades only source imagery. Cursor, text, captions and UI remain ungraded. */
export function gradedSource(
  owner: object,
  source: CanvasImageSource,
  width: number,
  height: number,
  config: EditorConfig,
  sequence: number,
  comparison?: ColorComparison,
): CanvasImageSource {
  const layers = (config.adjustmentLayers ?? []).filter(
    (l) =>
      l.enabled && sequence >= l.start && sequence < l.end && l.opacity > 0,
  );
  if (
    !hasColorEffect(config.colorGrade) &&
    !layers.some((l) => hasColorEffect(l.grade))
  )
    return source;
  let r = cache.get(owner);
  if (!r) {
    r = {
      base: document.createElement("canvas"),
      work: document.createElement("canvas"),
      mask: document.createElement("canvas"),
      masked: document.createElement("canvas"),
      gpu: gpu(),
    };
    cache.set(owner, r);
  }
  for (const c of [r.base, r.work, r.mask, r.masked])
    if (c.width !== width || c.height !== height) {
      c.width = width;
      c.height = height;
    }
  const base = r.base.getContext("2d")!,
    work = r.work.getContext("2d")!;
  base.clearRect(0, 0, width, height);
  base.drawImage(source, 0, 0, width, height);
  for (const { grade, opacity, mask } of [
    { grade: config.colorGrade, opacity: 1, mask: undefined },
    ...layers.map((l) => ({
      grade: l.grade,
      opacity: l.opacity,
      mask: l.mask,
    })),
  ]) {
    const g = normalizeColorGrade(grade);
    if (!hasColorEffect(g)) continue;
    work.clearRect(0, 0, width, height);
    work.filter = colorGradeFilter(g);
    work.drawImage(r.base, 0, 0);
    work.filter = "none";
    drawColorVignette(work, g, { x: 0, y: 0, w: width, h: height });
    const lut = config.colorLuts?.find((l) => l.id === g.lutId),
      result = lut || g.curves ? advanced(r.work, g, lut, r) : r.work;
    let composed = result;
    if (mask) {
      const alpha = r.mask.getContext("2d")!,
        masked = r.masked.getContext("2d")!;
      alpha.clearRect(0, 0, width, height);
      alpha.save();
      alpha.fillStyle = "white";
      if (mask.inverted) {
        alpha.fillRect(0, 0, width, height);
        alpha.globalCompositeOperation = "destination-out";
      }
      alpha.filter = `blur(${Math.max(0, Math.min(0.2, mask.feather)) * Math.min(width, height)}px)`;
      alpha.beginPath();
      const x = Math.max(0, Math.min(1, mask.x)) * width,
        y = Math.max(0, Math.min(1, mask.y)) * height;
      const w = Math.max(0.001, Math.min(1, mask.w)) * width,
        h = Math.max(0.001, Math.min(1, mask.h)) * height;
      if (mask.shape === "ellipse")
        alpha.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      else alpha.rect(x, y, w, h);
      alpha.fill();
      alpha.restore();
      masked.clearRect(0, 0, width, height);
      masked.drawImage(result, 0, 0);
      masked.globalCompositeOperation = "destination-in";
      masked.drawImage(r.mask, 0, 0);
      masked.globalCompositeOperation = "source-over";
      composed = r.masked;
    }
    base.globalAlpha = Math.max(0, Math.min(1, opacity));
    base.drawImage(composed, 0, 0);
    base.globalAlpha = 1;
  }
  if (comparison?.enabled) {
    const x = Math.max(0, Math.min(1, comparison.split)) * width;
    base.save();
    base.beginPath();
    base.rect(
      comparison.reverse ? x : 0,
      0,
      comparison.reverse ? width - x : x,
      height,
    );
    base.clip();
    base.drawImage(source, 0, 0, width, height);
    base.restore();
    base.fillStyle = "#fff";
    base.fillRect(x - 1, 0, 2, height);
  }
  return r.base;
}
