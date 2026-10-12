import type {
  AudioTrack,
  CaptionTrack,
  EditorConfig,
  Keyframe,
  Layer,
  NestedSequence,
  VideoClip,
} from "./types";
import {
  clipDuration,
  clipSpeed,
  retainedClips,
  sequenceDuration,
  sequenceTime,
} from "./videoEditing";
import { resolvedAudioClips } from "./audioEditing";
import { resolveClipEffects } from "./clipEffects";
import { resolveMediaAudioTracks } from "./mediaTimeline";
export function validateSequences(definitions: NestedSequence[]) {
  const ids = new Set<string>();
  for (const d of definitions) {
    if (ids.has(d.id)) throw new Error("Duplicate sequence identifier");
    ids.add(d.id);
  }
  const visit = (id: string, chain: string[]) => {
    if (chain.includes(id)) throw new Error("A sequence cannot contain itself");
    if (chain.length > 12) throw new Error("Sequences are nested too deeply");
    const d = definitions.find((s) => s.id === id);
    if (!d) throw new Error("A nested sequence is missing");
    for (const c of d.editor.videoClips ?? [])
      if (c.sequenceId) visit(c.sequenceId, [...chain, id]);
  };
  definitions.forEach((d) => visit(d.id, []));
}
export function canInsertSequence(
  definitions: NestedSequence[],
  id: string,
  into?: string,
) {
  if (!into) return true;
  try {
    const changed = definitions.map((d) =>
      d.id === into
        ? {
            ...d,
            editor: {
              ...d.editor,
              videoClips: [
                ...(d.editor.videoClips ?? []),
                { id: "test", sequenceId: id, start: 0, end: 1 },
              ],
            },
          }
        : d,
    );
    validateSequences(changed);
    return true;
  } catch {
    return false;
  }
}
function sliceLayer(
  layer: Layer,
  from: number,
  to: number,
  offset: number,
  speed = 1,
  prefix = "",
): Layer | null {
  const start = Math.max(from, layer.start),
    end = Math.min(to, layer.end);
  if (end <= start) return null;
  return {
    ...layer,
    id: prefix + layer.id,
    timeSpace: "sequence",
    start: offset + (start - from) / speed,
    end: offset + (end - from) / speed,
    ...(layer.type === "video"
      ? {
          sourceOffset:
            (layer.sourceOffset ?? 0) +
            (start - layer.start) * (layer.sourceSpeed ?? 1),
          sourceSpeed: (layer.sourceSpeed ?? 1) * speed,
        }
      : {}),
    animation: layer.animation?.map((k) => ({
      ...k,
      time: (k.time - (start - layer.start)) / speed,
    })),
    transition: start > layer.start ? undefined : layer.transition,
    exitTransition: end < layer.end ? undefined : layer.exitTransition,
  };
}
export interface CompiledSequence {
  config: EditorConfig;
  clips: VideoClip[];
  audioTracks: AudioTrack[];
  keyframes: Keyframe[];
  captions: CaptionTrack[];
}
/** Flatten linked instances into the original recording clock for both transport and export. */
export function compileSequence(
  config: EditorConfig,
  keyframes: Keyframe[],
  captions: CaptionTrack[],
  audioTracks: AudioTrack[],
  duration: number,
  definitions = config.nestedSequences ?? [],
  chain: string[] = [],
): CompiledSequence {
  audioTracks = resolveMediaAudioTracks(audioTracks, config.layers);
  const clips = retainedClips(
    config.videoClips,
    config.trimStart,
    config.trimEnd || duration,
  );
  if (!clips.some((c) => c.sequenceId))
    return { config, clips, audioTracks, keyframes, captions };
  if (!chain.length) validateSequences(definitions);
  const output: VideoClip[] = [],
    layers: Layer[] = config.layers.filter((l) => l.timeSpace === "sequence"),
    adjustments: NonNullable<EditorConfig["adjustmentLayers"]> = [],
    nestedAudio: AudioTrack[] = [];
  let elapsed = 0;
  for (const clip of clips) {
    if (!clip.sequenceId) {
      const e = resolveClipEffects(clip, config, keyframes, captions);
      output.push({
        ...clip,
        effects: {
          config: {
            ...e.config,
            layers: [...layers, ...config.layers.filter((l) => !l.timeSpace)],
          },
          keyframes: e.keyframes,
          captions: e.captions,
        },
      });
      elapsed += clipDuration(clip);
      continue;
    }
    const definition = definitions.find((d) => d.id === clip.sequenceId);
    if (!definition) throw new Error("Nested sequence is missing");
    const childConfig = {
      ...definition.editor,
      colorGrade: definition.editor.colorGrade ?? config.colorGrade,
      colorLuts: config.colorLuts,
      nestedSequences: definitions,
    };
    const child = compileSequence(
      childConfig,
      definition.keyframes,
      definition.captions,
      definition.audioTracks,
      duration,
      definitions,
      [...chain, clip.sequenceId],
    );
    const rate = clipSpeed(clip),
      definitionRate = Math.max(
        0.25,
        Math.min(4, childConfig.playbackRate || 1),
      ),
      prefix = `${clip.id}/`;
    let local = 0;
    for (const leaf of child.clips) {
      const length = clipDuration(leaf) / definitionRate,
        from = Math.max(local, clip.start),
        to = Math.min(local + length, clip.end);
      if (to > from) {
        const speed = clipSpeed(leaf) * definitionRate,
          start = leaf.start + (from - local) * speed,
          end = leaf.start + (to - local) * speed,
          e = resolveClipEffects(
            leaf,
            child.config,
            child.keyframes,
            child.captions,
          ),
          position = elapsed + (from - clip.start) / rate;
        const childLayers = e.config.layers.flatMap((l) => {
          if (l.timeSpace === "sequence") {
            const transformed = {
              ...l,
              start: l.start / definitionRate,
              end: l.end / definitionRate,
              animation: l.animation?.map((k) => ({
                ...k,
                time: k.time / definitionRate,
              })),
              ...(l.type === "video"
                ? { sourceSpeed: (l.sourceSpeed ?? 1) * definitionRate }
                : {}),
            };
            const sliced = sliceLayer(
              transformed,
              from,
              to,
              position,
              rate,
              prefix,
            );
            return sliced ? [sliced] : [];
          }
          const sliced = sliceLayer(
            l,
            start,
            end,
            position,
            speed * rate,
            prefix,
          );
          return sliced ? [sliced] : [];
        });
        output.push({
          ...leaf,
          id: prefix + leaf.id,
          sequenceId: undefined,
          parentClipId: clip.id,
          sourceClipId: leaf.id,
          start,
          end,
          renderSpeed: speed * rate,
          transition:
            from > local
              ? undefined
              : output.length === 0
                ? (clip.transition ?? leaf.transition)
                : leaf.transition,
          colorGrade: clip.colorGrade ?? leaf.colorGrade,
          effects: {
            config: {
              ...e.config,
              layers: [
                ...config.layers.filter((l) => l.timeSpace === "sequence"),
                ...childLayers,
              ],
              colorLuts: config.colorLuts,
              adjustmentLayers: adjustments,
            },
            keyframes: clip.effects?.keyframes ?? e.keyframes,
            captions: e.captions,
          },
        });
      }
      local += length;
    }
    // Shortened definitions keep instance out points; fill the remaining interval.
    if (local < clip.end) {
      const remaining = clip.end - Math.max(local, clip.start);
      if (remaining > 0)
        output.push({
          id: prefix + "tail",
          parentClipId: clip.id,
          gap: true,
          start: 0,
          end: remaining / rate,
        });
    }
    for (const a of child.config.adjustmentLayers ?? []) {
      const from = Math.max(a.start / definitionRate, clip.start),
        to = Math.min(a.end / definitionRate, clip.end);
      if (to > from)
        adjustments.push({
          ...a,
          id: prefix + a.id,
          start: elapsed + (from - clip.start) / rate,
          end: elapsed + (to - clip.start) / rate,
        });
    }
    for (const track of child.audioTracks) {
      const segments = resolvedAudioClips(track, child.clips, Infinity).flatMap(
        (s) => {
          const from = Math.max(clip.start, s.start / definitionRate),
            to = Math.min(clip.end, s.end / definitionRate);
          if (to <= from) return [];
          return [
            {
              ...s,
              id: prefix + s.id,
              linked: false,
              videoClipId: undefined,
              start: elapsed + (from - clip.start) / rate,
              sourceStart:
                s.sourceStart +
                (from - s.start / definitionRate) * s.speed * definitionRate,
              sourceEnd:
                s.sourceStart +
                (to - s.start / definitionRate) * s.speed * definitionRate,
              speed: s.speed * definitionRate * rate,
            },
          ];
        },
      );
      if (segments.length)
        nestedAudio.push({
          ...track,
          volume:
            track.volume *
            (track.kind === "system"
              ? childConfig.audio.systemVolume / 100
              : track.kind === "microphone"
                ? childConfig.audio.micVolume / 100
                : 1),
          muted:
            track.muted ||
            (track.kind === "system"
              ? childConfig.audio.systemMuted
              : track.kind === "microphone"
                ? childConfig.audio.micMuted
                : false),
          id: prefix + track.id,
          linked: false,
          mediaLayerId: undefined,
          clips: segments,
        });
    }
    elapsed += clipDuration(clip);
    if (output.length > 1000)
      throw new Error("Nested sequences exceed 1000 footage segments");
  }
  // Layer assets are loaded ahead of time by the export compositor.
  adjustments.push(...(config.adjustmentLayers ?? []));
  const allLayers = new Map<string, Layer>();
  config.layers.forEach((l) => allLayers.set(l.id, l));
  output.forEach((c) =>
    c.effects?.config.layers?.forEach((l) => allLayers.set(l.id, l)),
  );
  const compiledConfig = {
    ...config,
    videoClips: output,
    layers: [...allLayers.values()],
    adjustmentLayers: adjustments,
  };
  for (const c of output)
    if (c.effects)
      c.effects.config = {
        ...c.effects.config,
        videoClips: undefined,
        nestedSequences: undefined,
        playbackRate: config.playbackRate,
        adjustmentLayers: adjustments,
      };
  const rootAudio = audioTracks.map((t) =>
    t.clips
      ? {
          ...t,
          clips: t.clips.flatMap((s) => {
            if (!(s.linked ?? t.linked ?? true) || !s.videoClipId) return [s];
            return output
              .filter((c) => c.id === s.videoClipId)
              .map((c) => ({ ...s, videoClipId: c.id }));
          }),
        }
      : t,
  );
  return {
    config: compiledConfig,
    clips: output,
    audioTracks: [...rootAudio, ...nestedAudio],
    keyframes,
    captions,
  };
}
/** Move selected adjacent footage and the intersecting sequence media/audio into a reusable definition. */
export function nestSelection(
  config: EditorConfig,
  keyframes: Keyframe[],
  captions: CaptionTrack[],
  audioTracks: AudioTrack[],
  ids: string[],
  duration: number,
  name: string,
) {
  audioTracks = resolveMediaAudioTracks(audioTracks, config.layers);
  const clips = retainedClips(
      config.videoClips,
      config.trimStart,
      config.trimEnd || duration,
    ),
    indices = clips.flatMap((c, i) => (ids.includes(c.id) ? [i] : []));
  if (!indices.length || indices.some((v, i) => i && v !== indices[i - 1] + 1))
    throw new Error("Select adjacent clips to nest");
  const selected = indices.map((i) => clips[i]),
    from = sequenceTime(clips, selected[0].start, selected[0].id),
    to = from + sequenceDuration(selected),
    id = crypto.randomUUID();
  const childLayers: Layer[] = config.layers.filter((l) => !l.timeSpace),
    parentLayers: Layer[] = config.layers.filter((l) => !l.timeSpace);
  for (const l of config.layers.filter((l) => l.timeSpace === "sequence")) {
    const inside = sliceLayer(l, from, to, 0);
    if (inside) childLayers.push(inside);
    const left = sliceLayer(l, 0, from, 0),
      right = sliceLayer(l, to, Infinity, to, 1, "after-");
    if (left) parentLayers.push(left);
    if (right) parentLayers.push(right);
  }
  const childAudio: AudioTrack[] = [],
    parentAudio: AudioTrack[] = [];
  for (const track of audioTracks) {
    if (track.mediaLayerId) {
      for (const layer of childLayers.filter(
        (l) => l.id === track.mediaLayerId && l.type === "video",
      ))
        childAudio.push({ ...track, mediaLayerId: layer.id });
      for (const layer of parentLayers.filter(
        (l) =>
          (l.id === track.mediaLayerId ||
            l.id === `after-${track.mediaLayerId}`) &&
          l.type === "video",
      ))
        parentAudio.push({
          ...track,
          id: layer.id === track.mediaLayerId ? track.id : `after-${track.id}`,
          mediaLayerId: layer.id,
        });
      continue;
    }
    const segments = resolvedAudioClips(track, clips, Infinity),
      inside = segments.flatMap((s) => {
        const a = Math.max(from, s.start),
          b = Math.min(to, s.end);
        return b > a
          ? [
              {
                ...s,
                id: "nested-" + s.id,
                linked: false,
                videoClipId: undefined,
                start: a - from,
                sourceStart: s.sourceStart + (a - s.start) * s.speed,
                sourceEnd: s.sourceStart + (b - s.start) * s.speed,
              },
            ]
          : [];
      }),
      outside = segments.flatMap((s) =>
        [
          [s.start, Math.min(from, s.end)],
          [Math.max(to, s.start), s.end],
        ].flatMap(([a, b], i) =>
          b > a
            ? [
                {
                  ...s,
                  id: `outside-${i}-${s.id}`,
                  linked:
                    !!s.videoClipId &&
                    !ids.includes(s.videoClipId) &&
                    a === s.start &&
                    b === s.end &&
                    (s.linked ?? track.linked ?? true),
                  videoClipId:
                    s.videoClipId &&
                    !ids.includes(s.videoClipId) &&
                    a === s.start &&
                    b === s.end
                      ? s.videoClipId
                      : undefined,
                  start: a,
                  sourceStart: s.sourceStart + (a - s.start) * s.speed,
                  sourceEnd: s.sourceStart + (b - s.start) * s.speed,
                },
              ]
            : [],
        ),
      );
    if (inside.length)
      childAudio.push({
        ...track,
        mediaLayerId: undefined,
        linked: false,
        clips: inside,
      });
    parentAudio.push({
      ...track,
      mediaLayerId: undefined,
      linked: false,
      clips: outside,
    });
  }
  const childAdjustments = (config.adjustmentLayers ?? []).flatMap((a) =>
      a.end > from && a.start < to
        ? [
            {
              ...a,
              start: Math.max(from, a.start) - from,
              end: Math.min(to, a.end) - from,
            },
          ]
        : [],
    ),
    parentAdjustments = (config.adjustmentLayers ?? []).flatMap((a) =>
      [
        { ...a, end: Math.min(a.end, from) },
        { ...a, id: "after-" + a.id, start: Math.max(a.start, to) },
      ].filter((a) => a.end > a.start),
    );
  const definition: NestedSequence = {
    id,
    name,
    editor: {
      ...structuredClone(config),
      nestedSequences: undefined,
      colorLuts: undefined,
      colorGrade: undefined,
      playbackRate: 1,
      audio: {
        systemVolume: 100,
        micVolume: 100,
        systemMuted: false,
        micMuted: false,
      },
      videoClips: structuredClone(selected),
      layers: childLayers,
      adjustmentLayers: childAdjustments,
    },
    keyframes: structuredClone(keyframes),
    captions: structuredClone(captions),
    audioTracks: childAudio,
  };
  const container: VideoClip = {
    id: crypto.randomUUID(),
    sequenceId: id,
    start: 0,
    end: to - from,
  };
  return {
    config: {
      ...config,
      nestedSequences: [...(config.nestedSequences ?? []), definition],
      layers: parentLayers,
      adjustmentLayers: parentAdjustments,
      videoClips: [
        ...clips.slice(0, indices[0]),
        container,
        ...clips.slice(indices[indices.length - 1] + 1),
      ],
    },
    audioTracks: parentAudio,
    id,
  };
}
export function insertSequence(
  config: EditorConfig,
  audioTracks: AudioTrack[],
  id: string,
  at: number,
  duration: number,
  scopeId?: string,
) {
  audioTracks = resolveMediaAudioTracks(audioTracks, config.layers);
  const definitions = config.nestedSequences ?? [];
  if (!canInsertSequence(definitions, id, scopeId))
    throw new Error("This insertion would create a sequence loop");
  const d = definitions.find((d) => d.id === id);
  if (!d) throw new Error("Sequence not found");
  const length =
    sequenceDuration(
      retainedClips(
        d.editor.videoClips,
        d.editor.trimStart,
        d.editor.trimEnd || duration,
      ),
    ) / (d.editor.playbackRate || 1);
  if (length <= 0) throw new Error("This sequence is empty");
  const clips = retainedClips(
      config.videoClips,
      config.trimStart,
      config.trimEnd || duration,
    ),
    next: VideoClip[] = [],
    container: VideoClip = {
      id: crypto.randomUUID(),
      sequenceId: id,
      start: 0,
      end: length,
    };
  let elapsed = 0,
    inserted = false;
  at = Math.max(0, Math.min(sequenceDuration(clips), at));
  for (const c of clips) {
    const end = elapsed + clipDuration(c);
    if (!inserted && at < end - 1e-7) {
      const cut = c.start + (at - elapsed) * clipSpeed(c);
      if (at > elapsed + 1e-7) next.push({ ...c, end: cut });
      next.push(container);
      if (end > at + 1e-7)
        next.push({
          ...c,
          id: crypto.randomUUID(),
          start: c.gap ? 0 : cut,
          end: c.gap ? end - at : c.end,
          transition: undefined,
          sourceClipId: c.id,
        });
      inserted = true;
    } else next.push(c);
    elapsed = end;
  }
  if (!inserted) next.push(container);
  const shift = (start: number, end: number) => ({
    start: start >= at ? start + length : start,
    end: end > at ? end + length : end,
  });
  const rightPrefix = `${container.id}/after/`;
  const layers = config.layers.flatMap((l) => {
      if (l.timeSpace !== "sequence") return [l];
      if (l.start < at && l.end > at)
        return [
          sliceLayer(l, 0, at, 0),
          sliceLayer(l, at, Infinity, at + length, 1, rightPrefix),
        ].filter((part): part is Layer => !!part);
      return [{ ...l, ...shift(l.start, l.end) }];
    }),
    adjustmentLayers = config.adjustmentLayers?.map((a) => ({
      ...a,
      ...shift(a.start, a.end),
    }));
  const tracks = audioTracks.flatMap<AudioTrack>((t) =>
    t.mediaLayerId
      ? layers
          .filter(
            (l) =>
              l.id === t.mediaLayerId || l.id === rightPrefix + t.mediaLayerId,
          )
          .map((l) => ({
            ...t,
            id: l.id === t.mediaLayerId ? t.id : rightPrefix + t.id,
            mediaLayerId: l.id,
          }))
      : [
          {
            ...t,
            mediaLayerId: undefined,
            linked: false,
            clips: resolvedAudioClips(t, clips, Infinity).flatMap((s) => {
              if (s.start >= at)
                return [
                  {
                    ...s,
                    linked: false,
                    videoClipId: undefined,
                    start: s.start + length,
                  },
                ];
              if (s.end <= at)
                return [{ ...s, linked: false, videoClipId: undefined }];
              const cut = s.sourceStart + (at - s.start) * s.speed;
              return [
                { ...s, linked: false, videoClipId: undefined, sourceEnd: cut },
                {
                  ...s,
                  id: crypto.randomUUID(),
                  linked: false,
                  videoClipId: undefined,
                  start: at + length,
                  sourceStart: cut,
                },
              ];
            }),
          },
        ],
  );
  return {
    config: { ...config, layers, adjustmentLayers, videoClips: next },
    audioTracks: tracks,
  };
}
export function unnestClip(
  config: EditorConfig,
  keyframes: Keyframe[],
  captions: CaptionTrack[],
  audioTracks: AudioTrack[],
  id: string,
  duration: number,
) {
  const compiled = compileSequence(
      config,
      keyframes,
      captions,
      audioTracks,
      duration,
    ),
    leaves = compiled.clips.filter((c) => c.parentClipId === id);
  if (!leaves.length) throw new Error("Select a nested sequence");
  const clips = retainedClips(
      config.videoClips,
      config.trimStart,
      config.trimEnd || duration,
    ).flatMap((c) =>
      c.id === id ? leaves.map((c) => ({ ...c, parentClipId: undefined })) : c,
    ),
    layers = new Map(config.layers.map((l) => [l.id, l]));
  leaves.forEach((c) =>
    c.effects?.config.layers?.forEach((l) => layers.set(l.id, l)),
  );
  return {
    config: {
      ...config,
      videoClips: clips,
      layers: [...layers.values()],
      adjustmentLayers: [
        ...(config.adjustmentLayers ?? []),
        ...(compiled.config.adjustmentLayers?.filter((a) =>
          a.id.startsWith(`${id}/`),
        ) ?? []),
      ],
    },
    audioTracks: [
      ...audioTracks,
      ...compiled.audioTracks.filter((t) => t.id.startsWith(`${id}/`)),
    ],
  };
}
