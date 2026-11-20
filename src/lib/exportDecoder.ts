import { mediaSrc } from "./mediaSource";
import { mp4BoxHeader, parseMp4Track, type Mp4Track } from "./mp4Demuxer";

const READ_BYTES = 2 * 1024 * 1024;

/** Bounded range reads skip mdat while opening; large recordings stay on disk. */
class RangeReader {
  size = Infinity;
  private start = -1;
  private bytes = new Uint8Array(0);
  constructor(private url: string, private signal: AbortSignal) {}
  async read(offset: number, length: number): Promise<Uint8Array> {
    if (offset < this.start || offset + length > this.start + this.bytes.length) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      this.signal.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(abort, 15_000);
      try {
        if (this.signal.aborted) controller.abort();
        const end = Math.min(this.size - 1, offset + Math.max(length, READ_BYTES) - 1);
        const response = await fetch(this.url, { headers: { Range: `bytes=${offset}-${end}` }, signal: controller.signal });
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
        if (response.status !== 206 || !range || Number(range[1]) !== offset) {
          void response.body?.cancel();
          throw new Error("Source does not support bounded range reads");
        }
        this.size = Number(range[3]);
        if (!Number.isSafeInteger(this.size) || Number(range[2]) - offset + 1 > Math.max(length, READ_BYTES)) throw new Error("Invalid media range");
        this.bytes = new Uint8Array(await response.arrayBuffer());
        this.start = offset;
      } finally { clearTimeout(timeout); this.signal.removeEventListener("abort", abort); }
    }
    const start = offset - this.start;
    if (start < 0 || start + length > this.bytes.length) throw new Error("Truncated video source");
    return this.bytes.subarray(start, start + length);
  }
}

/** Sequential hardware decoding, independent of playback and display refresh. */
export class ExportDecoder {
  private decoder: VideoDecoder | null = null;
  private generation = 0;
  private queue: VideoFrame[] = [];
  private held: VideoFrame | null = null;
  private next: VideoFrame | null = null;
  private lastTime = -Infinity;
  private eof = false;
  private error: unknown = null;
  private waiters = new Set<() => void>();
  private disposed = false;
  constructor(private reader: RangeReader, private track: Mp4Track, private controller: AbortController, private unlink: () => void) {}
  private notify = () => { for (const wake of [...this.waiters]) wake(); };
  private async changed(timeout = 0): Promise<void> {
    if (this.disposed) throw new DOMException("Export cancelled", "AbortError");
    await new Promise<void>((resolve, reject) => {
      const wake = () => { clearTimeout(timer); this.waiters.delete(wake); resolve(); };
      const timer = timeout ? setTimeout(() => { this.waiters.delete(wake); reject(new Error("Export decoder stopped responding")); }, timeout) : undefined;
      this.waiters.add(wake);
    });
  }
  private clearFrames() {
    for (const frame of this.queue) frame.close();
    this.queue = []; this.held?.close(); this.next?.close(); this.held = this.next = null;
  }
  private restart(time: number) {
    const generation = ++this.generation;
    this.notify();
    if (this.decoder?.state !== "closed") this.decoder?.close();
    this.clearFrames(); this.eof = false; this.error = null;
    let index = 0;
    for (let i = 0; i < this.track.samples.length; i++) {
      const sample = this.track.samples[i];
      if (sample.key && sample.timestamp <= time) index = i;
    }
    const decoder = new VideoDecoder({
      output: frame => {
        if (generation !== this.generation || this.disposed) frame.close();
        else { this.queue.push(frame); this.notify(); }
      },
      error: error => { if (generation === this.generation) { this.error = error; this.notify(); } },
    });
    this.decoder = decoder;
    decoder.ondequeue = this.notify;
    decoder.configure(this.track.config);
    void (async () => {
      try {
        while (index < this.track.samples.length && generation === this.generation && !this.disposed) {
          if (this.error) throw this.error;
          if (this.queue.length >= 3 || decoder.decodeQueueSize >= 4) { await this.changed(); continue; }
          const sample = this.track.samples[index++];
          const data = await this.reader.read(sample.offset, sample.size);
          if (generation !== this.generation || this.disposed) return;
          decoder.decode(new EncodedVideoChunk({ type: sample.key ? "key" : "delta", timestamp: sample.timestamp, duration: sample.duration, data }));
        }
        if (generation !== this.generation || this.disposed) return;
        await decoder.flush(); this.eof = true; this.notify();
      } catch (error) { if (generation === this.generation && !this.disposed) { this.error = error; this.notify(); } }
    })();
  }
  async frameAt(seconds: number): Promise<VideoFrame> {
    if (this.disposed) throw new DOMException("Export cancelled", "AbortError");
    const time = Math.round(seconds * 1_000_000);
    if (!this.decoder || time < this.lastTime || time - this.lastTime > 1_000_000) this.restart(time);
    this.lastTime = time;
    for (;;) {
      if (this.disposed) throw new DOMException("Export cancelled", "AbortError");
      if (this.error) throw this.error;
      if (this.next) {
        if (this.next.timestamp > time) return this.held ?? this.next;
        this.held?.close(); this.held = this.next; this.next = null;
      }
      while (!this.queue.length && !this.eof && !this.error && !this.disposed) await this.changed(15_000);
      if (this.error) throw this.error;
      if (this.disposed) throw new DOMException("Export cancelled", "AbortError");
      this.next = this.queue.shift() ?? null;
      this.notify();
      if (!this.next && this.eof) {
        if (!this.held) throw new Error("No video frame decoded");
        return this.held;
      }
    }
  }
  destroy = () => {
    if (this.disposed) return;
    this.disposed = true; this.generation++; this.controller.abort(); this.unlink(); this.notify();
    if (this.decoder?.state !== "closed") this.decoder?.close();
    this.clearFrames();
  };
}

export async function createExportDecoder(path: string, signal?: AbortSignal): Promise<ExportDecoder | null> {
  if (typeof VideoDecoder === "undefined" || typeof EncodedVideoChunk === "undefined" || !/\.(mp4|mov|m4v)(?:[?#]|$)/i.test(path)) return null;
  const controller = new AbortController();
  let decoder: ExportDecoder | null = null;
  const abort = () => { controller.abort(); decoder?.destroy(); };
  const unlink = () => signal?.removeEventListener("abort", abort);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
    const reader = new RangeReader(mediaSrc(path), controller.signal);
    for (let offset = 0, boxes = 0; offset + 16 <= reader.size && boxes < 10_000; boxes++) {
      const header = mp4BoxHeader(await reader.read(offset, 16));
      const size = header.size || reader.size - offset;
      if (size < 8 || offset + size > reader.size) break;
      if (header.type === "moov") {
        if (size > 64 * 1024 * 1024) break;
        const track = parseMp4Track(await reader.read(offset, size), reader.size);
        const preferred = { ...track.config, hardwareAcceleration: "prefer-hardware" as const };
        if ((await VideoDecoder.isConfigSupported(preferred)).supported) track.config = preferred;
        else if (!(await VideoDecoder.isConfigSupported(track.config)).supported) break;
        decoder = new ExportDecoder(reader, track, controller, unlink);
        return decoder;
      }
      offset += size;
    }
  } catch (error) { if (signal?.aborted) { unlink(); controller.abort(); throw error; } }
  unlink(); controller.abort();
  return null;
}
