import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import AutoClips from "./AutoClips";
import ClipTimeField from "./ClipTimeField";
import AutoClipPreview from "./AutoClipPreview";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => path,
  Channel: class<T> {
    constructor(public onmessage: (value: T) => void) {}
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
const fixture = {
  duration: 40,
  width: 1920,
  height: 1080,
  energy: Array.from({ length: 40 }, (_, i) =>
    i === 8 || i === 28 ? 0.8 : 0.01,
  ),
  motion: Array(40).fill(0.02),
  transcript: [],
  warnings: [],
  facecam: null,
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const label = (node: { children: unknown[] }) =>
  node.children
    .filter((c) => typeof c === "string" || typeof c === "number")
    .join("");
async function next(view: ReturnType<typeof create>) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(35);
  });
  await act(async () => {
    view.root
      .findAllByType("button")
      .find((b) => label(b).includes("Continue"))!
      .props.onClick();
  });
}

it("creates two separately editable projects and preserves the original source", async () => {
  const saved: Array<{ path: string; contents: string }> = [];
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "transcription_environment") return { available: true };
    if (command === "auto_clips_ai_ready") return false;
    if (command === "inspect_auto_clips_source")
      return { ...fixture, hasAudio: true };
    if (command === "transcribe_auto_clip_ranges")
      return [{ startMs: 8000, endMs: 9500, text: "What a moment" }];
    if (command === "analyze_auto_clips") return fixture;
    if (command === "media_has_audio") return true;
    if (command === "write_text_file_atomic") {
      saved.push(args as { path: string; contents: string });
      return;
    }
    if (command === "cancel_auto_clips") return;
    throw Error(`Unexpected command: ${command}`);
  });
  const onOpen = vi.fn(
    async (
      _path: string,
      _video: string,
      _log: string,
      _clips?: unknown[],
    ) => {},
  );
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(
      <AutoClips
        sources={[{ path: "D:\\Videos\\source.mp4", name: "Source" }]}
        onClose={() => {}}
        onOpen={onOpen}
      />,
    );
  });
  await next(view);
  await act(async () => {
    await view.root
      .findAllByType("button")
      .find((b) => label(b).includes("Find clips"))!
      .props.onClick();
  });
  const createButton = view.root
    .findAllByType("button")
    .find((b) => label(b).includes("Create 2 clips"))!;
  expect(createButton.props.disabled).toBe(false);
  expect(view.root.findAllByType("strong").some(n => label(n) === "Ready to analyze")).toBe(false);
  const firstId = view.root.findByType(AutoClipPreview).props.clip.id;
  const crop = {x:.18,y:0,w:.32,h:1};
  await act(async () => { view.root.findByType(AutoClipPreview).props.onRegion("content",crop); });
  const other = view.root.findAllByType("button").find(n=>String(n.props["aria-label"]??"").startsWith("Preview ") && n.props["aria-label"] !== `Preview ${view.root.findByType(AutoClipPreview).props.clip.title}`)!;
  await act(async () => { other.props.onClick(); });
  expect(view.root.findByType(AutoClipPreview).props.content).toEqual({x:0,y:0,w:1,h:1});
  const first = view.root.findAllByType("button").find(n=>String(n.props["aria-label"]??"").startsWith("Preview "))!;
  await act(async () => { first.props.onClick(); });
  expect(view.root.findByType(AutoClipPreview).props.clip.id).toBe(firstId);
  expect(view.root.findByType(AutoClipPreview).props.content).toEqual(crop);
  await act(async () => {
    view.root
      .findAllByType(ClipTimeField)
      .find((i) => i.props.label === "Clip out")!
      .props.onChange(9);
  });
  await act(async () => {
    await createButton.props.onClick();
  });
  expect(saved).toHaveLength(2);
  expect(new Set(saved.map((s) => s.path)).size).toBe(2);
  for (const savedClip of saved) {
    const project = JSON.parse(savedClip.contents);
    expect(project.media.videoPath).toBe("D:\\Videos\\source.mp4");
    expect(
      project.editor.trimEnd - project.editor.trimStart,
    ).toBeGreaterThanOrEqual(9);
    expect(
      project.editor.trimEnd - project.editor.trimStart,
    ).toBeLessThanOrEqual(10);
    expect(project.editor.videoFit).toBe("cover");
    expect(project.audioTracks).toHaveLength(1);
  }
  expect(saved.map(s=>JSON.parse(s.contents).editor.crop)).toContainEqual(crop);
  expect(saved.map(s=>JSON.parse(s.contents).editor.crop)).toContainEqual({x:0,y:0,w:1,h:1});
  expect(onOpen).not.toHaveBeenCalled();
  const speechCalls = vi
    .mocked(invoke)
    .mock.calls.filter(([c]) => c === "transcribe_auto_clip_ranges");
  // Trimming within the already prepared speech keeps captions exact without
  // running Whisper a second time for the same footage.
  expect(speechCalls).toHaveLength(1);
  expect(saved.some(s=>JSON.parse(s.contents).captions.some((t:{segments:Array<{endMs:number}>})=>t.segments.some(segment=>segment.endMs===9000)))).toBe(true);
  await act(async () => {
    await view.root
      .findAllByType("button")
      .find((b) => label(b).includes("Edit first clip"))!
      .props.onClick();
  });
  expect(onOpen.mock.calls[0]).toHaveLength(4);
  expect(onOpen.mock.calls[0][3]).toHaveLength(2);
  await act(async () => view.unmount());
});

it("does not create candidates when a cancelled native job returns late", async () => {
  let finish!: (value: object) => void;
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "transcription_environment") return { available: true };
    if (command === "auto_clips_ai_ready") return false;
    if (command === "inspect_auto_clips_source")
      return { ...fixture, hasAudio: true };
    if (command === "analyze_auto_clips")
      return new Promise((resolve) => {
        finish = resolve;
      });
    if (command === "cancel_auto_clips") return;
    throw Error(command);
  });
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(
      <AutoClips
        sources={[{ path: "D:\\source.mp4", name: "Source" }]}
        onClose={() => {}}
        onOpen={async () => {}}
      />,
    );
  });
  await next(view);
  await act(async () => {
    view.root
      .findAllByType("button")
      .find((b) => label(b).includes("Find clips"))!
      .props.onClick();
  });
  await act(async () => {
    await view.root
      .findAllByType("button")
      .find((b) => label(b) === "Cancel")!
      .props.onClick();
    finish(fixture);
  });
  expect(
    view.root
      .findAllByType("button")
      .find((b) => label(b).startsWith("Create ")),
  ).toBeUndefined();
  expect(
    view.root
      .findAllByType("h3")
      .some((h) => label(h).includes("Suggested moments")),
  ).toBe(false);
  await act(async () => view.unmount());
});

it("starts a forty-minute source with a ten-minute range and sends only that range for analysis", async () => {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "transcription_environment") return { available: true };
    if (command === "auto_clips_ai_ready") return false;
    if (command === "inspect_auto_clips_source")
      return { ...fixture, duration: 2400, hasAudio: true };
    if (command === "analyze_auto_clips")
      return { ...fixture, duration: 2400, rangeStart: 0, rangeEnd: 600 };
    if (command === "transcribe_auto_clip_ranges") return [];
    if (command === "cancel_auto_clips") return;
    throw Error(command);
  });
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(
      <AutoClips
        sources={[{ path: "long.mp4", name: "Long stream" }]}
        onClose={() => {}}
        onOpen={async () => {}}
      />,
    );
    await vi.advanceTimersByTimeAsync(35);
  });
  await next(view);
  await act(async () => {
    await view.root
      .findAllByType("button")
      .find((b) => label(b).includes("Find clips"))!
      .props.onClick();
  });
  expect(
    vi.mocked(invoke).mock.calls.find(([c]) => c === "analyze_auto_clips")?.[1],
  ).toMatchObject({
    request: { rangeStart: 0, rangeEnd: 600, detailed: false },
  });
  const request = vi
    .mocked(invoke)
    .mock.calls.find(([c]) => c === "transcribe_auto_clip_ranges")?.[1] as {
    request: { ranges: { start: number; end: number }[] };
  };
  expect(
    request.request.ranges.reduce((n, r) => n + r.end - r.start, 0),
  ).toBeLessThanOrEqual(60);
  expect(request.request.ranges.every(r=>r.end-r.start<=15)).toBe(true);
  await act(async () => view.unmount());
});
