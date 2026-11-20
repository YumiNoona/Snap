import { afterEach, expect, it, vi } from "vitest";
import { createExportDecoder } from "./exportDecoder";
import { avcFixture } from "./test/avcFixture";
import appConfig from "../../src-tauri/tauri.conf.json";

vi.mock("./mediaSource", () => ({ mediaSrc: (path: string) => path }));
afterEach(() => vi.unstubAllGlobals());

function installDecoder() {
  const fixture = avcFixture({ count: 12, offsets: [2, 4, 1, 1, 2, 2, 2, 4, 1, 1, 2, 2], edit: 2 });
  const frames: Array<{ timestamp: number; closed: boolean }> = [];
  let live = 0, peak = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => {
    const [, start, requestedEnd] = /bytes=(\d+)-(\d+)/.exec((options.headers as Record<string, string>).Range)!;
    const end = Math.min(Number(requestedEnd), fixture.bytes.length - 1);
    return new Response(fixture.bytes.slice(Number(start), end + 1), { status: 206, headers: { "content-range": `bytes ${start}-${end}/${fixture.bytes.length}` } });
  }));
  vi.stubGlobal("EncodedVideoChunk", class { constructor(public options: EncodedVideoChunkInit) {} });
  const closes = vi.fn();
  const configs = vi.fn();
  vi.stubGlobal("VideoDecoder", class {
    static async isConfigSupported() { return { supported: true }; }
    state = "configured"; decodeQueueSize = 0; ondequeue: (() => void) | null = null;
    private pending: number[] = [];
    constructor(private callbacks: VideoDecoderInit) {}
    configure(config: VideoDecoderConfig) { configs(config); }
    private output(all = false) {
      this.pending.sort((a, b) => a - b);
      while (this.pending.length > (all ? 0 : 2)) {
        const timestamp = this.pending.shift()!;
        live++; peak = Math.max(live, peak);
        const frame = { timestamp, closed: false, close() { if (!this.closed) { this.closed = true; live--; } } };
        frames.push(frame); this.callbacks.output(frame as unknown as VideoFrame);
      }
    }
    decode(chunk: { options: EncodedVideoChunkInit }) {
      this.pending.push(chunk.options.timestamp);
      if (this.pending.length >= 3) this.output();
      queueMicrotask(() => this.ondequeue?.());
    }
    async flush() { this.output(true); }
    close() { closes(); this.state = "closed"; }
  });
  return { frames, closes, configs, peak: () => peak };
}

it("decodes once in presentation order, holds slow-motion frames and restarts for repeated/reordered footage", async () => {
  const state = installDecoder();
  const decoder = await createExportDecoder("video.mp4");
  expect(decoder).not.toBeNull();
  try {
    const timestamps = [];
    for (let i = 0; i < 20; i++) timestamps.push((await decoder!.frameAt(i / 60)).timestamp);
    expect(timestamps).toEqual(Array.from({ length: 20 }, (_, i) => Math.round(Math.floor(i / 2) / 30 * 1e6)));
    expect(state.configs).toHaveBeenCalledTimes(1);
    expect((await decoder!.frameAt(0)).timestamp).toBe(0);
    expect(state.configs).toHaveBeenCalledTimes(2);
    expect((await decoder!.frameAt(.35)).timestamp).toBe(333333);
    expect(state.peak()).toBeLessThanOrEqual(12);
  } finally { decoder!.destroy(); }
  expect(state.frames.every(frame => frame.closed)).toBe(true);
});
it("releases buffered frames and wakes pending work when export is cancelled", async () => {
  const state = installDecoder(), controller = new AbortController();
  const decoder = await createExportDecoder("video.mp4", controller.signal);
  await decoder!.frameAt(0);
  controller.abort();
  await expect(decoder!.frameAt(.1)).rejects.toMatchObject({ name: "AbortError" });
  expect(state.frames.every(frame => frame.closed)).toBe(true);
});
it("keeps media-seek fallback for unsupported layouts and hosts without byte ranges", async () => {
  installDecoder();
  vi.mocked(fetch).mockResolvedValue(new Response("no ranges", { status: 200 }));
  await expect(createExportDecoder("video.mp4")).resolves.toBeNull();
  expect(await createExportDecoder("video.webm")).toBeNull();
});
it("allows source range reads in the packaged editor's content policy", () => {
  const connections = appConfig.app.security.csp.split(";").find(rule => rule.trim().startsWith("connect-src"))!.split(/\s+/);
  expect(connections).toEqual(expect.arrayContaining(["snap-media:", "http://snap-media.localhost", "https://snap-media.localhost"]));
});
