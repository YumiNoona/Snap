import { describe, it, expect } from "vitest";
import { DEFAULT_EDITOR_CONFIG, type CaptionTrack, type Keyframe } from "./types";
import { DEFAULT_SCREEN_TILT } from "./screenTilt";
import { snapshotClipEffects, resolveClipEffects, replaceAnimationKeys } from "./clipEffects";
import { duplicateClips, combineClips } from "./clipOperations";
import { mapCaptionTracks, splitClip } from "./videoEditing";
import { createProject, migrateProject, projectFingerprint } from "./project";

const config = { ...DEFAULT_EDITOR_CONFIG, trimEnd: 5, screenTilt: { ...DEFAULT_SCREEN_TILT, enabled: true, keys: [{ ...DEFAULT_SCREEN_TILT, time: 1, easing: "linear" as const }] } };
const captions = [{ id: "speech", visible: true, segments: [{ id: "line", startMs: 1000, endMs: 2000, text: "First" }] }] as CaptionTrack[];
const frames: Keyframe[] = [{ time: 1000, duration: 300, scale: 2, x: .5, y: .5, easing: "linear" }];
describe("independent clip effects", () => {
  it("keeps duplicated poses and captions independent through save and reload", () => {
    const original = { id: "one", start: 0, end: 5, effects: snapshotClipEffects(config, frames, captions) };
    const copied = duplicateClips([original], ["one"]);
    copied[1].effects!.captions[0].segments[0].text = "Second";
    copied[1].effects!.keyframes[0].scale = 3;
    expect(copied[0].effects!.captions[0].segments[0].text).toBe("First");
    expect(resolveClipEffects(copied[1], config, frames, captions).keyframes[0].scale).toBe(3);
    const base = createProject("C:\\clip.mp4", "C:\\clip.json");
    const project = { ...base, editor: { ...config, videoClips: copied } };
    const loaded = migrateProject(JSON.parse(JSON.stringify(project)));
    expect(loaded.editor.videoClips).toEqual(copied);
    expect(projectFingerprint(loaded)).not.toBe(projectFingerprint(base));
    expect(mapCaptionTracks(captions, copied).map(track => track.segments[0].text)).toEqual(["First", "Second"]);
    expect(mapCaptionTracks(captions, copied)[1].segments[0].startMs).toBe(6000);
  });
  it("routes tilt changes to the occurrence and respects its track lock", () => {
    const clip = { id: "one", start: 0, end: 5, effects: snapshotClipEffects(config, frames, captions) };
    const state = { ...config, videoClips: [clip] };
    const edited = replaceAnimationKeys(state, "tilt", "tilt", [], "one");
    expect(edited.videoClips![0].effects!.config.screenTilt!.keys).toEqual([]);
    expect(edited.screenTilt!.keys).toHaveLength(1);
    const locked = { ...state, lockedTracks: ["tilt"] };
    expect(replaceAnimationKeys(locked, "tilt", "tilt", [], "one")).toBe(locked);
    expect(resolveClipEffects(edited.videoClips![0], edited, frames, captions).config.screenTilt!.keys).toEqual([]);
  });
  it("does not discard distinct effects when combining adjacent clips", () => {
    const clips = [{ id: "one", start: 0, end: 2 }, { id: "two", start: 2, end: 5, effects: snapshotClipEffects(config, [], []) }];
    const combined = combineClips(clips, ["one", "two"]);
    expect(combined).toHaveLength(2);
    expect(combined[0].groupId).toBe(combined[1].groupId);
    expect(resolveClipEffects(combined[1], config, frames, captions).captions).toEqual([]);
  });
  it("permits single-frame retained clips at high frame rates", () => {
    const clips = splitClip([{ id: "one", start: 0, end: 1 }], 1 / 120, "one", 120);
    expect(clips).toHaveLength(2);
    expect(clips[0].end).toBe(1 / 120);
    expect(splitClip([{ id: "one", start: 0, end: 1 }], 1 / 240, "one", 120)).toHaveLength(1);
  });
});
