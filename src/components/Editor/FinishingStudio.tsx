import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Scissors, AudioLines, Ratio, MousePointer2, Palette, Play, Pause, X } from "lucide-react";
import { loadInputLog, type LoadedInputLog } from "../../lib/inputLog";
import { userError } from "../../lib/userError";
import type {
  AudioTrack,
  CaptionTrack,
  EditorConfig,
  Keyframe,
  VideoClip,
} from "../../lib/types";
import {
  applyCursorEdits,
  captureLayout,
  cleanupProposals,
  createRecipe,
  formatLayout,
  formatCaptionTracks,
  reaimZoomsAtClicks,
  loopCursorEdits,
  sourceRangesInSequence,
  typingProposals,
  type BrandRecipe,
  type EditRange,
} from "../../lib/editorFinishing";
import { useModalFocus } from "./hooks/useModalFocus";
import "./FinishingStudio.css";

interface Props {
  config: EditorConfig;
  inputLogPath: string;
  captions: CaptionTrack[];
  sequenceCaptions: CaptionTrack[];
  keyframes: Keyframe[];
  tracks: AudioTrack[];
  clips: VideoClip[];
  currentTime: number;
  sequencePosition: number;
  duration: number;
  sourceDuration: number;
  voiceStatus: string;
  bypass: boolean;
  onBypass: (value: boolean) => void;
  playing: boolean;
  onPlay: () => void;
  onChange: (
    config: EditorConfig,
    keyframes?: Keyframe[],
    captions?: CaptionTrack[],
  ) => void;
  onTracks: (tracks: AudioTrack[]) => void;
  onCut: (ranges: EditRange[]) => void;
  onSpeed: (range: EditRange) => void;
  onSeek: (seconds: number) => void;
  onClose: () => void;
}
const RECIPE_KEY = "snap.brandRecipes.v1";
export default function FinishingStudio(p: Props) {
  const [tab, setTab] = useState("cleanup"),
    [message, setMessage] = useState(""),
    [start, setStart] = useState(p.sequencePosition),
    [end, setEnd] = useState(Math.min(p.duration, p.sequencePosition + 1));
  const [selected, setSelected] = useState<number[]>([]),
    [wordStart, setWordStart] = useState<number | null>(null),
    [wordEnd, setWordEnd] = useState<number | null>(null);
  const [log, setLog] = useState<LoadedInputLog | null>(null),
    [silences, setSilences] = useState<{
      trackId: string;
      source: EditRange[];
    } | null>(null),
    [analyzing, setAnalyzing] = useState(false);
  const [silenceTrack, setSilenceTrack] = useState(
    p.tracks.find((t) => t.kind === "microphone")?.id ?? p.tracks[0]?.id ?? "",
  );
  const [transcriptTrack, setTranscriptTrack] = useState(
    p.sequenceCaptions[0]?.id ?? "",
  );
  const transcript = useMemo(
    () =>
      p.sequenceCaptions.filter(
        (t) =>
          t.id ===
          (p.sequenceCaptions.some((t) => t.id === transcriptTrack)
            ? transcriptTrack
            : p.sequenceCaptions[0]?.id),
      ),
    [p.sequenceCaptions, transcriptTrack],
  );
  useEffect(() => {
    let cancelled = false;
    void loadInputLog(p.inputLogPath)
      .then((value) => {
        if (!cancelled) setLog(value);
      })
      .catch((error) => {
        if (!cancelled) setMessage(userError(error));
      });
    return () => {
      cancelled = true;
    };
  }, [p.inputLogPath]);
  const [x, setX] = useState(0.5),
    [y, setY] = useState(0.5),
    [midX, setMidX] = useState(0.5),
    [midY, setMidY] = useState(0.5),
    [toX, setToX] = useState(0.5),
    [toY, setToY] = useState(0.5);
  const [name, setName] = useState("My brand"),
    [recipes, setRecipes] = useState<BrandRecipe[]>(() => {
      try {
        const value = JSON.parse(localStorage.getItem(RECIPE_KEY) ?? "[]");
        return Array.isArray(value)
          ? value
              .filter((r) => r && typeof r.name === "string" && r.appearance)
              .slice(0, 50)
          : [];
      } catch {
        return [];
      }
    });
  const [applyAppearance, setApplyAppearance] = useState(true),
    [applyCaptions, setApplyCaptions] = useState(true),
    [applyAudio, setApplyAudio] = useState(false);
  const ref = useModalFocus(true);
  const proposals = useMemo(() => {
    const track = p.tracks.find((t) => t.id === silences?.trackId);
    const measured =
      track && silences
        ? sourceRangesInSequence(silences.source, track, p.clips, Infinity).map(
            (r) => ({
              ...r,
              label: "Measured quiet audio (−35 dB)",
              kind: "silence" as const,
            }),
          )
        : [];
    return [
      ...cleanupProposals(transcript),
      ...measured,
      ...typingProposals(log?.allEvents ?? [], p.clips),
    ];
  }, [transcript, p.clips, p.tracks, silences, log]);
  useEffect(() => {
    setSelected([]);
    setWordStart(null);
    setWordEnd(null);
  }, [proposals]);
  const words = useMemo(
    () =>
      transcript[0]?.segments
        .flatMap((s) => s.words ?? [])
        .sort((a, b) => a.startMs - b.startMs) ?? [],
    [transcript],
  );
  const videoLocked = p.config.lockedTracks?.includes("video"),
    cursorLocked = p.config.lockedTracks?.includes("cursor");
  const valid =
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    start >= 0 &&
    end > start &&
    end <= p.duration;
  const cursorRangeValid =
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    start >= 0 &&
    end > start &&
    end <= p.sourceDuration;
  const store = (next: BrandRecipe[]) => {
    try {
      localStorage.setItem(RECIPE_KEY, JSON.stringify(next));
      setRecipes(next);
      setMessage("Recipes saved on this computer.");
    } catch {
      setMessage("Recipe storage is full or unavailable; nothing was saved.");
    }
  };
  const addCursor = (mode: "hide" | "path" | "remove-clicks" | "click") => {
    if (!cursorRangeValid || cursorLocked) return;
    if ((mode === "path" || mode === "click") && !log?.region) {
      setMessage(
        "This recording has no capture-region metadata. Path repair and click insertion are unavailable.",
      );
      return;
    }
    p.onChange({
      ...p.config,
      cursorEdits: [
        ...(p.config.cursorEdits ?? []),
        {
          id: crypto.randomUUID(),
          startMs: start * 1000,
          endMs: end * 1000,
          mode,
          points:
            mode === "path"
              ? [
                  { timeMs: start * 1000, x, y },
                  { timeMs: (start + end) * 500, x: midX, y: midY },
                  { timeMs: end * 1000, x: toX, y: toY },
                ]
              : mode === "click"
                ? [{ timeMs: start * 1000, x, y }]
                : undefined,
        },
      ],
    });
    setMessage("Cursor edit added. Original sidecar preserved.");
  };
  const switchLayout = (id: string) => {
    const variants = [...(p.config.layoutVariants ?? [])];
    const active = variants.findIndex((v) => v.id === p.config.activeLayoutId);
    if (active >= 0)
      variants[active] = captureLayout(
        p.config,
        p.keyframes,
        p.captions,
        variants[active].name,
        variants[active].id,
      );
    const target = variants.find((v) => v.id === id);
    if (!target) return;
    p.onChange(
      {
        ...p.config,
        ...target.layout,
        videoClips:
          p.config.videoClips?.map((c) => ({
            ...c,
            effects:
              target.clipEffects?.[c.id] ??
              (c.sourceClipId
                ? target.clipEffects?.[c.sourceClipId]
                : undefined),
          })) ?? null,
        layoutVariants: variants,
        activeLayoutId: id,
      },
      structuredClone(target.keyframes),
      structuredClone(target.captions),
    );
  };
  return (
    <div
      className="ss-command-backdrop finishing-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) p.onClose();
      }}
    >
      <section
        ref={ref}
        tabIndex={-1}
        className="finishing-studio"
        role="dialog"
        aria-modal="true"
        aria-label="Finishing studio"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            p.onClose();
          }
        }}
      >
        <header>
          <div>
            <h2>Finishing tools</h2>
          </div>
          <button className="finishing-icon-button" onClick={p.onPlay} title={p.playing ? "Pause" : "Play"} aria-label={p.playing ? "Pause" : "Play"}>
            {p.playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button className="finishing-icon-button" aria-label="Close finishing studio" onClick={p.onClose}>
            <X size={16} />
          </button>
        </header>
        <nav aria-label="Finishing tools">
          {["cleanup", "voice", "formats", "cursor", "recipes"].map((t) => (
            <button
              key={t}
              aria-pressed={tab === t}
              onClick={() => {
                setTab(t);
                setMessage("");
                if (t === "cursor") {
                  setStart(p.currentTime);
                  setEnd(Math.min(p.sourceDuration, p.currentTime + 1));
                }
                if (t === "cleanup") {
                  setStart(p.sequencePosition);
                  setEnd(Math.min(p.duration, p.sequencePosition + 1));
                }
              }}
            >
              {({ cleanup: <Scissors size={16} />, voice: <AudioLines size={16} />, formats: <Ratio size={16} />, cursor: <MousePointer2 size={16} />, recipes: <Palette size={16} /> })[t]}
              {
                {
                  cleanup: "Cleanup",
                  voice: "Voice",
                  formats: "Formats",
                  cursor: "Cursor",
                  recipes: "Styles",
                }[t]
              }
            </button>
          ))}
        </nav>
        <div className="finishing-body">
          {(tab === "cleanup" || tab === "cursor") && (
            <fieldset>
              <legend>
                {tab === "cursor"
                  ? "Source recording range (seconds)"
                  : "Sequence range (seconds)"}
              </legend>
              <label>
                Start
                <input
                  type="number"
                  step=".01"
                  min="0"
                  value={start}
                  onChange={(e) => setStart(Number(e.target.value))}
                />
              </label>
              <label>
                End
                <input
                  type="number"
                  step=".01"
                  min="0"
                  value={end}
                  onChange={(e) => setEnd(Number(e.target.value))}
                />
              </label>
              {tab === "cursor" && (
                <button
                  onClick={() => {
                    setStart(p.currentTime);
                    setEnd(Math.min(p.sourceDuration, p.currentTime + 1));
                  }}
                >
                  Use source playhead
                </button>
              )}
            </fieldset>
          )}
          {tab === "cleanup" && (
            <>
              <label>
                Transcript track
                <select
                  value={transcript[0]?.id ?? ""}
                  disabled={!p.sequenceCaptions.length}
                  onChange={(e) => setTranscriptTrack(e.target.value)}
                >
                  {!p.sequenceCaptions.length && <option value="">No captions</option>}
                  {p.sequenceCaptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                Transcript gaps are not verified silence. Listen before cutting.
              </p>
              <div className="finishing-transcript">
                {words.map((w, i) => (
                  <button
                    key={i}
                    className={
                      wordStart !== null &&
                      wordEnd !== null &&
                      i >= Math.min(wordStart, wordEnd) &&
                      i <= Math.max(wordStart, wordEnd)
                        ? "selected"
                        : ""
                    }
                    title={`${(w.startMs / 1000).toFixed(2)}s`}
                    onClick={(e) => {
                      const a =
                        e.shiftKey && wordStart !== null ? wordStart : i;
                      setWordStart(a);
                      setWordEnd(i);
                      setStart(words[Math.min(a, i)].startMs / 1000);
                      setEnd(words[Math.max(a, i)].endMs / 1000);
                      p.onSeek(w.startMs / 1000);
                    }}
                  >
                    {w.text}
                  </button>
                ))}
                {!words.length && (
                  <p>
                    Add captions to select words, or set a range above.
                  </p>
                )}
              </div>
              <div className="finishing-actions">
                <button
                  disabled={!valid || videoLocked}
                  onClick={() => {
                    p.onCut([{ start, end }]);
                    setSelected([]);
                  }}
                >
                  Ripple-cut range
                </button>
                <button
                  disabled={!valid || videoLocked}
                  onClick={() => p.onSpeed({ start, end })}
                >
                  Speed range to 2×
                </button>
              </div>
              <p>
                2× preserves linked effects and audio; unavailable with independent sequence overlays.
              </p>
              <h3>Review suggestions</h3>
              {proposals.map((r, i) => (
                <div
                  className="finishing-proposal"
                  key={`${r.start}-${r.end}-${i}`}
                >
                  <label>
                    <input
                      type="checkbox"
                      disabled={r.kind === "typing"}
                      checked={selected.includes(i)}
                      onChange={(e) =>
                        setSelected((s) =>
                          e.target.checked
                            ? [...s, i]
                            : s.filter((v) => v !== i),
                        )
                      }
                    />
                    {r.label} · {r.start.toFixed(2)}–{r.end.toFixed(2)}s
                  </label>
                  <button onClick={() => { p.onSeek(Math.max(0, r.start - 0.3)); if(!p.playing)p.onPlay(); }}>
                    Listen
                  </button>
                </div>
              ))}
              <fieldset>
                <legend>Measure quiet audio</legend>
                <select
                  aria-label="Silence analysis track"
                  value={silenceTrack}
                  disabled={!p.tracks.length}
                  onChange={(e) => setSilenceTrack(e.target.value)}
                >
                  {!p.tracks.length && <option value="">No audio</option>}
                  {p.tracks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <button
                  disabled={
                    analyzing || !p.tracks.some((t) => t.id === silenceTrack)
                  }
                  onClick={() => {
                    const track = p.tracks.find((t) => t.id === silenceTrack);
                    if (!track) return;
                    setAnalyzing(true);
                    setMessage("Analyzing original audio locally…");
                    void invoke<EditRange[]>("editor_silence_ranges", {
                      path: track.path,
                    })
                      .then((source) => {
                        setSilences({ trackId: track.id, source });
                        setMessage(
                          `Found ${source.length} quiet intervals. Review them before cutting.`,
                        );
                      })
                      .catch((error) => setMessage(userError(error)))
                      .finally(() => setAnalyzing(false));
                  }}
                >
                  {analyzing ? "Analyzing…" : "Analyze silence"}
                </button>
              </fieldset>
              <p>
                Only the selected track is measured. Review other audio before cutting; typing is sped up, not deleted.
              </p>
              {proposals
                .filter((r) => r.kind === "typing")
                .map((r, i) => (
                  <button
                    key={i}
                    disabled={videoLocked}
                    onClick={() => p.onSpeed(r)}
                  >
                    Speed typing {r.start.toFixed(1)}–{r.end.toFixed(1)}s to 2×
                  </button>
                ))}
              <button
                disabled={!selected.length || videoLocked}
                onClick={() => {
                  p.onCut(
                    selected.flatMap((i) =>
                      proposals[i] ? [proposals[i]] : [],
                    ),
                  );
                  setSelected([]);
                }}
              >
                Ripple-cut reviewed suggestions ({selected.length})
              </button>
            </>
          )}
          {tab === "voice" && (
            <>
              <p>
                Offline noise reduction, de-essing, compression and optional
                loudness leveling. Room-tail reduction uses a gentle gate, not
                AI de-reverberation. Source audio stays unchanged.
              </p>
              {p.tracks.map((t) => {
                const settings = t.voicePolish ?? {
                  enabled: false,
                  strength: 0.5,
                  hum: "off" as const,
                  roomTail: false,
                  loudness: true,
                };
                const update = (patch: Partial<typeof settings>) =>
                  p.onTracks(
                    p.tracks.map((track) =>
                      track.id === t.id
                        ? { ...track, voicePolish: { ...settings, ...patch } }
                        : track,
                    ),
                  );
                return (
                  <fieldset
                    key={t.id}
                    disabled={p.config.lockedTracks?.includes(t.id)}
                  >
                    <legend>{t.label}</legend>
                    <label>
                      <input
                        type="checkbox"
                        checked={settings.enabled}
                        onChange={(e) => update({ enabled: e.target.checked })}
                      />
                      Enable voice polish
                    </label>
                    <label>
                      Strength {Math.round(settings.strength * 100)}%
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step=".05"
                        value={settings.strength}
                        onChange={(e) =>
                          update({ strength: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label>
                      Hum
                      <select
                        value={settings.hum}
                        onChange={(e) =>
                          update({ hum: e.target.value as typeof settings.hum })
                        }
                      >
                        <option value="off">Off</option>
                        <option value="50">50 Hz</option>
                        <option value="60">60 Hz</option>
                      </select>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={settings.roomTail}
                        onChange={(e) => update({ roomTail: e.target.checked })}
                      />
                      Reduce quiet room tails
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={settings.loudness}
                        onChange={(e) => update({ loudness: e.target.checked })}
                      />
                      Level voice to −16 LUFS
                    </label>
                  </fieldset>
                );
              })}
              {!p.tracks.length && <p>Add a narration audio track first.</p>}
              <button
                aria-pressed={p.bypass}
                disabled={!p.voiceStatus.startsWith("Voice polish ready")}
                onClick={() => p.onBypass(!p.bypass)}
              >
                {p.bypass
                  ? "A: original — switch to polished"
                  : "B: polished — compare original"}
              </button>
              <p role="status">{p.voiceStatus}</p>
              <p>
                A/B changes preview only. Export always uses enabled polish
                settings.
              </p>
            </>
          )}
          {tab === "formats" && (
            <>
              <p>
                Each variant stores its own crop, framing, zooms and captions.
                The master is saved before the first variant. Safe-area guides
                are preview-only conservative margins, not a guarantee for every
                platform UI.
              </p>
              <div className="finishing-actions">
                {(["vertical", "square", "wide"] as const).map((format) => (
                  <button
                    key={format}
                    onClick={() => {
                      const variants = [...(p.config.layoutVariants ?? [])];
                      const active = variants.findIndex(
                        (v) => v.id === p.config.activeLayoutId,
                      );
                      if (active >= 0)
                        variants[active] = captureLayout(
                          p.config,
                          p.keyframes,
                          p.captions,
                          variants[active].name,
                          variants[active].id,
                        );
                      else if (!variants.length)
                        variants.push(
                          captureLayout(
                            p.config,
                            p.keyframes,
                            p.captions,
                            "Master",
                          ),
                        );
                      const config = formatLayout(p.config, format),
                        captions = formatCaptionTracks(p.captions, format);
                      const variant = captureLayout(
                        config,
                        p.keyframes,
                        captions,
                        `${format} ${variants.length}`,
                      );
                      variants.push(variant);
                      p.onChange(
                        {
                          ...config,
                          layoutVariants: variants,
                          activeLayoutId: variant.id,
                        },
                        p.keyframes,
                        captions,
                      );
                    }}
                  >
                    New {format}
                  </button>
                ))}
              </div>
              {(p.config.layoutVariants ?? []).map((v) => (
                <div className="finishing-proposal" key={v.id}>
                  <button
                    aria-pressed={v.id === p.config.activeLayoutId}
                    onClick={() => switchLayout(v.id)}
                  >
                    {v.name}
                  </button>
                  <button
                    disabled={
                      v.id === p.config.activeLayoutId || v.name === "Master"
                    }
                    onClick={() =>
                      p.onChange({
                        ...p.config,
                        layoutVariants: p.config.layoutVariants?.filter(
                          (x) => x.id !== v.id,
                        ),
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              <label>
                Safe guides
                <select
                  value={p.config.safeArea ?? "off"}
                  onChange={(e) =>
                    p.onChange({
                      ...p.config,
                      safeArea: e.target.value as EditorConfig["safeArea"],
                    })
                  }
                >
                  <option value="off">Off</option>
                  <option value="vertical">Vertical</option>
                  <option value="square">Square</option>
                </select>
              </label>
              <button
                disabled={
                  !log?.region ||
                  !log.clickEvents.length ||
                  p.config.lockedTracks?.includes("zoom")
                }
                onClick={() => {
                  if (!log) return;
                  const repairedLog = applyCursorEdits(
                    log,
                    p.config.cursorEdits ?? [],
                  );
                  const config = {
                    ...p.config,
                    videoClips:
                      p.config.videoClips?.map((clip) =>
                        clip.effects
                          ? {
                              ...clip,
                              effects: {
                                ...clip.effects,
                                keyframes: reaimZoomsAtClicks(
                                  clip.effects.keyframes,
                                  repairedLog,
                                  p.config.crop,
                                ),
                              },
                            }
                          : clip,
                      ) ?? null,
                  };
                  p.onChange(
                    config,
                    reaimZoomsAtClicks(p.keyframes, repairedLog, p.config.crop),
                  );
                  setMessage(
                    "Zoom targets re-aimed at nearby recorded clicks. Review edge framing in preview.",
                  );
                }}
              >
                Re-aim zooms at recorded clicks
              </button>
              <p>
                Close this dialog to adjust crop, zoom target and caption
                placement in the editor; switching variants saves those
                adjustments.
              </p>
            </>
          )}
          {tab === "cursor" && (
            <>
              <p>
                Repair a recorded cursor using source timestamps and normalized
                coordinates. Path/click insertion requires Snap capture-region
                metadata; imported video without that metadata supports
                hide/remove only.
              </p>
              <fieldset>
                <legend>Path control points (0–1)</legend>
                {(
                  [
                    ["Start X", x, setX],
                    ["Start Y", y, setY],
                    ["Middle X", midX, setMidX],
                    ["Middle Y", midY, setMidY],
                    ["End X", toX, setToX],
                    ["End Y", toY, setToY],
                  ] as const
                ).map(([label, value, set]) => (
                  <label key={label}>
                    {label}
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step=".01"
                      value={value}
                      onChange={(e) =>
                        set(Math.max(0, Math.min(1, Number(e.target.value))))
                      }
                    />
                  </label>
                ))}
              </fieldset>
              <div className="finishing-actions">
                {(["hide", "path", "remove-clicks", "click"] as const).map(
                  (mode) => (
                    <button
                      key={mode}
                      disabled={!cursorRangeValid || cursorLocked}
                      onClick={() => addCursor(mode)}
                    >
                      {
                        {
                          hide: "Hide cursor",
                          path: "Replace path",
                          "remove-clicks": "Remove clicks",
                          click: "Insert click at start",
                        }[mode]
                      }
                    </button>
                  ),
                )}
                <button
                  disabled={!cursorRangeValid || cursorLocked || !log?.region}
                  onClick={() => {
                    setToX(x);
                    setToY(y);
                    p.onChange({
                      ...p.config,
                      cursorEdits: [
                        ...(p.config.cursorEdits ?? []),
                        {
                          id: crypto.randomUUID(),
                          mode: "path",
                          startMs: start * 1000,
                          endMs: end * 1000,
                          points: [
                            { timeMs: start * 1000, x, y },
                            { timeMs: end * 1000, x, y },
                          ],
                        },
                      ],
                    });
                  }}
                >
                  Hold cursor in range
                </button>
              </div>
              <p>
                Existing cursor smoothing applies to repaired paths. Later paths
                override earlier paths. Hide ranges remain hidden until removed.
              </p>
              <button
                disabled={
                  cursorLocked || !log?.region || !p.clips.some((c) => !c.gap)
                }
                onClick={() => {
                  p.onChange({
                    ...p.config,
                    cursorEdits: [
                      ...(p.config.cursorEdits ?? []),
                      ...loopCursorEdits(p.clips, x, y),
                    ],
                  });
                  setMessage(
                    "First and last 400 ms now hold the start point for a matching cursor loop seam.",
                  );
                }}
              >
                Align first/last cursor for loop
              </button>
              <p>
                Loop repair is source-timed, so reused source ranges share the
                repair. A cursor baked into imported footage cannot be removed.
              </p>
              {(p.config.cursorEdits ?? []).map((edit) => (
                <div className="finishing-proposal" key={edit.id}>
                  <span>
                    {edit.mode} · {(edit.startMs / 1000).toFixed(2)}–
                    {(edit.endMs / 1000).toFixed(2)}s
                  </span>
                  <button
                    disabled={cursorLocked}
                    onClick={() =>
                      p.onChange({
                        ...p.config,
                        cursorEdits: p.config.cursorEdits?.filter(
                          (e) => e.id !== edit.id,
                        ),
                      })
                    }
                  >
                    Remove repair
                  </button>
                </div>
              ))}
            </>
          )}
          {tab === "recipes" && (
            <>
              <p>
                Recipes copy style only: no source files, timeline ranges, layer
                IDs, camera animation or caption text. Imported
                backgrounds/cursor packs still need to exist on this computer.
              </p>
              <label>
                Recipe name
                <input
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <button
                disabled={!name.trim() || recipes.length >= 50}
                onClick={() =>
                  store([
                    ...recipes,
                    createRecipe(name.trim(), p.config, p.captions, p.tracks),
                  ])
                }
              >
                Save current style
              </button>
              <fieldset>
                <legend>Apply selectively</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={applyAppearance}
                    onChange={(e) => setApplyAppearance(e.target.checked)}
                  />
                  Appearance / framing
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={applyCaptions}
                    onChange={(e) => setApplyCaptions(e.target.checked)}
                  />
                  Caption style
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={applyAudio}
                    onChange={(e) => setApplyAudio(e.target.checked)}
                  />
                  Audio mix / microphone polish
                </label>
              </fieldset>
              {recipes.map((r) => (
                <div className="finishing-proposal" key={r.id}>
                  <span>{r.name}</span>
                  <button
                    onClick={() => {
                      const { audio, ...appearance } = r.appearance;
                      p.onChange(
                        {
                          ...p.config,
                          videoClips:
                            applyCaptions && r.captionStyle
                              ? (p.config.videoClips?.map((c) =>
                                  c.effects
                                    ? {
                                        ...c,
                                        effects: {
                                          ...c.effects,
                                          captions: c.effects.captions.map(
                                            (t) => ({
                                              ...t,
                                              style: structuredClone(
                                                r.captionStyle!,
                                              ),
                                            }),
                                          ),
                                        },
                                      }
                                    : c,
                                ) ?? null)
                              : p.config.videoClips,
                          ...(applyAppearance
                            ? structuredClone(appearance)
                            : {}),
                          ...(applyAudio && audio
                            ? { audio: structuredClone(audio) }
                            : {}),
                        },
                        undefined,
                        applyCaptions && r.captionStyle
                          ? p.captions.map((t) => ({
                              ...t,
                              style: structuredClone(r.captionStyle!),
                            }))
                          : undefined,
                      );
                      if (applyAudio && r.voicePolish)
                        p.onTracks(
                          p.tracks.map((t) =>
                            t.kind === "microphone"
                              ? {
                                  ...t,
                                  voicePolish: structuredClone(r.voicePolish),
                                }
                              : t,
                          ),
                        );
                      setMessage(
                        `Applied ${r.name}. Undo restores the previous edit.`,
                      );
                    }}
                  >
                    Apply
                  </button>
                  <button
                    onClick={() => store(recipes.filter((v) => v.id !== r.id))}
                  >
                    Delete recipe
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
        {message && <footer role="status">{message}</footer>}
      </section>
    </div>
  );
}
