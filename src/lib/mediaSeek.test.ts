import { afterEach, expect, it, vi } from "vitest";
import { seekMediaFrame } from "./mediaSeek";

afterEach(() => vi.useRealTimers());

function decoder() {
  const events = new EventTarget();
  let time = 0;
  let decoded: (() => void) | undefined;
  const media = Object.assign(events, {
    duration: 3,
    readyState: 2,
    seeking: false,
    pause: vi.fn(),
    cancelVideoFrameCallback: vi.fn(),
    requestVideoFrameCallback: vi.fn((callback: () => void) => {
      decoded = callback;
      return 7;
    }),
  });
  Object.defineProperty(media, "currentTime", {
    get: () => time,
    set: (value) => {
      time = value;
      media.seeking = true;
    },
  });
  return {
    media: media as unknown as HTMLVideoElement,
    native: media,
    seeked: () => {
      media.seeking = false;
      events.dispatchEvent(new Event("seeked"));
    },
    decoded: () => decoded?.(),
  };
}

it("waits for decoded pixels after seeked, then removes frame callbacks", async () => {
  const video = decoder();
  const done = vi.fn();
  const pending = seekMediaFrame(video.media, 0.716717).then(done);
  video.seeked();
  await Promise.resolve();
  expect(done).not.toHaveBeenCalled();
  video.decoded();
  await pending;
  expect(done).toHaveBeenCalledOnce();
  expect(video.native.cancelVideoFrameCallback).toHaveBeenCalledWith(7);
});

it("cancels a pending frame without waiting for a decoder timeout", async () => {
  const video = decoder();
  const controller = new AbortController();
  const pending = seekMediaFrame(video.media, 1, controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(video.native.cancelVideoFrameCallback).toHaveBeenCalledWith(7);
  video.seeked();
  video.decoded();
});

it("reports stalled decoding and releases its callback", async () => {
  vi.useFakeTimers();
  const video = decoder();
  const pending = seekMediaFrame(video.media, 1);
  const rejection = expect(pending).rejects.toThrow(
    "Video frame seek timed out",
  );
  await vi.advanceTimersByTimeAsync(15_000);
  await rejection;
  expect(video.native.cancelVideoFrameCallback).toHaveBeenCalledWith(7);
});
