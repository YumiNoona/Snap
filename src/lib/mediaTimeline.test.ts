import { describe, it, expect } from "vitest";
import {
  projectMediaLayers,
  splitMediaLayer,
  mediaLayerName,
  resolveMediaAudioTracks,
} from "./mediaTimeline";
import { animatedLayer } from "./layerAnimation";
import { createProject, migrateProject } from "./project";
import type { AudioTrack, VideoLayer } from "./types";
const layer: VideoLayer = {
  id: "overlay",
  type: "video",
  path: "C:\\media\\intro.mp4",
  start: 3,
  end: 8,
  timeSpace: "sequence",
  sourceOffset: 2,
  sourceDuration: 12,
  x: 0.25,
  y: 0.2,
  w: 0.5,
  h: 0.5,
};
describe("independent media timeline", () => {
  it("uses sequence time across repeated, reordered, sped footage and gaps", () => {
    for (const source of [0, 2, 40, 100]) {
      const projected = projectMediaLayers([layer], source, 4)[0];
      expect(source - projected.start).toBe(1);
      expect(source >= projected.start && source < projected.end).toBe(true);
      const inactive = projectMediaLayers([layer], source, 9)[0];
      expect(source >= inactive.start && source < inactive.end).toBe(false);
    }
    expect(layer.start).toBe(3);
  });
  it("preserves the source clock for existing annotations", () => {
    const legacy = { ...layer, timeSpace: undefined };
    expect(projectMediaLayers([legacy], 40, 4)[0]).toBe(legacy);
  });
  it("splits frame accurately and keeps source offsets and animation continuous", () => {
    const animated = {
      ...layer,
      animation: [
        {
          time: 0,
          x: 0,
          y: 0,
          scale: 1,
          opacity: 1,
          rotation: 0,
          easing: "linear" as const,
        },
        {
          time: 5,
          x: 1,
          y: 0,
          scale: 1,
          opacity: 1,
          rotation: 0,
          easing: "linear" as const,
        },
      ],
    };
    const [left, right] = splitMediaLayer(animated, 5.01, 30) as VideoLayer[];
    expect(left.end).toBe(5);
    expect(right.start).toBe(5);
    expect(right.sourceOffset).toBe(4);
    expect(animatedLayer(right, 5).x).toBeCloseTo(animatedLayer(animated, 5).x);
    expect(right.id).not.toBe(layer.id);
    expect(splitMediaLayer(layer, layer.start, 30)).toEqual([layer]);
  });
  it("retains independent placement and offsets through project save and reload", () => {
    const project = createProject("source.mp4", "source.json");
    project.editor.layers = [layer];
    expect(
      migrateProject(JSON.parse(JSON.stringify(project))).editor.layers,
    ).toEqual([layer]);
    expect(mediaLayerName(layer)).toBe("intro.mp4");
  });
  it("keeps imported video sound aligned when moving, splitting or speeding its layer", () => {
    const fast = { ...layer, start: 6, end: 10, sourceSpeed: 2 };
    const track: AudioTrack = {
      id: "sound",
      kind: "imported",
      label: "Video audio",
      path: "sound.wav",
      volume: 1,
      muted: false,
      mediaLayerId: fast.id,
    };
    const [left, right] = splitMediaLayer(fast, 8, 30) as VideoLayer[];
    expect(right.sourceOffset).toBe(6);
    const resolved = resolveMediaAudioTracks(
      [track, { ...track, id: "right", mediaLayerId: right.id }],
      [left, right],
    );
    expect(
      resolved.map((t) =>
        t.clips?.map((c) => [c.start, c.sourceStart, c.sourceEnd, c.speed]),
      ),
    ).toEqual([[[6, 2, 6, 2]], [[8, 6, 10, 2]]]);
    expect(resolveMediaAudioTracks([track], [])).toEqual([]);
    const independent = { ...track, mediaLayerId: undefined, start: 1 };
    expect(resolveMediaAudioTracks([independent], [])[0]).toBe(independent);
  });
});
