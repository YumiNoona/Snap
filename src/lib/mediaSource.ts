import { convertFileSrc } from "@tauri-apps/api/core";

/** Editor-only read-ahead; keep native recording and public assets unchanged. */
export function mediaSrc(path: string): string {
  return path.startsWith("/") && !path.startsWith("//") || /^(https?:|asset:|snap-media:|blob:|data:)/i.test(path)
    ? path : convertFileSrc(path, "snap-media");
}
