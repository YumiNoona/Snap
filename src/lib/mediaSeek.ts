/** Decode a precise paused media timestamp before reading pixels. */
export async function seekMediaFrame(
  media: HTMLVideoElement,
  time: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
  media.pause();
  const duration = Number.isFinite(media.duration) ? media.duration : Infinity;
  const target = Math.max(0, Math.min(Math.max(0, duration - 0.00001), time));
  if (
    !media.seeking &&
    media.readyState >= 2 &&
    Math.abs(media.currentTime - target) < 0.000001
  )
    return;
  await new Promise<void>((resolve, reject) => {
    let requested = false;
    let decoded = typeof media.requestVideoFrameCallback !== "function";
    let frameCallback: number | undefined;
    const cleanup = () => {
      clearTimeout(timer);
      if (frameCallback !== undefined)
        media.cancelVideoFrameCallback?.(frameCallback);
      for (const event of ["seeked", "loadeddata", "loadedmetadata"])
        media.removeEventListener(event, ready);
      media.removeEventListener("error", failed);
      signal?.removeEventListener("abort", aborted);
    };
    const ready = () => {
      if (!requested) {
        requested = true;
        try {
          media.currentTime = target;
        } catch (error) {
          cleanup();
          reject(error);
        }
        return;
      }
      if (media.seeking || media.readyState < 2 || !decoded) return;
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error("Could not decode video for export"));
    };
    const aborted = () => {
      cleanup();
      reject(new DOMException("Export cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Video frame seek timed out"));
    }, 15_000);
    for (const event of ["seeked", "loadeddata", "loadedmetadata"])
      media.addEventListener(event, ready);
    media.addEventListener("error", failed);
    signal?.addEventListener("abort", aborted, { once: true });
    if (!decoded)
      frameCallback = media.requestVideoFrameCallback(() => {
        decoded = true;
        ready();
      });
    if (signal?.aborted) aborted();
    else ready();
  });
}
