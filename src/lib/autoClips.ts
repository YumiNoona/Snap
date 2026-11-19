import type { AudioTrack, CaptionTrack, CaptionWord } from "./types";
import { createProject, type SnapProject } from "./project";
import { recordingDataPaths } from "./recordingPaths";
import type { FrameRect, SplitLayout, VideoFit } from "./videoFraming";

export interface ClipTranscript {
  startMs: number;
  endMs: number;
  text: string;
  words?: CaptionWord[];
}
export interface ClipAnalysis {
  rangeStart?: number;
  rangeEnd?: number;
  duration: number;
  width: number;
  height: number;
  energy: number[];
  motion: number[];
  transcript: ClipTranscript[];
  facecam?: FrameRect | null;
  warnings: string[];
}
export interface ClipCandidate {
  id: string;
  start: number;
  end: number;
  score: number;
  title: string;
  reason: string;
  transcript: string;
}
export interface ClipRanking {
  id: string;
  score: number;
  title: string;
  reason: string;
}
export type ClipRatio = "9:16" | "1:1" | "4:5" | "16:9";

const mean = (a: number[]) =>
  a.length ? a.reduce((s, n) => s + n, 0) / a.length : 0;
const valid = (n: number) => (Number.isFinite(n) ? Math.max(0, n) : 0);

/** Deterministic candidate pass. Scores measure activity, not virality. */
export function findClipCandidates(
  analysis: ClipAnalysis,
  requestedLength: number,
  mode: "auto" | "gaming" | "talking" | "reactions" = "auto",
  flexible = false,
): ClipCandidate[] {
  const origin = valid(analysis.rangeStart ?? 0);
  const limit = Math.min(
    valid(analysis.duration),
    analysis.rangeEnd ?? analysis.duration,
  );
  const duration = Math.max(0, limit - origin);
  if (duration < 0.1) return [];
  const length = Math.min(
    duration,
    Math.max(3, Math.min(120, valid(requestedLength) || 10)),
  );
  const energy = analysis.energy.map(valid),
    motion = analysis.motion.map(valid);
  const audioMean = mean(energy),
    motionMean = mean(motion);
  const anchors = new Set<number>([origin, Math.max(origin, limit - length)]);
  const step = Math.max(1, length / 3);
  for (let t = origin; t <= limit - length; t += step) anchors.add(t);
  for (const segment of analysis.transcript)
    if (segment.startMs >= origin * 1000 && segment.endMs <= limit * 1000)
      anchors.add(
        Math.max(
          origin,
          Math.min(limit - length, segment.startMs / 1000 - 0.25),
        ),
      );
  const candidates = [...anchors]
    .sort((a, b) => a - b)
    .map((start, i): ClipCandidate => {
      let end = Math.min(limit, start + length);
      if (flexible) {
        const boundary = analysis.transcript.find(
          (s) => s.endMs / 1000 >= end - 2 && s.endMs / 1000 <= end + 3,
        );
        if (boundary) end = Math.min(limit, boundary.endMs / 1000 + 0.2);
      }
      const audio = energy.slice(
        Math.floor(start - origin),
        Math.ceil(end - origin),
      );
      const visuals = motion.slice(
        Math.floor(start - origin),
        Math.ceil(end - origin),
      );
      const speech = analysis.transcript.filter(
        (s) => s.endMs > start * 1000 && s.startMs < end * 1000,
      );
      const text = speech
        .map((s) => s.text)
        .join(" ")
        .trim();
      const peak = audio.length ? Math.max(...audio) : 0;
      const reaction =
        audioMean > 0.0001 ? Math.min(3, peak / audioMean) / 3 : 0;
      const change =
        motionMean > 0.0001 ? Math.min(3, mean(visuals) / motionMean) / 3 : 0;
      const speechSeconds = speech.reduce(
        (s, p) =>
          s +
          Math.max(
            0,
            Math.min(end, p.endMs / 1000) - Math.max(start, p.startMs / 1000),
          ),
        0,
      );
      const coverage = Math.min(1, speechSeconds / Math.max(0.1, end - start));
      const complete =
        speech.length &&
        speech[0].startMs >= start * 1000 &&
        speech[speech.length - 1].endMs <= end * 1000
          ? 1
          : 0;
      const audioWeight =
        mode === "reactions" ? 0.6 : mode === "talking" ? 0.15 : 0.4;
      const visualWeight = mode === "talking" ? 0.05 : 0.3;
      const score = Math.round(
        100 *
          (audioWeight * reaction +
            visualWeight * change +
            (1 - audioWeight - visualWeight) *
              (coverage * 0.65 + complete * 0.35)),
      );
      const signals = [
        reaction > 0.6 && "Audio reaction",
        change > 0.5 && "screen activity",
        complete > 0 && "complete spoken phrase",
      ].filter(Boolean);
      return {
        id: `moment-${i}`,
        start,
        end,
        score,
        title: text ? text.slice(0, 64) : `Moment at ${formatClipTime(start)}`,
        reason: signals.length
          ? signals.join(" · ")
          : "Low activity — preview before using",
        transcript: text.slice(0, 1400),
      };
    });
  // Retain varied locations; dense speech anchors should not crowd out other events.
  const result: ClipCandidate[] = [];
  for (const candidate of candidates.sort(
    (a, b) => b.score - a.score || a.start - b.start,
  )) {
    if (
      !result.some(
        (other) => Math.abs(other.start - candidate.start) < length * 0.5,
      )
    )
      result.push(candidate);
    if (result.length >= 32) break;
  }
  return result;
}

export function rankedClips(
  candidates: ClipCandidate[],
  rankings: ClipRanking[],
): ClipCandidate[] {
  const byId = new Map(
    rankings
      .filter((r) => Number.isFinite(r.score) && r.score >= 0 && r.score <= 100)
      .map((r) => [r.id, r]),
  );
  return candidates
    .map((c) => {
      const ranking = byId.get(c.id);
      return ranking
        ? {
            ...c,
            score: Math.round(c.score * 0.35 + ranking.score * 0.65),
            title: ranking.title.slice(0, 100),
            reason: ranking.reason.slice(0, 280),
          }
        : c;
    })
    .sort((a, b) => b.score - a.score || a.start - b.start);
}

export function distinctClips(
  candidates: ClipCandidate[],
  count: number,
): ClipCandidate[] {
  const selected: ClipCandidate[] = [];
  for (const candidate of candidates) {
    if (
      selected.some((c) => candidate.start < c.end && candidate.end > c.start)
    )
      continue;
    selected.push(candidate);
    if (selected.length >= Math.max(1, Math.min(10, count))) break;
  }
  return selected;
}

/** Keep continuous footage; move only the edges to pauses or complete phrases. */
export function naturalClipBounds(analysis: ClipAnalysis, clip: ClipCandidate): ClipCandidate {
  const lower = analysis.rangeStart ?? 0, upper = analysis.rangeEnd ?? analysis.duration;
  const phrases = analysis.transcript.filter(s => s.startMs < (clip.end + 3) * 1000 && s.endMs > (clip.start - 2) * 1000);
  const words = phrases.flatMap(s => s.words?.length ? s.words : [{ text: s.text, startMs: s.startMs, endMs: s.endMs }]).sort((a,b) => a.startMs-b.startMs);
  let start = clip.start, end = clip.end;
  // Include a small lead-in rather than beginning on an already spoken syllable.
  const opening = words.find(w => w.startMs / 1000 <= start + .15 && w.endMs / 1000 > start);
  if (opening && opening.startMs / 1000 >= start - 2) start = opening.startMs / 1000 - .12;
  const sentenceEnds = phrases.filter(s => /[.!?…]["'’”]*$/u.test(s.text.trim())).map(s => s.endMs / 1000);
  const pauses = words.flatMap((word,i) => i === words.length-1 || words[i+1].startMs-word.endMs >= 220 ? [word.endMs / 1000] : []);
  const near = (values:number[]) => values.filter(t => t >= clip.end - 1.5 && t <= clip.end + 3).sort((a,b) => Math.abs(a-clip.end)-Math.abs(b-clip.end))[0];
  const boundary = near(sentenceEnds) ?? near(pauses);
  if (boundary !== undefined) end = boundary + .18;
  else {
    const crossing = words.find(w => w.startMs / 1000 < end && w.endMs / 1000 > end);
    if (crossing && crossing.endMs / 1000 <= end + 3) end = crossing.endMs / 1000 + .12;
    else if (!words.length) {
      // The activity scan is one sample per second: favour quiet endpoints.
      const choices = [-1,0,1,2].map(delta => clip.end+delta).filter(t=>t>start+2 && t>=lower && t<=upper);
      choices.sort((a,b)=>(analysis.energy[Math.floor(a-lower)]??Infinity)-(analysis.energy[Math.floor(b-lower)]??Infinity) || Math.abs(a-clip.end)-Math.abs(b-clip.end));
      if (choices.length) end = choices[0];
    }
  }
  start = Math.max(lower, start); end = Math.min(upper, Math.max(start + .1, end), start + 123);
  return { ...clip, start, end };
}
export function formatClipTime(time: number): string {
  return `${Math.floor(time / 60)}:${(time % 60).toFixed(1).padStart(4, "0")}`;
}

export interface ClipCaptionOptions {
  words: number;
  fontSize: number;
  highlight: boolean;
  y?: number;
}
export const DEFAULT_CLIP_CAPTIONS: ClipCaptionOptions = {
  words: 3,
  fontSize: 76,
  highlight: true,
};
export function mergeClipTranscript(
  old: ClipTranscript[],
  added: ClipTranscript[],
): ClipTranscript[] {
  const map = new Map<string, ClipTranscript>();
  for (const s of [...old, ...added])
    map.set(s.startMs + ":" + s.endMs + ":" + s.text, s);
  return [...map.values()].sort((a, b) => a.startMs - b.startMs);
}
export function clipCaptions(
  analysis: ClipAnalysis,
  clip: ClipCandidate,
  ratio: ClipRatio,
  sourceTrackIds: string[],
  options: ClipCaptionOptions = DEFAULT_CLIP_CAPTIONS,
): CaptionTrack[] {
  const from = clip.start * 1000,
    to = clip.end * 1000;
  const words: CaptionWord[] = [];
  for (const segment of analysis.transcript.filter(
    (s) => s.endMs > from && s.startMs < to,
  )) {
    const tokens = segment.text.trim().split(/\s+/u).filter(Boolean);
    const timed = segment.words?.length
      ? segment.words
      : tokens.map((text, i) => ({
          text,
          startMs:
            segment.startMs +
            ((segment.endMs - segment.startMs) * i) / tokens.length,
          endMs:
            segment.startMs +
            ((segment.endMs - segment.startMs) * (i + 1)) / tokens.length,
        }));
    for (const word of timed)
      if (word.endMs > from && word.startMs < to && word.text.trim())
        words.push({
          ...word,
          startMs: Math.round(Math.max(from, word.startMs)),
          endMs: Math.round(Math.min(to, word.endMs)),
        });
  }
  words.sort((a, b) => a.startMs - b.startMs);
  const unique = words.filter(
    (w, i) =>
      !words
        .slice(Math.max(0, i - 8), i)
        .some(
          (p) => p.text === w.text && Math.abs(p.startMs - w.startMs) < 100,
        ),
  );
  const groups: CaptionWord[][] = [];
  for (const word of unique) {
    const group = groups[groups.length - 1];
    if (
      !group ||
      group.length >= Math.max(1, Math.min(5, options.words)) ||
      word.endMs - group[0].startMs > 1800 ||
      word.startMs - group[group.length - 1].endMs > 500 ||
      [...group, word].map((w) => w.text).join(" ").length > 28
    )
      groups.push([word]);
    else group.push(word);
  }
  const segments = groups
    .map((group, i) => ({
      id: "auto-cc-" + i,
      startMs: group[0].startMs,
      endMs: group[group.length - 1].endMs,
      text: group.map((w) => w.text).join(" "),
      words: group,
      language: "auto",
      sourceTrackIds,
      userEdited: false,
    }))
    .filter((s) => s.endMs > s.startMs);
  if (!segments.length) return [];
  return [
    {
      id: "auto-cc",
      name: "Clip captions",
      language: "auto",
      sourceTrackIds,
      visible: true,
      burnedIn: true,
      segments,
      style: {
        fontFamily: "Arial",
        fontSize:
          ratio === "9:16"
            ? options.fontSize
            : Math.round(options.fontSize * 0.75),
        fontWeight: 800,
        color: "#ffffff",
        backgroundColor: "transparent",
        backgroundEnabled: false,
        outlineColor: "#08080a",
        outlineWidth: 4,
        shadow: true,
        shadowBlur: 0.1,
        align: "center",
        x: 0.5,
        y: options.y ?? 0.8,
        maxWidth: 0.9,
        lineHeight: 1.12,
        animation: "none",
        wordHighlight: options.highlight,
        highlightColor: "#b58cff",
      },
    },
  ];
}

export function autoClipProject(
  path: string,
  analysis: ClipAnalysis,
  clip: ClipCandidate,
  ratio: ClipRatio,
  split: SplitLayout | undefined,
  captions: boolean,
  audioTracks: AudioTrack[],
  hasAudio: boolean,
  captionOptions: ClipCaptionOptions = DEFAULT_CLIP_CAPTIONS,
  framing?: { fit: VideoFit; crop?: FrameRect },
): SnapProject {
  const project = createProject(path, recordingDataPaths(path).logPath);
  const [width, height] = ratio.split(":").map(Number);
  project.media = {
    ...project.media,
    durationSeconds: analysis.duration,
    width: analysis.width,
    height: analysis.height,
  };
  project.editor = {
    ...project.editor,
    trimStart: clip.start,
    trimEnd: clip.end,
    playbackRate: 1,
    aspectRatio: { width, height },
    videoFit: framing?.fit ?? "contain",
    crop: framing?.crop ?? null,
    splitLayout: split,
    padding: 0,
    borderRadius: 0,
    bgType: "color",
    backgroundColor: "#0b0d12",
    showCursor: false,
    zoomEnabled: false,
    safeArea: "off",
  };
  project.audioTracks = audioTracks.length
    ? audioTracks.map((track) => ({
        ...track,
        clips: undefined,
        mediaLayerId: undefined,
        start: 0,
        sourceStart: 0,
        sourceEnd: analysis.duration,
        linked: true,
      }))
    : hasAudio
      ? [
          {
            id: "auto-source-audio",
            kind: "imported",
            path,
            sourcePath: path,
            label: "Source audio",
            volume: 1,
            muted: false,
            linked: true,
          },
        ]
      : [];
  // Very short edge ramps avoid clicks while preserving the moment's impact.
  project.audioTracks = project.audioTracks.map(track => ({ ...track, sourceStart: clip.start, sourceEnd: clip.end, fadeIn: .025, fadeOut: .08 }));
  project.captions = captions
    ? clipCaptions(
        analysis,
        clip,
        ratio,
        project.audioTracks.map((t) => t.id),
        {
          ...captionOptions,
          y:
            captionOptions.y ??
            (split ? Math.max(0.12, split.fraction - 0.035) : 0.8),
        },
      )
    : [];
  project.editor.exportDefaults = {
    format: "mp4",
    fps: 30,
    quality: "high",
    captions: project.captions.length ? "burned" : "none",
    audioMode: "mixed",
    normalizeAudio: false,
    deliveryPackage: false,
    loop: false,
    motionInterpolation: "none",
  };
  project.exportSettings = {
    width: width === 9 ? 1080 : width === 16 ? 1920 : 1080,
    height:
      height === 16 ? 1920 : height === 9 ? 1080 : height === 5 ? 1350 : 1080,
    fps: 30,
    format: "mp4",
    quality: "high",
    captions: project.captions.length ? "burned" : "none",
  };
  return project;
}
