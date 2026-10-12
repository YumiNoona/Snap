import { describe, it, expect } from "vitest";
import {
  DEFAULT_EDITOR_CONFIG,
  type AudioTrack,
  type Layer,
  type NestedSequence,
} from "./types";
import {
  compileSequence,
  nestSelection,
  insertSequence,
  unnestClip,
  validateSequences,
  canInsertSequence,
} from "./nestedSequences";
import { sequenceDuration, sequenceClip } from "./videoEditing";
import { resolvedAudioClips } from "./audioEditing";
import { createProject, migrateProject } from "./project";
import { parseCube } from "./colorLut";
const config = () => ({
  ...structuredClone(DEFAULT_EDITOR_CONFIG),
  trimStart: 0,
  trimEnd: 10,
  videoClips: [
    { id: "a", start: 1, end: 3 },
    { id: "b", start: 5, end: 8 },
  ],
});
const audio: AudioTrack = {
  id: "sound",
  kind: "system",
  path: "sound.wav",
  label: "Desktop",
  volume: 1,
  muted: false,
};
describe("Nested sequences", () => {
  it("keeps native audio linked outside a nest and applies a nested scene's audio mix", () => {
    const n = nestSelection(config(), [], [], [audio], ["b"], 10, "Scene");
    expect(n.audioTracks[0].clips?.[0].videoClipId).toBe("a");
    expect(n.audioTracks[0].clips?.[0].linked).toBe(true);
    n.config.nestedSequences![0].editor.audio.systemVolume = 50;
    const compiled = compileSequence(n.config, [], [], n.audioTracks, 10);
    expect(
      compiled.audioTracks.find((t) => t.id.includes("/sound"))?.volume,
    ).toBe(0.5);
  });
  it("splits imported picture and associated sound around an inserted sequence", () => {
    const n = nestSelection(config(), [], [], [], ["b"], 10, "Scene");
    n.config.layers = [
      {
        id: "video",
        type: "video",
        path: "overlay.mp4",
        timeSpace: "sequence",
        start: 0,
        end: 2,
        sourceOffset: 3,
        sourceSpeed: 2,
        x: 0,
        y: 0,
        w: 1,
        h: 1,
      },
    ];
    const track = {
      ...audio,
      id: "media",
      kind: "imported" as const,
      mediaLayerId: "video",
    };
    const inserted = insertSequence(n.config, [track], n.id, 1, 10),
      c = compileSequence(inserted.config, [], [], inserted.audioTracks, 10);
    expect(inserted.config.layers.map((l) => [l.start, l.end])).toEqual([
      [0, 1],
      [4, 5],
    ]);
    expect(
      c.audioTracks
        .filter((t) => t.mediaLayerId)
        .map((t) =>
          t.clips?.map((s) => [s.start, s.sourceStart, s.sourceEnd, s.speed]),
        ),
    ).toEqual([[[0, 3, 5, 2]], [[4, 5, 7, 2]]]);
  });
  it("preserves source ranges, timeline length and audio when nesting and unnesting", () => {
    const c = config(),
      before = resolvedAudioClips(audio, c.videoClips, 10),
      nested = nestSelection(c, [], [], [audio], ["a", "b"], 10, "Scene"),
      compiled = compileSequence(nested.config, [], [], nested.audioTracks, 10);
    expect(sequenceDuration(compiled.clips)).toBe(5);
    expect(compiled.clips.map((c) => [c.start, c.end])).toEqual([
      [1, 3],
      [5, 8],
    ]);
    const after = compiled.audioTracks.flatMap((t) =>
      resolvedAudioClips(t, compiled.clips, 10),
    );
    expect(
      after.map((s) => [s.sourceStart, s.sourceEnd, s.start, s.end]),
    ).toEqual(before.map((s) => [s.sourceStart, s.sourceEnd, s.start, s.end]));
    expect(() => JSON.stringify(compiled.config)).not.toThrow();
    const unnest = unnestClip(
      nested.config,
      [],
      [],
      nested.audioTracks,
      nested.config.videoClips![0].id,
      10,
    );
    expect(unnest.config.videoClips?.every((c) => !c.sequenceId)).toBe(true);
  });
  it("trims nested instances and compounds speed without losing source offsets", () => {
    const nested = nestSelection(
      config(),
      [],
      [],
      [audio],
      ["a", "b"],
      10,
      "Scene",
    );
    nested.config.videoClips![0] = {
      ...nested.config.videoClips![0],
      start: 1,
      end: 4,
      speed: 2,
    };
    const result = compileSequence(
      nested.config,
      [],
      [],
      nested.audioTracks,
      10,
    );
    expect(sequenceDuration(result.clips)).toBeCloseTo(1.5);
    expect(result.clips.map((c) => [c.start, c.end])).toEqual([
      [2, 3],
      [5, 7],
    ]);
    expect(sequenceClip(result.clips, 0.75)?.source).toBeCloseTo(5.5);
    const segments = result.audioTracks.flatMap((t) =>
      resolvedAudioClips(t, result.clips, 10),
    );
    expect(
      segments.map((s) => [
        s.sourceStart,
        s.sourceEnd,
        s.start,
        s.end,
        s.speed,
      ]),
    ).toEqual([
      [2, 3, 0, 0.5, 2],
      [5, 7, 0.5, 1.5, 2],
    ]);
  });
  it("reuses definitions and propagates edits to both instances", () => {
    const n = nestSelection(config(), [], [], [], ["a", "b"], 10, "Scene"),
      inserted = insertSequence(n.config, [], n.id, 5, 10);
    inserted.config.nestedSequences![0].editor.videoClips![0].start = 2;
    const c = compileSequence(inserted.config, [], [], [], 10);
    expect(c.clips.filter((s) => !s.gap).map((s) => s.start)).toEqual([
      2, 5, 2, 5,
    ]);
    expect(c.clips.filter((s) => s.gap)).toHaveLength(2);
  });
  it("moves sequence media into a definition, clips it and scales video/animation timing", () => {
    const c = config(),
      layer: Layer = {
        id: "overlay",
        type: "video",
        path: "v.mp4",
        sourceOffset: 2,
        timeSpace: "sequence",
        start: 1,
        end: 4,
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        animation: [
          {
            time: 0,
            x: 0,
            y: 0,
            scale: 1,
            opacity: 1,
            rotation: 0,
            easing: "linear",
          },
        ],
      };
    c.layers = [layer];
    const n = nestSelection(c, [], [], [], ["a", "b"], 10, "Scene");
    n.config.videoClips![0].speed = 2;
    const result = compileSequence(n.config, [], [], [], 10),
      layers = result.clips[0].effects?.config.layers ?? [];
    expect(layers[0].start).toBe(0.5);
    expect(layers[0].end).toBe(1);
    expect(layers[0].type === "video" && layers[0].sourceOffset).toBe(2);
    expect(layers[0].type === "video" && layers[0].sourceSpeed).toBe(2);
  });
  it("honors a definition's playback speed and pads shortened instances", () => {
    const n = nestSelection(config(), [], [], [], ["a", "b"], 10, "Scene");
    n.config.nestedSequences![0].editor.playbackRate = 2;
    const r = compileSequence(n.config, [], [], [], 10);
    expect(sequenceDuration(r.clips)).toBe(5);
    expect(r.clips[0].renderSpeed).toBe(2);
    expect(r.clips[r.clips.length - 1].gap).toBe(true);
  });
  it("prevents self and indirect loops", () => {
    const a: NestedSequence = {
        id: "a",
        name: "A",
        editor: config(),
        keyframes: [],
        captions: [],
        audioTracks: [],
      },
      b = {
        ...a,
        id: "b",
        editor: {
          ...config(),
          videoClips: [{ id: "ab", sequenceId: "a", start: 0, end: 1 }],
        },
      };
    expect(canInsertSequence([a, b], "b", "a")).toBe(false);
    a.editor.videoClips = [{ id: "self", sequenceId: "a", start: 0, end: 1 }];
    expect(() => validateSequences([a])).toThrow(/itself/);
  });
  it("round trips reusable sequences, embedded LUTs and custom easing through project files", () => {
    const c = config(),
      lut = parseCube("LUT_1D_SIZE 2\n0 0 0\n1 1 1", "Identity");
    c.colorLuts = [lut];
    c.colorGrade = {
      enabled: true,
      look: "original",
      intensity: 100,
      exposure: 0,
      contrast: 0,
      saturation: 100,
      warmth: 0,
      vignette: 0,
      lutId: lut.id,
    };
    const keys = [
      {
        time: 1000,
        x: 0.5,
        y: 0.5,
        scale: 1.5,
        easing: "custom" as const,
        duration: 500,
        bezier: [0.2, 0.1, 0.8, 1] as [number, number, number, number],
      },
    ];
    const nested = nestSelection(c, keys, [], [audio], ["a", "b"], 10, "Scene"),
      project = createProject("v.mp4", "v.json");
    project.editor = nested.config;
    project.audioTracks = nested.audioTracks;
    project.keyframes = keys;
    const restored = migrateProject(JSON.parse(JSON.stringify(project)));
    expect(restored.editor.colorLuts).toEqual([lut]);
    expect(restored.editor.nestedSequences?.[0].keyframes).toEqual(keys);
    expect(
      compileSequence(
        restored.editor,
        restored.keyframes,
        [],
        restored.audioTracks,
        10,
      ).clips.map((c) => [c.start, c.end]),
    ).toEqual([
      [1, 3],
      [5, 8],
    ]);
  });
  it("inserts at the playhead and ripples media/audio without stretching sound", () => {
    const c = config();
    c.layers = [
      {
        id: "image",
        type: "image",
        path: "image.png",
        timeSpace: "sequence",
        start: 3,
        end: 4,
        x: 0,
        y: 0,
        w: 1,
        h: 1,
      },
    ];
    const n = nestSelection(c, [], [], [audio], ["b"], 10, "Scene"),
      insert = insertSequence(n.config, n.audioTracks, n.id, 1, 10);
    expect(sequenceDuration(insert.config.videoClips!)).toBe(8);
    expect(insert.config.videoClips?.[1].sequenceId).toBe(n.id);
  });
});
