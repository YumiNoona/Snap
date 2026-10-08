import { describe, expect, it } from "vitest";
import { retainedClips, splitClip, sequenceTime, sourceTime, retainedWaveform, sequenceDuration, nextRetainedTime, mapCaptionTracks } from "./videoEditing";
import { createProject, migrateProject } from "./project";
import type { CaptionTrack } from "./types";

describe("non-destructive footage editing", () => {
  it("splits footage, removes the middle segment and joins the retained clock", () => {
    const original = retainedClips(null, 1, 10);
    const split = splitClip(splitClip(original, 3), 7);
    expect(split.map(c => [c.start, c.end])).toEqual([[1, 3], [3, 7], [7, 10]]);
    const edited = split.filter((_, index) => index !== 1);
    expect(sequenceDuration(edited)).toBe(5);
    expect(sequenceTime(edited, 8)).toBe(3);
    expect(nextRetainedTime(edited, 4)).toBe(7);
    expect(sequenceTime(edited, 4)).toBe(2);
    expect(sourceTime(edited, 2)).toBe(7);
    expect(sourceTime(edited, 3)).toBe(8);
    expect(original).toEqual([{ id: "recording", start: 1, end: 10 }]);
  });
  it("removes deleted audio waveform buckets from sequence view", () => {
    expect(retainedWaveform([.1, .1, .7, .7, .3, .3], [{ id: "a", start: 0, end: 1 }, { id: "b", start: 2, end: 3 }], 3))
      .toEqual([.1, .1, .1, .3, .3, .3]);
  });
  it("rejects tiny cuts and clips outside the active trim without resurrecting deleted ranges", () => {
    const clips = retainedClips(null, 0, 10);
    expect(splitClip(clips, .01)).toEqual(clips);
    expect(splitClip(clips, 9.99)).toEqual(clips);
    expect(retainedClips([{ id: "left", start: 0, end: 2 }, { id: "right", start: 5, end: 10 }], 1, 8))
      .toEqual([{ id: "left", start: 1, end: 2 }, { id: "right", start: 5, end: 8 }]);
    expect(retainedClips([], 0, 10)).toEqual([]);
  });
  it("clips subtitles across deleted footage and rebases the later segments", () => {
    const tracks = [{ segments: [{ id: "crossing", startMs: 1000, endMs: 9000, text: "Across" }, { id: "deleted", startMs: 3000, endMs: 4000, text: "Removed" }] }] as CaptionTrack[];
    const result = mapCaptionTracks(tracks, [{ id: "a", start: 0, end: 2 }, { id: "b", start: 7, end: 10 }]);
    expect(result[0].segments.map(s => [s.startMs, s.endMs, s.text])).toEqual([[1000, 2000, "Across"], [2000, 4000, "Across"]]);
    expect(tracks[0].segments).toHaveLength(2);
  });
  it("migrates old projects and round-trips footage edits with a new schema version", () => {
    const project = createProject("demo.mp4", "events.json");
    const old = migrateProject({ ...project, schemaVersion: 1, editor: { ...project.editor, videoClips: undefined } });
    expect(old.schemaVersion).toBe(3);
    expect(old.editor.videoClips).toBeNull();
    const clips = [{ id: "a", start: 0, end: 2 }, { id: "b", start: 4, end: 8 }];
    expect(migrateProject(JSON.parse(JSON.stringify({ ...project, editor: { ...project.editor, videoClips: clips } }))).editor.videoClips).toEqual(clips);
  });
});
