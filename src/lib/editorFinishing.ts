import type {
  AudioTrack,
  CaptionTrack,
  CursorEdit,
  EditorConfig,
  InputEvent,
  Keyframe,
  LayoutVariant,
  VideoClip,
} from "./types";
import { clipDuration, clipSpeed } from "./videoEditing";
import { reconcileAudioClips, resolvedAudioClips } from "./audioEditing";
import { splitMediaLayer } from "./mediaTimeline";
import { getCursorAt, type LoadedInputLog } from "./inputLog";

export interface EditRange {
  start: number;
  end: number;
}
export interface CleanupProposal extends EditRange {
  label: string;
  kind: "pause" | "filler" | "repeat" | "silence" | "typing";
}
export function normalizeRanges(ranges: EditRange[], end: number): EditRange[] {
  const result: EditRange[] = [];
  for (const r of ranges
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end))
    .map((r) => ({ start: Math.max(0, r.start), end: Math.min(end, r.end) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start)) {
    const last = result[result.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else result.push({ ...r });
  }
  return result;
}
export function cleanupProposals(
  tracks: CaptionTrack[],
  minPause = 1.2,
): CleanupProposal[] {
  const words = (tracks[0]?.segments.flatMap((s) => s.words ?? []) ?? [])
    .filter(
      (w) =>
        Number.isFinite(w.startMs) &&
        Number.isFinite(w.endMs) &&
        w.endMs > w.startMs,
    )
    .sort((a, b) => a.startMs - b.startMs);
  const result: CleanupProposal[] = [];
  let previousEnd = 0;
  words.forEach((word, index) => {
    if (index && (word.startMs - previousEnd) / 1000 >= minPause)
      result.push({
        start: (previousEnd + 180) / 1000,
        end: (word.startMs - 180) / 1000,
        label: "Transcript gap — listen before removing",
        kind: "pause",
      });
    const normalized = word.text.toLowerCase().replace(/[^a-z]/g, "");
    if (["um", "uh", "erm", "hmm"].includes(normalized))
      result.push({
        start: word.startMs / 1000,
        end: word.endMs / 1000,
        label: `Filler: ${word.text}`,
        kind: "filler",
      });
    if (
      index &&
      normalized &&
      normalized === words[index - 1].text.toLowerCase().replace(/[^a-z]/g, "")
    )
      result.push({
        start: words[index - 1].startMs / 1000,
        end: words[index - 1].endMs / 1000,
        label: `Possible repeated word: ${word.text}`,
        kind: "repeat",
      });
    previousEnd = Math.max(previousEnd, word.endMs);
  });
  const segments = [...(tracks[0]?.segments ?? [])].sort(
    (a, b) => a.startMs - b.startMs,
  );
  for (let i = 1; i < segments.length; i++) {
    const a = segments[i - 1],
      b = segments[i];
    const text = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, "")
        .replace(/\s+/g, " ")
        .trim();
    if (
      text(a.text).split(" ").length >= 3 &&
      text(a.text) === text(b.text) &&
      b.startMs >= a.endMs &&
      b.startMs - a.endMs < 5000
    )
      result.push({
        start: a.startMs / 1000,
        end: a.endMs / 1000,
        label: "Possible repeated take — identical phrase",
        kind: "repeat",
      });
  }
  return result;
}
export function sourceRangesInSequence(
  ranges: EditRange[],
  track: AudioTrack,
  clips: VideoClip[],
  duration: number,
): EditRange[] {
  return resolvedAudioClips(track, clips, duration).flatMap((c) =>
    ranges.flatMap((r) => {
      const start = Math.max(r.start, c.sourceStart),
        end = Math.min(r.end, c.sourceEnd);
      return end > start
        ? [
            {
              start: c.start + (start - c.sourceStart) / c.speed,
              end: c.start + (end - c.sourceStart) / c.speed,
            },
          ]
        : [];
    }),
  );
}
export function typingProposals(
  events: InputEvent[],
  clips: VideoClip[],
): CleanupProposal[] {
  const keys = events
    .filter((e) => e.type === "keydown" && Number.isFinite(e.ts))
    .sort((a, b) => a.ts - b.ts);
  const ranges: EditRange[] = [];
  let start = 0,
    last = 0,
    count = 0;
  const finish = () => {
    if (count >= 10 && last - start >= 3000)
      ranges.push({ start: start / 1000, end: last / 1000 });
  };
  for (const key of keys) {
    if (!count || key.ts - last > 1800) {
      finish();
      start = key.ts;
      count = 0;
    }
    last = key.ts;
    count++;
  }
  finish();
  const dummy: AudioTrack = {
    id: "typing",
    kind: "system",
    label: "",
    path: "",
    linked: true,
    muted: false,
    volume: 1,
  };
  return sourceRangesInSequence(ranges, dummy, clips, Infinity).map((r) => ({
    ...r,
    kind: "typing",
    label: "Long typing burst — consider 2× speed",
  }));
}
/** Split in sequence space, retaining source clock, speed, effects and lineage. */
export function editSequenceRanges(
  clips: VideoClip[],
  ranges: EditRange[],
  speed?: number,
): VideoClip[] {
  if (
    speed !== undefined &&
    (!Number.isFinite(speed) || speed < 0.25 || speed > 4)
  )
    return clips;
  const normalized = normalizeRanges(
    ranges,
    clips.reduce((n, c) => n + clipDuration(c), 0),
  );
  let elapsed = 0;
  const result: VideoClip[] = [];
  for (const clip of clips) {
    const length = clipDuration(clip),
      end = elapsed + length;
    if (!normalized.some((r) => r.start < end && r.end > elapsed)) {
      result.push(clip);
      elapsed = end;
      continue;
    }
    const boundaries = [
      elapsed,
      end,
      ...normalized
        .flatMap((r) => [r.start, r.end])
        .filter((t) => t > elapsed && t < end),
    ].sort((a, b) => a - b);
    for (let i = 0; i < boundaries.length - 1; i++) {
      const a = boundaries[i],
        b = boundaries[i + 1],
        inside = normalized.some(
          (r) => (a + b) / 2 >= r.start && (a + b) / 2 < r.end,
        );
      if (b - a < 1e-6 || (inside && speed === undefined)) continue;
      result.push({
        ...structuredClone(clip),
        id: i === 0 ? clip.id : `clip-${crypto.randomUUID()}`,
        sourceClipId: clip.id,
        start: clip.gap ? 0 : clip.start + (a - elapsed) * clipSpeed(clip),
        end: clip.gap ? b - a : clip.start + (b - elapsed) * clipSpeed(clip),
        speed:
          inside && !clip.gap
            ? Math.max(0.25, Math.min(4, speed!))
            : clip.speed,
        transition: i === 0 ? clip.transition : undefined,
      });
    }
    elapsed = end;
  }
  return result;
}
export function rippleCleanup(
  config: EditorConfig,
  tracks: AudioTrack[],
  clips: VideoClip[],
  ranges: EditRange[],
  duration: number,
  fps: number,
  audioDurations: Record<string, number> = {},
) {
  const cuts = normalizeRanges(
    ranges,
    clips.reduce((n, c) => n + clipDuration(c), 0),
  );
  const next = editSequenceRanges(clips, cuts);
  if (!next.some((c) => !c.gap) || next.length > 1000)
    throw new Error("Keep at least one footage clip; maximum 1000 clips.");
  const shift = (t: number) =>
    t - cuts.reduce((n, r) => n + Math.max(0, Math.min(t, r.end) - r.start), 0);
  const linked = reconcileAudioClips(tracks, clips, next);
  const audio = linked.map((track, index) => {
    const source = tracks[index];
    const resolved = resolvedAudioClips(
      source,
      clips,
      audioDurations[source.id] ?? duration,
    );
    const unlinked = resolved.filter(
      (c) => !(c.linked ?? source.linked ?? true) || !c.videoClipId,
    );
    if (!unlinked.length) return track;
    const pieces = unlinked.flatMap((c) => {
      const bounds = [
        c.start,
        c.end,
        ...cuts
          .flatMap((r) => [r.start, r.end])
          .filter((t) => t > c.start && t < c.end),
      ].sort((a, b) => a - b);
      return bounds.slice(0, -1).flatMap((a, i) => {
        const b = bounds[i + 1];
        if (cuts.some((r) => (a + b) / 2 >= r.start && (a + b) / 2 < r.end))
          return [];
        return [
          {
            ...c,
            id: `audio-${crypto.randomUUID()}`,
            linked: false,
            videoClipId: undefined,
            start: shift(a),
            sourceStart: c.sourceStart + (a - c.start) * c.speed,
            sourceEnd: c.sourceStart + (b - c.start) * c.speed,
            fadeIn: a === c.start ? c.fadeIn : 0,
            fadeOut: b === c.end ? c.fadeOut : 0,
          },
        ];
      });
    });
    return {
      ...track,
      clips: [
        ...(track.clips ?? []).filter(
          (c) => (c.linked ?? track.linked ?? true) && c.videoClipId,
        ),
        ...pieces,
      ],
    };
  });
  const layers = config.layers.flatMap((layer) => {
    if (layer.timeSpace !== "sequence") return [layer];
    let parts = [layer];
    for (const boundary of cuts.flatMap((r) => [r.start, r.end]))
      parts = parts.flatMap((p) => splitMediaLayer(p, boundary, fps));
    return parts
      .filter(
        (p) =>
          !cuts.some(
            (r) =>
              (p.start + p.end) / 2 >= r.start && (p.start + p.end) / 2 < r.end,
          ),
      )
      .map((p) => ({ ...p, start: shift(p.start), end: shift(p.end) }));
  });
  return {
    config: { ...config, videoClips: next, layers },
    audioTracks: audio,
  };
}

export function applyCursorEdits(
  log: LoadedInputLog,
  edits: CursorEdit[] = [],
): LoadedInputLog {
  if (!edits.length) return log;
  const region = log.region;
  const point = (p: { x: number; y: number }) => ({
    x: (region?.x ?? 0) + p.x * (region?.w ?? 1),
    y: (region?.y ?? 0) + p.y * (region?.h ?? 1),
  });
  let moves = log.mouseMoveEvents,
    clicks = log.clickEvents;
  for (const edit of edits) {
    if (
      !Number.isFinite(edit.startMs) ||
      !Number.isFinite(edit.endMs) ||
      edit.endMs < edit.startMs
    )
      continue;
    const inside = (ts: number) => ts >= edit.startMs && ts <= edit.endMs;
    if (edit.mode === "hide" || edit.mode === "remove-clicks")
      clicks = clicks.filter((c) => !inside(c.ts));
    if (edit.mode === "path" && region && edit.points?.length) {
      const points = edit.points
        .filter(
          (p) =>
            Number.isFinite(p.timeMs) &&
            inside(p.timeMs) &&
            Number.isFinite(p.x) &&
            Number.isFinite(p.y) &&
            p.x >= 0 &&
            p.x <= 1 &&
            p.y >= 0 &&
            p.y <= 1,
        )
        .sort((a, b) => a.timeMs - b.timeMs);
      if (points.length < 2) continue;
      const before = getCursorAt(moves, Math.max(0, edit.startMs - 0.01)),
        after = getCursorAt(moves, edit.endMs + 0.01);
      const event = (ts: number, p: { x: number; y: number }) => ({
        ts,
        type: "mousemove",
        ...p,
        key: null,
        button: null,
      });
      moves = [
        ...moves.filter((c) => !inside(c.ts)),
        ...(before ? [event(edit.startMs - 0.01, before)] : []),
        ...points.map((p) => event(p.timeMs, point(p))),
        ...(after ? [event(edit.endMs + 0.01, after)] : []),
      ].sort((a, b) => a.ts - b.ts);
      clicks = clicks.map((c) =>
        inside(c.ts) ? { ...c, ...getCursorAt(moves, c.ts) } : c,
      );
    }
    if (
      edit.mode === "click" &&
      region &&
      edit.points?.[0] &&
      [edit.points[0].x, edit.points[0].y].every(
        (n) => Number.isFinite(n) && n >= 0 && n <= 1,
      )
    ) {
      const click = {
        ts: edit.startMs,
        type: "mousedown",
        ...point(edit.points[0]),
        key: null,
        button: "left",
      };
      clicks = [...clicks, click].sort((a, b) => a.ts - b.ts);
      moves = [...moves.filter((e) => e.ts !== edit.startMs), click].sort(
        (a, b) => a.ts - b.ts,
      );
    }
  }
  return { ...log, mouseMoveEvents: moves, clickEvents: clicks };
}
export function cursorVisible(edits: CursorEdit[] | undefined, ts: number) {
  return !edits?.some(
    (e) => e.mode === "hide" && ts >= e.startMs && ts <= e.endMs,
  );
}

export function captureLayout(
  config: EditorConfig,
  keyframes: Keyframe[],
  captions: CaptionTrack[],
  name: string,
  id: string = crypto.randomUUID(),
): LayoutVariant {
  return structuredClone({
    id,
    name,
    layout: {
      aspectRatio: config.aspectRatio,
      crop: config.crop,
      padding: config.padding,
      cameraOverlay: config.cameraOverlay,
      safeArea: config.safeArea,
    },
    keyframes,
    captions,
    clipEffects: Object.fromEntries(
      (config.videoClips ?? []).map((c) => [c.id, c.effects]),
    ),
  });
}
export type LayoutFormat = "vertical" | "square" | "wide" | "portrait" | "classic" | "ultrawide";
export const LAYOUT_FORMATS: { id: LayoutFormat; name: string; width: number; height: number; description: string }[] = [
  { id: "wide", name: "Landscape", width: 16, height: 9, description: "Videos & tutorials" },
  { id: "vertical", name: "Vertical", width: 9, height: 16, description: "Shorts & stories" },
  { id: "square", name: "Square", width: 1, height: 1, description: "Social posts" },
  { id: "portrait", name: "Portrait", width: 4, height: 5, description: "Portrait posts" },
  { id: "classic", name: "Classic", width: 4, height: 3, description: "Slides & demos" },
  { id: "ultrawide", name: "Ultrawide", width: 21, height: 9, description: "Wide screen captures" },
];
export function formatLayout(
  config: EditorConfig,
  format: LayoutFormat,
) {
  return {
    ...config,
    aspectRatio: { width: LAYOUT_FORMATS.find(f => f.id === format)!.width, height: LAYOUT_FORMATS.find(f => f.id === format)!.height },
    safeArea: format === "vertical" || format === "square" ? format : ("off" as const),
    cameraOverlay: {
      ...config.cameraOverlay,
      x: 0.2,
      y: 0.24,
      width: format === "vertical" ? 0.2 : 0.18,
      animation: undefined,
    },
    videoClips:
      config.videoClips?.map((c) =>
        c.effects
          ? {
              ...c,
              effects: {
                ...c.effects,
                captions: formatCaptionTracks(c.effects.captions, format),
              },
            }
          : c,
      ) ?? null,
  };
}
export function formatCaptionTracks(
  tracks: CaptionTrack[],
  format: LayoutFormat,
): CaptionTrack[] {
  return tracks.map((t) => ({
    ...t,
    style: {
      ...t.style,
      x: 0.5,
      y: format === "vertical" ? 0.69 : 0.8,
      maxWidth: 0.7,
    },
  }));
}
export function reaimZoomsAtClicks(
  frames: Keyframe[],
  log: LoadedInputLog,
  crop: EditorConfig["crop"],
): Keyframe[] {
  if (!log.region || !log.clickEvents.length) return frames;
  const region = log.region,
    base = crop ?? { x: 0, y: 0, w: 1, h: 1 };
  return frames.map((frame) => {
    if (frame.scale <= 1.02) return frame;
    const click = log.clickEvents.reduce((best, c) =>
      Math.abs(c.ts - frame.time) < Math.abs(best.ts - frame.time) ? c : best,
    );
    if (
      click.x === null ||
      click.y === null ||
      Math.abs(click.ts - frame.time) > 3000
    )
      return frame;
    const x = ((click.x - region.x) / region.w - base.x) / base.w,
      y = ((click.y - region.y) / region.h - base.y) / base.h;
    if (![x, y].every(Number.isFinite) || x < 0 || x > 1 || y < 0 || y > 1)
      return frame;
    return { ...frame, x, y };
  });
}
export function layoutExportSize(aspect: EditorConfig["aspectRatio"]): {
  width: number;
  height: number;
} {
  const ratio = aspect ? aspect.width / aspect.height : 16 / 9;
  if (!Number.isFinite(ratio) || ratio <= 0)
    return { width: 1920, height: 1080 };
  let width = ratio >= 1 ? 1080 * ratio : 1080,
    height = ratio >= 1 ? 1080 : 1080 / ratio;
  const factor = Math.min(1, 3840 / Math.max(width, height));
  width *= factor;
  height *= factor;
  return {
    width: Math.max(2, Math.round(width / 2) * 2),
    height: Math.max(2, Math.round(height / 2) * 2),
  };
}
export function loopCursorEdits(
  clips: VideoClip[],
  x: number,
  y: number,
): CursorEdit[] {
  const footage = clips.filter((c) => !c.gap);
  const first = footage[0],
    last = footage[footage.length - 1];
  if (
    !first ||
    !last ||
    ![x, y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)
  )
    return [];
  return [
    {
      startMs: first.start * 1000,
      endMs: Math.min(first.end, first.start + 0.4) * 1000,
    },
    {
      startMs: Math.max(last.start, last.end - 0.4) * 1000,
      endMs: last.end * 1000,
    },
  ].map((range) => ({
    id: crypto.randomUUID(),
    mode: "path",
    ...range,
    points: [
      { timeMs: range.startMs, x, y },
      { timeMs: range.endMs, x, y },
    ],
  }));
}
export type BrandRecipe = {
  id: string;
  name: string;
  appearance: Partial<EditorConfig>;
  captionStyle?: CaptionTrack["style"];
  voicePolish?: AudioTrack["voicePolish"];
};
export function createRecipe(
  name: string,
  config: EditorConfig,
  captions: CaptionTrack[],
  tracks: AudioTrack[],
): BrandRecipe {
  const {
    backgroundColor,
    bgType,
    wallpaperUrl,
    bgBlur,
    padding,
    borderRadius,
    inset,
    insetColor,
    shadow,
    cursorStyle,
    cursorMovement,
    zoomMovement,
    motionBlur,
    audio,
    aspectRatio,
    cameraOverlay,
    exportDefaults,
    colorGrade,
  } = config;
  const { animation: _animation, ...camera } = cameraOverlay;
  void _animation;
  return structuredClone({
    id: crypto.randomUUID(),
    name,
    appearance: {
      backgroundColor,
      bgType,
      wallpaperUrl,
      bgBlur,
      padding,
      borderRadius,
      inset,
      insetColor,
      shadow,
      cursorStyle,
      cursorMovement,
      zoomMovement,
      motionBlur,
      audio,
      aspectRatio,
      cameraOverlay: camera,
      exportDefaults,
      colorGrade,
    },
    captionStyle: captions[0]?.style,
    voicePolish: tracks.find((t) => t.kind === "microphone")?.voicePolish,
  });
}
