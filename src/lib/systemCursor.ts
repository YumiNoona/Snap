import { invoke } from "@tauri-apps/api/core";
import { drawCursor, drawCursorImage } from "./canvasDraw";
import type { CursorStyle } from "./types";

interface NativeSystemCursor {
  width: number;
  height: number;
  hotspotX: number;
  hotspotY: number;
  png: number[];
  invertPng: number[] | null;
}

export interface SystemCursorAsset {
  image: HTMLImageElement;
  imageUrl: string;
  invertImage: HTMLImageElement | null;
  invertUrl: string | null;
  hotspot: { x: number; y: number };
}

let cached: SystemCursorAsset | null = null;
let pending: Promise<SystemCursorAsset | null> | null = null;

function imageUrl(bytes: number[]): string {
  if (!Array.isArray(bytes) || bytes.length < 8 || bytes.length > 4 * 1024 * 1024 ||
      ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) {
    throw new Error("Invalid Windows pointer PNG");
  }
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.slice(offset, offset + 8192));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

async function decodeImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  if (!image.naturalWidth || !image.naturalHeight) throw new Error("Empty Windows pointer PNG");
  return image;
}

/** One editor-only native read/decode shared by the picker, preview and export.
 * Refresh when the editor regains focus; never query Windows from a frame loop. */
export function loadSystemCursor(refresh = false): Promise<SystemCursorAsset | null> {
  if (pending) return pending;
  if (cached && !refresh) return Promise.resolve(cached);
  pending = (async () => {
    try {
      const native = await invoke<NativeSystemCursor>("get_system_cursor");
      if (!native || !Number.isInteger(native.width) || !Number.isInteger(native.height) ||
          native.width < 1 || native.height < 1 || native.width > 512 || native.height > 512 ||
          !Number.isInteger(native.hotspotX) || !Number.isInteger(native.hotspotY) ||
          native.hotspotX < 0 || native.hotspotY < 0 || native.hotspotX >= native.width || native.hotspotY >= native.height) {
        throw new Error("Invalid Windows pointer dimensions");
      }
      const url = imageUrl(native.png);
      const inverseUrl = native.invertPng ? imageUrl(native.invertPng) : null;
      const [image, invertImage] = await Promise.all([decodeImage(url), inverseUrl ? decodeImage(inverseUrl) : null]);
      if (image.naturalWidth !== native.width || image.naturalHeight !== native.height ||
          (invertImage && (invertImage.naturalWidth !== native.width || invertImage.naturalHeight !== native.height))) {
        throw new Error("Windows pointer dimensions do not match its PNG");
      }
      cached = { image, imageUrl: url, invertImage, invertUrl: inverseUrl,
        hotspot: { x: native.hotspotX / native.width * 100, y: native.hotspotY / native.height * 100 } };
    } catch {
      // Older/native-less previews can still show a neutral pointer, never the
      // saved click-effect tint. Retain a last-known real pointer on refresh failure.
    } finally { pending = null; }
    return cached;
  })();
  return pending;
}

/** Both renderers use the exact same pixels, hotspot, sizing and inversion. */
export function drawSystemCursor(ctx: CanvasRenderingContext2D, x: number, y: number, style: CursorStyle, asset: SystemCursorAsset | null) {
  if (!asset) {
    drawCursor(ctx, x, y, { ...style, shape: "arrow", color: "#ffffff", size: style.size / 1.92 });
    return;
  }
  drawCursorImage(ctx, asset.image, x, y, style.size, asset.hotspot);
  if (asset.invertImage) {
    ctx.save();
    ctx.globalCompositeOperation = "difference";
    drawCursorImage(ctx, asset.invertImage, x, y, style.size, asset.hotspot);
    ctx.restore();
  }
}
