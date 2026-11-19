import { describe, expect, it } from "vitest";
import {
  autoClipProject,
  clipCaptions,
  distinctClips,
  findClipCandidates,
  rankedClips,
  naturalClipBounds,
  type ClipAnalysis,
} from "./autoClips";
import {
  retainedClips,
  sequenceDuration,
  mapCaptionTracks,
} from "./videoEditing";

it("keeps the opening word and a natural sentence ending inside the analysis range", () => {
  const candidate = {id:"one",start:10,end:20,score:60,title:"Moment",reason:"",transcript:""};
  const result = naturalClipBounds({duration:40,width:1920,height:1080,energy:[],motion:[],warnings:[],rangeStart:9.5,rangeEnd:22,transcript:[{startMs:9700,endMs:21200,text:"A complete sentence.",words:[{text:"A",startMs:9700,endMs:10300},{text:"sentence.",startMs:19800,endMs:21200}]}]},candidate);
  expect(result.start).toBeCloseTo(9.58);
  expect(result.end).toBeCloseTo(21.38);
  expect(result.id).toBe(candidate.id);
});

const analysis: ClipAnalysis = {
  duration: 60,
  width: 1920,
  height: 1080,
  energy: Array.from({ length: 60 }, (_, i) =>
    i === 18 || i === 45 ? 0.9 : 0.01,
  ),
  motion: Array.from({ length: 60 }, (_, i) =>
    i === 18 || i === 45 ? 0.8 : 0.001,
  ),
  transcript: [],
  warnings: [],
};

describe("local highlight workflow", () => {
  it("keeps a ten-minute selection within a forty-minute source and offsets activity bins", () => {
    const window = {
      ...analysis,
      duration: 2400,
      rangeStart: 600,
      rangeEnd: 1200,
      energy: Array.from({ length: 600 }, (_, i) => (i === 210 ? 1 : 0.001)),
      motion: Array(600).fill(0),
    };
    const clips = findClipCandidates(window, 10);
    expect(clips[0].start).toBeGreaterThanOrEqual(800);
    clips.forEach((c) => {
      expect(c.start).toBeGreaterThanOrEqual(600);
      expect(c.end).toBeLessThanOrEqual(1200);
    });
  });
  it("estimates missing word timing, intersects cuts, and creates short highlighted phrases", () => {
    const speech = {
      ...analysis,
      transcript: [
        {
          startMs: 10000,
          endMs: 14000,
          text: "one two three four five six seven eight",
        },
      ],
    };
    const clip = {
      id: "cut",
      start: 11,
      end: 13.5,
      score: 50,
      title: "",
      reason: "",
      transcript: "",
    };
    const track = clipCaptions(speech, clip, "9:16", [])[0];
    expect(track.segments.map((s) => s.text).join(" ")).toBe(
      "three four five six seven",
    );
    track.segments.forEach((s) => {
      expect(s.startMs).toBeGreaterThanOrEqual(11000);
      expect(s.endMs).toBeLessThanOrEqual(13500);
      expect(s.words?.length).toBeLessThanOrEqual(3);
    });
    expect(track.style).toMatchObject({
      wordHighlight: true,
      backgroundEnabled: false,
      animation: "none",
    });
  });
  it("saves filled streaming crops and keeps the chosen fit mode in the editable project", () => {
    const clip = {
      id: "cut",
      start: 0,
      end: 10,
      score: 50,
      title: "",
      reason: "",
      transcript: "",
    };
    const crop = { x: 0.2, y: 0.1, w: 0.5, h: 0.8 };
    const project = autoClipProject(
      "source.mp4",
      analysis,
      clip,
      "9:16",
      undefined,
      false,
      [],
      true,
      undefined,
      { fit: "cover", crop },
    );
    expect(project.editor).toMatchObject({ videoFit: "cover", crop });
  });
  it("proposes exact-length, in-bounds candidates around measured activity", () => {
    const candidates = findClipCandidates(analysis, 10);
    expect(candidates.length).toBeGreaterThan(2);
    expect(candidates.some((c) => c.start <= 18 && c.end > 18)).toBe(true);
    candidates.forEach((c) => {
      expect(c.start).toBeGreaterThanOrEqual(0);
      expect(c.end).toBeLessThanOrEqual(60);
      expect(c.end - c.start).toBeCloseTo(10);
    });
  });
  it("chooses two distinct events rather than overlapping versions of one moment", () => {
    const selected = distinctClips(findClipCandidates(analysis, 10), 2);
    expect(selected).toHaveLength(2);
    expect(
      selected[0].end <= selected[1].start ||
        selected[1].end <= selected[0].start,
    ).toBe(true);
  });
  it("does not invent extra clips from a short source or excitement from silence", () => {
    const candidates = findClipCandidates(
      {
        ...analysis,
        duration: 5,
        energy: [0, 0, 0, 0, 0],
        motion: [0, 0, 0, 0, 0],
      },
      10,
    );
    expect(distinctClips(candidates, 2)).toHaveLength(1);
    expect(candidates[0].score).toBe(0);
    expect(candidates[0].reason).toContain("Low activity");
  });
  it("accepts only rankings for real candidates and keeps their source times", () => {
    const candidates = findClipCandidates(analysis, 10);
    const ranked = rankedClips(candidates, [
      { id: candidates[2].id, score: 100, title: "Reaction", reason: "Speech" },
      { id: "invented", score: 100, title: "Fake", reason: "Fake" },
    ]);
    const result = ranked.find((c) => c.id === candidates[2].id)!;
    expect(result.start).toBe(candidates[2].start);
    expect(ranked).toHaveLength(candidates.length);
    expect(ranked.some((c) => c.title === "Fake")).toBe(false);
  });
  it("keeps captions aligned with trimmed source time and mixes embedded audio once", () => {
    const speech = {
      ...analysis,
      transcript: [
        {
          startMs: 10000,
          endMs: 12000,
          text: "Great play",
          words: [
            { text: "Great", startMs: 10000, endMs: 11000 },
            { text: "play", startMs: 11000, endMs: 12000 },
          ],
        },
      ],
    };
    const clip = {
      id: "one",
      start: 10,
      end: 20,
      score: 60,
      title: "Play",
      reason: "Reaction",
      transcript: "Great play",
    };
    const project = autoClipProject(
      "D:\\Videos\\source.mp4",
      speech,
      clip,
      "9:16",
      undefined,
      true,
      [],
      true,
    );
    const ranges = retainedClips(
      project.editor.videoClips,
      project.editor.trimStart,
      project.editor.trimEnd,
    );
    expect(sequenceDuration(ranges)).toBe(10);
    expect(project.audioTracks).toHaveLength(1);
    expect(project.captions[0].segments[0].startMs).toBe(10000);
    const mapped = mapCaptionTracks(project.captions, ranges);
    expect(mapped[0].segments[0].startMs).toBe(0);
    expect(project.exportSettings).toMatchObject({
      width: 1080,
      height: 1920,
      captions: "burned",
    });
  });
  it("clips caption words at the cut and preserves existing microphone/desktop tracks", () => {
    const clip = {
      id: "one",
      start: 11,
      end: 12,
      score: 60,
      title: "Play",
      reason: "Reaction",
      transcript: "",
    };
    const speech = {
      ...analysis,
      transcript: [
        {
          startMs: 10000,
          endMs: 12000,
          text: "Great play",
          words: [
            { text: "Great", startMs: 10000, endMs: 11000 },
            { text: "play", startMs: 11000, endMs: 12000 },
          ],
        },
      ],
    };
    expect(clipCaptions(speech, clip, "4:5", [])[0].segments[0].text).toBe(
      "play",
    );
    const tracks = [
      {
        id: "mic",
        kind: "microphone" as const,
        path: "mic.wav",
        label: "Mic",
        volume: 1,
        muted: false,
      },
    ];
    const project = autoClipProject(
      "source.mp4",
      speech,
      clip,
      "4:5",
      undefined,
      true,
      tracks,
      true,
    );
    expect(project.audioTracks).toHaveLength(1);
    expect(project.audioTracks[0]).toMatchObject(tracks[0]);
    expect(project.audioTracks[0].clips).toBeUndefined();
    expect(project.exportSettings.height).toBe(1350);
  });
});
