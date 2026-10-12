import { describe, expect, it } from "vitest";
import {
  applyCursorEdits,
  captureLayout,
  formatLayout,
  LAYOUT_FORMATS,
  cleanupProposals,
  createRecipe,
  cursorVisible,
  editSequenceRanges,
  normalizeRanges,
  rippleCleanup,
  layoutExportSize,
  loopCursorEdits,
  reaimZoomsAtClicks,
} from "./editorFinishing";
import {
  DEFAULT_EDITOR_CONFIG,
  type AudioTrack,
  type CaptionTrack,
} from "./types";
import { clipDuration } from "./videoEditing";
const clips = [
  { id: "a", start: 0, end: 10, speed: 2 },
  { id: "b", start: 20, end: 24 },
];
const track: AudioTrack = {
  id: "music",
  path: "music.wav",
  label: "Music",
  kind: "imported",
  linked: false,
  muted: false,
  volume: 1,
  sourceEnd: 20,
};
describe("finishing edits", () => {
  it("creates all six layouts with valid export sizes without mutating the master", () => {
    const original = structuredClone(DEFAULT_EDITOR_CONFIG);
    for (const format of LAYOUT_FORMATS) {
      const next = formatLayout(original, format.id);
      expect(next.aspectRatio).toEqual({width:format.width,height:format.height});
      const size = layoutExportSize(next.aspectRatio);
      expect(size.width % 2).toBe(0);
      expect(size.height % 2).toBe(0);
      expect(Math.max(size.width,size.height)).toBeLessThanOrEqual(3840);
      expect(next.safeArea).toBe(format.id === "vertical" || format.id === "square" ? format.id : "off");
    }
    expect(original).toEqual(DEFAULT_EDITOR_CONFIG);
  });

  it("sizes landscape, portrait and square exports with even bounded dimensions", () => {
    expect(layoutExportSize({ width: 16, height: 9 })).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(layoutExportSize({ width: 9, height: 16 })).toEqual({
      width: 1080,
      height: 1920,
    });
    expect(layoutExportSize({ width: 1, height: 1 })).toEqual({
      width: 1080,
      height: 1080,
    });
    expect(layoutExportSize({ width: 0, height: 0 })).toEqual({
      width: 1920,
      height: 1080,
    });
    const extreme = layoutExportSize({ width: 100, height: 1 });
    expect(extreme.width).toBe(3840);
    expect(extreme.height % 2).toBe(0);
  });
  it("aligns loop cursor ranges to actual footage, not timeline gaps", () => {
    const repairs = loopCursorEdits(
      [{ id: "gap", start: 0, end: 2, gap: true }, ...clips],
      0.25,
      0.5,
    );
    expect(repairs.map((r) => [r.startMs, r.endMs])).toEqual([
      [0, 400],
      [23600, 24000],
    ]);
    expect(
      repairs.every((r) => r.points?.every((p) => p.x === 0.25 && p.y === 0.5)),
    ).toBe(true);
    expect(loopCursorEdits(clips, NaN, 0.5)).toEqual([]);
  });
  it("merges overlapping ranges and drops invalid input", () =>
    expect(
      normalizeRanges(
        [
          { start: 2, end: 4 },
          { start: 3, end: 6 },
          { start: NaN, end: 2 },
          { start: 9, end: 11 },
        ],
        10,
      ),
    ).toEqual([
      { start: 2, end: 6 },
      { start: 9, end: 10 },
    ]));
  it("cuts sequence ranges at source speed without mutating originals", () => {
    const result = editSequenceRanges(clips, [{ start: 1, end: 3 }]);
    expect(result.map((c) => [c.start, c.end])).toEqual([
      [0, 2],
      [6, 10],
      [20, 24],
    ]);
    expect(result.reduce((n, c) => n + clipDuration(c), 0)).toBe(7);
    expect(clips[0].end).toBe(10);
  });
  it("keeps duplicated-source clip identity", () => {
    const result = editSequenceRanges(
      [
        { id: "a", start: 0, end: 4 },
        { id: "b", start: 0, end: 4 },
      ],
      [{ start: 5, end: 6 }],
    );
    expect(result[0].end).toBe(4);
    expect(result[1].id).toBe("b");
    expect(result[2].sourceClipId).toBe("b");
  });
  it("cuts gaps in sequence space", () =>
    expect(
      editSequenceRanges(
        [{ id: "g", start: 0, end: 4, gap: true }],
        [{ start: 1, end: 3 }],
      ).reduce((n, c) => n + clipDuration(c), 0),
    ).toBe(2));
  it("ripple-cuts and splits unlinked music", () => {
    const result = rippleCleanup(
      { ...DEFAULT_EDITOR_CONFIG },
      [track],
      clips,
      [{ start: 1, end: 3 }],
      20,
      30,
    );
    expect(
      result.audioTracks[0].clips?.map((c) => [
        c.start,
        c.sourceStart,
        c.sourceEnd,
      ]),
    ).toEqual([
      [0, 0, 1],
      [1, 3, 20],
    ]);
    expect(track.clips).toBeUndefined();
  });
  it("reconciles explicitly linked audio across source splits", () => {
    const result = rippleCleanup(
      DEFAULT_EDITOR_CONFIG,
      [
        {
          ...track,
          linked: true,
          clips: [
            {
              id: "s",
              start: 0,
              sourceStart: 0,
              sourceEnd: 10,
              videoClipId: "a",
            },
          ],
        },
      ],
      clips,
      [{ start: 1, end: 3 }],
      30,
      30,
    );
    expect(
      result.audioTracks[0].clips?.map((c) => [c.sourceStart, c.sourceEnd]),
    ).toEqual([
      [0, 2],
      [6, 10],
    ]);
  });
  it("does not allow cleanup to delete all footage", () =>
    expect(() =>
      rippleCleanup(
        DEFAULT_EDITOR_CONFIG,
        [],
        clips,
        [{ start: 0, end: 9 }],
        30,
        30,
      ),
    ).toThrow("Keep at least"));
  it("stores snapshots without live references", () => {
    const layout = captureLayout(DEFAULT_EDITOR_CONFIG, [], [], "Master");
    layout.layout.cameraOverlay.x = 0.9;
    expect(DEFAULT_EDITOR_CONFIG.cameraOverlay.x).not.toBe(0.9);
  });
  it("recipes exclude timings, paths and camera animation", () => {
    const recipe = createRecipe(
      "Brand",
      {
        ...DEFAULT_EDITOR_CONFIG,
        trimStart: 3,
        cursorEdits: [],
        cameraOverlay: {
          ...DEFAULT_EDITOR_CONFIG.cameraOverlay,
          animation: [{ time: 1, x: 0.5 }] as never,
        },
      },
      [],
      [],
    );
    expect(recipe.appearance.trimStart).toBeUndefined();
    expect(recipe.appearance.videoClips).toBeUndefined();
    expect(recipe.appearance.cameraOverlay?.animation).toBeUndefined();
  });
  it("suggests fillers and transcript pauses, not arbitrary words", () => {
    const tracks = [
      {
        segments: [
          {
            words: [
              { text: "Hello", startMs: 0, endMs: 300 },
              { text: "um", startMs: 2000, endMs: 2300 },
            ],
          },
        ],
      },
    ] as CaptionTrack[];
    expect(cleanupProposals(tracks).map((r) => r.kind)).toEqual([
      "pause",
      "filler",
    ]);
  });
});
describe("cursor repairs", () => {
  const log = {
    allEvents: [],
    mouseMoveEvents: [
      { ts: 0, type: "mousemove", x: 100, y: 200, key: null, button: null },
      { ts: 2000, type: "mousemove", x: 300, y: 400, key: null, button: null },
    ],
    clickEvents: [
      {
        ts: 1000,
        type: "mousedown",
        x: 200,
        y: 300,
        key: null,
        button: "left",
      },
    ],
    region: { x: 100, y: 200, w: 200, h: 200 },
    source: "desktop",
    platform: "windows",
  };
  it("re-aims nearby zooms inside the crop without moving full-frame keys", () => {
    const frames = [
      { time: 1000, scale: 1, x: 0.1, y: 0.1, duration: 300 },
      { time: 1000, scale: 2, x: 0.1, y: 0.1, duration: 300 },
      { time: 5000, scale: 2, x: 0.1, y: 0.1, duration: 300 },
    ];
    const result = reaimZoomsAtClicks(
      frames.map((f) => ({ ...f, easing: "ease-in-out" as const })),
      log,
      { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
    );
    expect(result[0]).toMatchObject(frames[0]);
    expect(result[1]).toMatchObject({ x: 0.5, y: 0.5 });
    expect(result[2]).toMatchObject(frames[2]);
  });
  it("maps normalized repair points and click anchors to capture region", () => {
    const result = applyCursorEdits(log, [
      {
        id: "r",
        mode: "path",
        startMs: 500,
        endMs: 1500,
        points: [
          { timeMs: 500, x: 0, y: 0 },
          { timeMs: 1500, x: 1, y: 0 },
        ],
      },
    ]);
    expect(result.clickEvents[0].x).toBe(200);
    expect(result.clickEvents[0].y).toBe(200);
    expect(log.clickEvents[0].y).toBe(300);
  });
  it("hides clicks along with cursor and preserves raw samples", () => {
    const edits = [
      { id: "h", mode: "hide" as const, startMs: 900, endMs: 1100 },
    ];
    expect(cursorVisible(edits, 1000)).toBe(false);
    expect(cursorVisible(edits, 1200)).toBe(true);
    expect(applyCursorEdits(log, edits).clickEvents).toEqual([]);
    expect(log.clickEvents).toHaveLength(1);
  });
  it("inserts clicks without touching input sidecar", () => {
    const result = applyCursorEdits(log, [
      {
        id: "c",
        mode: "click",
        startMs: 500,
        endMs: 600,
        points: [{ timeMs: 500, x: 0.25, y: 0.5 }],
      },
    ]);
    expect(result.clickEvents[0]).toMatchObject({ ts: 500, x: 150, y: 300 });
    expect(log.clickEvents).toHaveLength(1);
  });
});
