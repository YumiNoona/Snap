import { useEffect, useMemo, useRef, useState } from "react";
import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Link2,
  LoaderCircle,
  Scissors,
  Settings2,
  X,
} from "lucide-react";
import { useModalFocus } from "./hooks/useModalFocus";
import LinkImportDialog from "./LinkImportDialog";
import AutoClipPreview from "./AutoClipPreview";
import ClipTimeField from "./ClipTimeField";
import MomentStrip from "./MomentStrip";
import { mediaSrc } from "../../lib/mediaSource";
import { getTranscriptionEnvironment } from "../../lib/captions";
import {
  autoClipProject,
  DEFAULT_CLIP_CAPTIONS,
  distinctClips,
  findClipCandidates,
  formatClipTime,
  mergeClipTranscript,
  rankedClips,
  naturalClipBounds,
  type ClipAnalysis,
  type ClipCandidate,
  type ClipCaptionOptions,
  type ClipRanking,
  type ClipRatio,
  type ClipTranscript,
} from "../../lib/autoClips";
import { type FrameRect, type SplitLayout } from "../../lib/videoFraming";
import { recordingDataPaths } from "../../lib/recordingPaths";
import { saveProjectAtPath } from "../../lib/project";
import type { AudioTrack } from "../../lib/types";
import Slider from "../shared/Slider";
import { SelectRow, CheckRow } from "./Panels/PanelControls";
import type { EditorRoute } from "../../lib/clipWorkspace";
import "./Panels/Panels.css";
import "./AutoClips.css";

export interface AutoClipSource {
  path: string;
  name: string;
  audioPath?: string;
  audioTracks?: AudioTrack[];
}
interface Props {
  sources: AutoClipSource[];
  onClose: () => void;
  onOpen: (
    projectPath: string,
    videoPath: string,
    inputLogPath: string,
    clips?: EditorRoute[],
  ) => Promise<void>;
}
interface SourceInfo {
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
}
interface Progress {
  phase: string;
  percent: number;
}
const RATIOS: ClipRatio[] = ["9:16", "1:1", "4:5", "16:9"],
  FULL: FrameRect = { x: 0, y: 0, w: 1, h: 1 },
  FACE: FrameRect = { x: 0.02, y: 0.02, w: 0.25, h: 0.35 };
const durationText = (n: number) =>
  `${Math.floor(n / 60)}m ${Math.floor(n % 60)}s`;
interface ClipFraming { camera: FrameRect; content: FrameRect; fraction: number; template: "stacked" | "full" | "fit" }
export default function AutoClipsStudio({ sources, onClose, onOpen }: Props) {
  const [framings, setFramings] = useState<Record<string, ClipFraming>>({});
  const [extras, setExtras] = useState<AutoClipSource[]>([]),
    [path, setPath] = useState(sources[0]?.path ?? ""),
    [showLink, setShowLink] = useState(false),
    [step, setStep] = useState(0);
  const allSources = [...sources, ...extras].filter(
      (s, i, a) => a.findIndex((o) => o.path === s.path) === i,
    ),
    source = allSources.find((s) => s.path === path);
  const [info, setInfo] = useState<SourceInfo>(),
    [loading, setLoading] = useState(false),
    [rangeStart, setRangeStart] = useState(0),
    [rangeEnd, setRangeEnd] = useState(0);
  const [count, setCount] = useState(2),
    [length, setLength] = useState(10),
    [mode, setMode] = useState<"auto" | "gaming" | "talking" | "reactions">(
      "gaming",
    ),
    [flexible, setFlexible] = useState(true),
    [detailed, setDetailed] = useState(false);
  const [captions, setCaptions] = useState(true),
    [ccReady, setCcReady] = useState(false),
    [aiReady, setAiReady] = useState(false),
    [useAI, setUseAI] = useState(false),
    [instruction, setInstruction] = useState(""),
    [language, setLanguage] = useState("auto");
  const [analysis, setAnalysis] = useState<ClipAnalysis>(),
    [candidates, setCandidates] = useState<ClipCandidate[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [activeId, setActiveId] = useState(""),
    [atlas, setAtlas] = useState("");
  const [ratio, setRatio] = useState<ClipRatio>("9:16"),
    [formats, setFormats] = useState<ClipRatio[]>(["9:16"]),
    [template, setTemplate] = useState<"stacked" | "full" | "fit">("full"),
    [editRegion, setEditRegion] = useState<"camera" | "content" | null>(null);
  const [camera, setCamera] = useState<FrameRect>(FACE),
    [content, setContent] = useState<FrameRect>(FULL),
    [fraction, setFraction] = useState(0.38),
    [captionOptions, setCaptionOptions] = useState<ClipCaptionOptions>(
      DEFAULT_CLIP_CAPTIONS,
    );
  const [busy, setBusy] = useState(""),
    [progress, setProgress] = useState<Progress>(),
    [elapsed, setElapsed] = useState(0),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [created, setCreated] = useState<
    Array<{ name: string; path: string; video: string; log: string }>
  >([]);
  const alive = useRef(true),
    preparedSpeech = useRef<{path:string;language:string;ranges:Array<{start:number;end:number}>}>({path:"",language:"",ranges:[]}),
    cancelled = useRef(false),
    dialog = useModalFocus(!showLink),
    rangeVideo = useRef<HTMLVideoElement>(null),
    scrollPanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollPanel.current) scrollPanel.current.scrollTop = 0;
  }, [step]);
  useEffect(() => {
    const media = rangeVideo.current;
    return () => {
      if (media) {
        media.pause();
        media.removeAttribute("src");
        media.load();
      }
    };
  }, [info, path, step]);
  const active = candidates.find((c) => c.id === activeId) ?? candidates[0],
    disabled = !!busy || loading;
  const split: SplitLayout | undefined = useMemo(
    () =>
      template === "stacked"
        ? { camera, content, fraction, contentFit: "cover", cameraFit: "cover" }
        : undefined,
    [template, camera, content, fraction],
  );
  useEffect(() => {
    alive.current = true;
    void getTranscriptionEnvironment()
      .then((e) => {
        if (alive.current) setCcReady(e.available);
      })
      .catch(() => {});
    void invoke<boolean>("auto_clips_ai_ready")
      .then((v) => {
        if (alive.current) setAiReady(v);
      })
      .catch(() => {});
    return () => {
      alive.current = false;
      cancelled.current = true;
      void invoke("cancel_auto_clips").catch(() => {});
    };
  }, []);
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setInfo(undefined);
    setAnalysis(undefined);
    setCandidates([]);
    setCreated([]);
    setStep(0);
    setError("");
    const timer = setTimeout(() => {
      if (!path) {
        setLoading(false);
        return;
      }
      void invoke<SourceInfo>("inspect_auto_clips_source", { path })
        .then((r) => {
          if (!disposed) {
            setInfo(r);
            setRangeStart(0);
            setRangeEnd(Math.min(600, r.duration));
          }
        })
        .catch((e) => {
          if (!disposed) setError(String(e));
        })
        .finally(() => {
          if (!disposed) setLoading(false);
        });
    }, 30);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [path]);
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const started = Date.now(),
      timer = setInterval(
        () => setElapsed(Math.floor((Date.now() - started) / 1000)),
        1000,
      );
    return () => clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    let disposed = false;
    setAtlas("");
    if (analysis)
      void invoke<string>("editor_cached_media", { path, kind: "thumbnails" })
        .then((f) => {
          if (!disposed) setAtlas(convertFileSrc(f));
        })
        .catch(() => {});
    return () => {
      disposed = true;
    };
  }, [analysis?.duration, path]);
  const updates = (base = 0, span = 100) =>
    new Channel<Progress>((p) => {
      if (alive.current && !cancelled.current)
        setProgress({
          phase: p.phase,
          percent: Math.round(base + (p.percent * span) / 100),
        });
    });
  const begin = (label: string) => {
      cancelled.current = false;
      setBusy(label);
      setProgress(undefined);
      setError("");
      setNotice("");
    },
    finish = () => {
      if (alive.current) {
        setBusy("");
        setProgress(undefined);
      }
    };
  const choose = async () => {
    try {
      const file = await open({
        multiple: false,
        title: "Choose a source video",
        filters: [
          { name: "Videos", extensions: ["mp4", "mov", "mkv", "webm", "avi"] },
        ],
      });
      if (typeof file !== "string") return;
      begin("Preparing source");
      const staged = await invoke<string>("stage_editor_source", {
        path: file,
      });
      setExtras((old) => [
        ...old,
        { path: staged, name: file.split(/[\\/]/).pop() ?? "Video" },
      ]);
      setPath(staged);
    } catch (e) {
      setError(String(e));
    } finally {
      finish();
    }
  };
  const install = async (kind: "ai" | "captions") => {
    begin(kind === "ai" ? "Installing local AI" : "Installing Auto CC");
    try {
      await invoke(
        kind === "ai" ? "install_auto_clips_ai" : "install_auto_clips_captions",
        { updates: updates() },
      );
      if (kind === "ai") setAiReady(true);
      else setCcReady(true);
    } catch (e) {
      setError(String(e));
    } finally {
      finish();
    }
  };
  const speech = async (
    clips: ClipCandidate[],
    base = 40,
    span = 45,
    context = false,
  ): Promise<ClipTranscript[]> => {
    const ranges = clips.map((c) => ({ start: Math.max(rangeStart, c.start - (context ? 2 : 0)), end: Math.min(rangeEnd, c.end + (context ? 3 : 0)) }));
    const result = await invoke<ClipTranscript[]>("transcribe_auto_clip_ranges", {
      request: {
        path,
        audioPath: source?.audioPath ?? null,
        language,
        ranges,
      },
      updates: updates(base, span),
    });
    if (!cancelled.current) preparedSpeech.current = {path, language, ranges: [...(preparedSpeech.current.path === path && preparedSpeech.current.language === language ? preparedSpeech.current.ranges : []), ...ranges.map(r=>({start:Math.max(0,r.start-.6),end:Math.min(info?.duration??rangeEnd,r.end+.6)}))]};
    return result;
  };
  const analyze = async () => {
    if (!source || disabled || !info) return;
    begin("Finding moments");
    preparedSpeech.current = {path,language,ranges:[]};
    setCreated([]);
    setAnalysis(undefined);
    setCandidates([]);
    try {
      let result = await invoke<ClipAnalysis>("analyze_auto_clips", {
        request: {
          path,
          audioPath: source.audioPath ?? null,
          rangeStart,
          rangeEnd,
          detailed,
        },
        updates: updates(0, 40),
      });
      if (cancelled.current || !alive.current) return;
      let clips = findClipCandidates(result, length, mode, flexible);
      if (captions || useAI) {
        try {
          result = {
            ...result,
            transcript: await speech(
              distinctClips(clips, Math.min(6, Math.max(2, count * 2))),
              40, 45, flexible,
            ),
          };
        } catch (e) {
          if (cancelled.current) return;
          setNotice(
            `Speech preparation: ${String(e)}. Retry captions when creating clips.`,
          );
        }
      }
      if (cancelled.current || !alive.current) return;
      if (flexible) clips = clips.map((c) => naturalClipBounds(result, c));
      clips = clips.map((c) => {
        const text = result.transcript
          .filter((s) => s.endMs > c.start * 1000 && s.startMs < c.end * 1000)
          .map((s) => s.text)
          .join(" ");
        return text ? { ...c, title: text.slice(0, 70), transcript: text } : c;
      });
      if (useAI && result.transcript.length) {
        try {
          const rank = await invoke<{ rankings: ClipRanking[] }>(
            "rank_auto_clips",
            {
              candidates: clips
                .filter((c) => c.transcript)
                .slice(0, 8)
                .map((c) => ({
                  id: c.id,
                  transcript: c.transcript.slice(0, 200),
                  activityScore: c.score,
                })),
              instruction: `${mode} highlights. ${instruction}`,
              updates: updates(85, 15),
            },
          );
          clips = rankedClips(clips, rank.rankings);
        } catch (e) {
          if (cancelled.current) return;
          console.warn("Local AI ranking unavailable; keeping activity suggestions.", e);
        }
      }
      if (cancelled.current || !alive.current) return;
      setAnalysis(result);
      setFramings({});
      setCandidates(clips);
      setSelected(distinctClips(clips, count).map((c) => c.id));
      setActiveId(clips[0]?.id ?? "");
      setCamera(result.facecam ?? FACE);
      setContent(FULL);
      setTemplate(result.facecam ? "stacked" : "full");
      setEditRegion(null);
      setStep(2);
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      finish();
    }
  };
  const create = async () => {
    if (!analysis || !source || disabled) return;
    begin("Preparing editable clips");
    const saved: typeof created = [],
      batch = Date.now();
    try {
      let current = analysis;
      const chosen = candidates.filter((c) => selected.includes(c.id));
      if (captions) {
        const coverage = preparedSpeech.current;
        const missing = chosen.filter(c => coverage.path !== path || coverage.language !== language || !coverage.ranges.some(r=>c.start>=r.start && c.end<=r.end));
        const added = missing.length ? await speech(missing, 0, 85) : [];
        if (cancelled.current) return;
        current = {
          ...analysis,
          transcript: mergeClipTranscript(
            analysis.transcript.filter(
              (s) =>
                !missing.some(
                  (c) =>
                    s.endMs > (c.start - 0.6) * 1000 &&
                    s.startMs < (c.end + 0.6) * 1000,
                ),
            ),
            added,
          ),
        };
        setAnalysis(current);
      }
      const hasAudio =
        info?.hasAudio ?? (await invoke<boolean>("media_has_audio", { path }));
      for (const clip of chosen)
        for (const format of formats) {
          if (cancelled.current) return;
          const frame = clip.id === active?.id ? { camera, content, fraction, template } : framings[clip.id] ?? { camera: current.facecam ?? FACE, content: FULL, fraction: .38, template: current.facecam ? "stacked" : "full" };
          const project = autoClipProject(
            path,
            current,
            clip,
            format,
            frame.template === "stacked" ? { camera: frame.camera, content: frame.content, fraction: frame.fraction, contentFit: "cover", cameraFit: "cover" } : undefined,
            captions,
            source.audioTracks ?? [],
            hasAudio,
            captionOptions,
            {
              fit: frame.template === "fit" ? "contain" : "cover",
              crop: frame.template === "full" ? frame.content : undefined,
            },
          );
          const projectPath = `${recordingDataPaths(path).dataDir}\\auto-clips\\${batch}\\${clip.id}-${format.replace(":", "x")}.snap.json`;
          await saveProjectAtPath(project, projectPath);
          saved.push({
            name: `${clip.title} · ${format}`,
            path: projectPath,
            video: path,
            log: project.media.inputLogPath,
          });
          setCreated([...saved]);
        }
      setNotice(
        `${saved.length} clips saved. Open a clip to finish editing and export.`,
      );
    } catch (e) {
      setError(
        `${saved.length ? `${saved.length} clips saved. ` : ""}${String(e)}`,
      );
    } finally {
      finish();
    }
  };
  const cancel = async () => {
    cancelled.current = true;
    setNotice("Cancelling and releasing local workers…");
    await invoke("cancel_auto_clips").catch(() => {});
  };
  const openCreated = async (c: (typeof created)[number]) => {
    begin("Opening clip");
    try {
      await onOpen(
        c.path,
        c.video,
        c.log,
        created.map((item) => ({
          projectPath: item.path,
          videoPath: item.video,
          inputLogPath: item.log,
          label: item.name,
          position: 0,
        })),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      finish();
    }
  };
  useEffect(() => {
    setCreated([]);
  }, [candidates, selected, formats, split, captions, captionOptions, content, template, framings]);
  const reviewMoment = (id: string) => {
    if (id === active?.id) return;
    if (active) setFramings(old => ({ ...old, [active.id]: { camera, content, fraction, template } }));
    const frame = framings[id];
    setCamera(frame?.camera ?? analysis?.facecam ?? FACE);
    setContent(frame?.content ?? FULL);
    setFraction(frame?.fraction ?? .38);
    setTemplate(frame?.template ?? (analysis?.facecam ? "stacked" : "full"));
    setActiveId(id);
    setEditRegion(null);
  };
  const rangeLength = Math.max(0, rangeEnd - rangeStart),
    validRange =
      !!info &&
      rangeLength >= Math.min(3, info.duration) &&
      rangeStart >= 0 &&
      rangeEnd <= info.duration;
  const changeRange = (start: number, end: number) => {
    setRangeStart(start);
    setRangeEnd(end);
    setAnalysis(undefined);
    setCandidates([]);
    setCreated([]);
  };
  const boundary = (which: "start" | "end", n: number) => {
    if (!info || !Number.isFinite(n)) return;
    if (which === "start") {
      const s = Math.max(0, Math.min(rangeEnd - 0.1, n));
      changeRange(s, rangeEnd);
      if (rangeVideo.current) rangeVideo.current.currentTime = s;
    } else
      changeRange(
        rangeStart,
        Math.min(info.duration, Math.max(rangeStart + 0.1, n)),
      );
  };
  return (
    <>
      {!showLink && (
        <div className="ss-command-backdrop auto-clips-backdrop">
          <section
            ref={dialog}
            className="auto-clips-dialog ac-studio editor-glass-surface"
            role="dialog"
            aria-modal="true"
            aria-labelledby="auto-clips-title"
            tabIndex={-1}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape" && !disabled) onClose();
            }}
          >
            <div className="ac-scroll" ref={scrollPanel}>
              <header className="ac-header">
                <div className="ac-brand">
                  <span className="ac-logo">
                    <Scissors size={20} />
                  </span>
                  <div>
                    <h2 id="auto-clips-title">Auto Clips</h2>
                    <p>Find highlights, adjust the layout, and create clips.</p>
                  </div>
                </div>
                <span className="ac-local-badge">Local processing</span>
                <button
                  aria-label="Close Auto Clips"
                  disabled={disabled}
                  onClick={onClose}
                >
                  <X size={18} />
                </button>
              </header>
              <div className="ac-content">
                {busy ? (
                  <div
                    className="ac-processing"
                    role="status"
                    aria-live="polite"
                  >
                    <LoaderCircle size={30} className="spin" />
                    <h3>{progress?.phase ?? busy}</h3>
                    <p>Keep Snap open. Processing stays on this computer.</p>
                    <progress
                      max={100}
                      value={
                        /download|install/i.test(progress?.phase ?? busy)
                          ? progress?.percent
                          : undefined
                      }
                    />
                    <div className="ac-progress-meta">
                      <span>
                        <Clock3 size={14} />
                        {formatClipTime(elapsed)} elapsed
                      </span>
                      <button
                        onClick={() => void cancel()}
                        disabled={cancelled.current}
                      >
                        Cancel
                      </button>
                    </div>
                    <p className="ac-help">
                      Cancel at any time to keep working on your timeline.
                    </p>
                  </div>
                ) : (
                  <>
                    {step === 0 && (
                      <div className="ac-source-step">
                        <div className="ac-section-heading">
                          <div>
                            <h3>Choose a video</h3>
                            <p>Use an upload, recording, or video link.</p>
                          </div>
                          <div className="ac-actions">
                            <button onClick={() => void choose()}>
                              Choose file
                            </button>
                            <button onClick={() => setShowLink(true)}>
                              <Link2 size={14} />
                              From link
                            </button>
                          </div>
                        </div>
                        <SelectRow
                          label="Source video"
                          value={path}
                          disabled={loading}
                          options={allSources.map((s) => s.path)}
                          optionLabels={Object.fromEntries(
                            allSources.map((s) => [s.path, s.name]),
                          )}
                          onChange={setPath}
                        />
                        {loading && <p role="status">Reading video details…</p>}
                        {info && (
                          <div className="ac-range-grid">
                            <div className="ac-range-video">
                              <video
                                ref={rangeVideo}
                                src={mediaSrc(path)}
                                controls
                                playsInline
                                preload="metadata"
                              />
                              <div className="ac-source-stat">
                                <span>
                                  {durationText(info.duration)} source
                                </span>
                                <span>
                                  {info.width} × {info.height}
                                </span>
                              </div>
                            </div>
                            <div className="ac-range-panel">
                              <h3>Analysis range</h3>
                              <p>
                                Choose the section to search for highlights.
                              </p>
                              <div className="ac-range-values">
                                {(["start", "end"] as const).map((k) => (
                                  <ClipTimeField
                                    key={k}
                                    label={
                                      k === "start" ? "Range in" : "Range out"
                                    }
                                    value={
                                      k === "start" ? rangeStart : rangeEnd
                                    }
                                    min={0}
                                    max={info.duration}
                                    onChange={(n) => boundary(k, n)}
                                  />
                                ))}
                              </div>
                              <div className="ac-range-controls">
                                {(["start", "end"] as const).map((k) => (
                                  <Slider
                                    key={k}
                                    label={
                                      k === "start"
                                        ? "Range start"
                                        : "Range end"
                                    }
                                    min={0}
                                    max={info.duration}
                                    step={0.1}
                                    value={
                                      k === "start" ? rangeStart : rangeEnd
                                    }
                                    unit="s"
                                    onChange={(n) => boundary(k, n)}
                                  />
                                ))}
                              </div>
                              <div className="ac-actions">
                                {info.duration > 600 && (
                                  <button
                                    disabled={info.duration <= 600}
                                    onClick={() =>
                                      changeRange(
                                        rangeStart,
                                        Math.min(
                                          info.duration,
                                          rangeStart + 600,
                                        ),
                                      )
                                    }
                                  >
                                    10-minute range
                                  </button>
                                )}
                              </div>
                              <div className="ac-range-total">
                                <strong>{durationText(rangeLength)}</strong>
                                <span>selected for analysis</span>
                              </div>
                            </div>
                          </div>
                        )}
                        {info && info.duration > 600 && <div className="ac-guidance">
                          <Clock3 size={18} />
                          <div>
                            <strong>
                              {rangeLength > 600
                                  ? "Longer sections take longer to process"
                                  : "A shorter section gets you to clips faster"}
                            </strong>
                            <p>
                              {info && info.duration >= 1200
                                  ? "For a 30–40 minute video, start with a 5–10 minute section. Set Start and End above to choose the part you want."
                                  : "About 5–10 minutes is a good starting point. Processing time depends on selected length, your PC and model."}
                              {rangeLength > 600
                                ? ` This selection scans about ${(rangeLength / 600).toFixed(1)}× as much footage as a 10-minute section.`
                                : ""}
                            </p>
                          </div>
                        </div>}
                      </div>
                    )}
                    {step === 1 && (
                      <div className="ac-find-step">
                        <div className="ac-section-heading">
                          <div>
                            <h3>Clip settings</h3>
                            <p>
                              Scanning {durationText(rangeLength)} from{" "}
                              {formatClipTime(rangeStart)}.
                            </p>
                          </div>
                          <button onClick={() => setStep(0)}>
                            Change section
                          </button>
                        </div>
                        <div className="ac-config-grid">
                          <label>
                            Clips
                            <input
                              type="number"
                              min={1}
                              max={6}
                              value={count}
                              onChange={(e) =>
                                setCount(
                                  Math.max(
                                    1,
                                    Math.min(6, Number(e.target.value) || 1),
                                  ),
                                )
                              }
                            />
                          </label>
                          <label>
                            Clip length (seconds)
                            <input
                              type="number"
                              min={3}
                              max={90}
                              value={length}
                              onChange={(e) =>
                                setLength(
                                  Math.max(
                                    3,
                                    Math.min(90, Number(e.target.value) || 10),
                                  ),
                                )
                              }
                            />
                          </label>
                          <SelectRow
                            label="Content"
                            value={mode}
                            options={["gaming", "auto", "talking", "reactions"]}
                            onChange={(v) => setMode(v as typeof mode)}
                          />
                        </div>
                        <div className="ac-option-cards">
                          <div className="ac-option">
                            <CheckRow
                              label="Auto CC"
                              checked={captions}
                              onChange={setCaptions}
                            />
                            <small>
                              Add timed captions to the selected clips.
                            </small>
                          </div>
                          <div className="ac-option">
                            <CheckRow
                              label="Natural endings"
                              checked={flexible}
                              onChange={setFlexible}
                            />
                            <small>
                              Allow a few extra seconds to finish a moment.
                            </small>
                          </div>
                        </div>
                        <details className="ac-advanced">
                          <summary>
                            <Settings2 size={15} />
                            Analysis & local tools
                          </summary>
                          <div className="ac-option">
                            <CheckRow
                              label="Detailed analysis"
                              checked={detailed}
                              onChange={setDetailed}
                            />
                            <small>
                              Scans every frame. Takes longer than the standard
                              scan.
                            </small>
                          </div>
                          <div className="ac-option">
                            <CheckRow
                              label="Local AI ranking"
                              checked={useAI}
                              disabled={!aiReady}
                              onChange={setUseAI}
                            />
                            <small>
                              Optional speech-based ranking on this PC.
                            </small>
                          </div>
                          <SelectRow
                            label="Language"
                            value={language}
                            options={["auto", "en", "hi"]}
                            optionLabels={{
                              auto: "Detect automatically",
                              en: "English",
                              hi: "Hindi",
                            }}
                            onChange={setLanguage}
                          />
                          {useAI && (
                            <label>
                              Look for
                              <input
                                value={instruction}
                                maxLength={500}
                                onChange={(e) => setInstruction(e.target.value)}
                                placeholder="Funny reactions, surprising moments, useful tips…"
                              />
                            </label>
                          )}
                          <div className="ac-tools">
                            {!ccReady ? (
                              <div>
                                <span>
                                  <strong>Offline Auto CC</strong>
                                  <small>
                                    Install once to caption clips on this PC.
                                  </small>
                                </span>
                                <button
                                  onClick={() => void install("captions")}
                                >
                                  <Download size={14} />
                                  Install Auto CC
                                </button>
                              </div>
                            ) : (
                              <div>
                                <span>Auto CC ready</span>
                                <Check size={16} />
                              </div>
                            )}
                            {!aiReady ? (
                              <div>
                                <span>
                                  <strong>Optional local AI</strong>
                                  <small>
                                    2.5 GB + 25 MB engine. Fast clipping works
                                    without it.
                                  </small>
                                </span>
                                <button onClick={() => void install("ai")}>
                                  <Download size={14} />
                                  Install local AI
                                </button>
                              </div>
                            ) : (
                              <div>
                                <span>Local AI ready</span>
                                <Check size={16} />
                              </div>
                            )}
                          </div>
                        </details>
                        {(captions || useAI) && !ccReady && (
                          <p className="ac-message">
                            Install Auto CC in “Analysis & local tools”, or turn
                            captions off for activity-only clipping.
                          </p>
                        )}
                      </div>
                    )}
                    {step === 2 && analysis && active && (
                      <div className="ac-review">

                        <div className="ac-review-main">
                          <AutoClipPreview
                            path={path}
                            audioTracks={source?.audioTracks}
                            analysis={analysis}
                            clip={active}
                            ratio={ratio}
                            split={split}
                            captions={captions}
                            captionOptions={captionOptions}
                            editRegion={editRegion}
                            content={template === "fit" ? FULL : content}
                            fit={template === "fit" ? "contain" : "cover"}
                            onRegion={(r, rect) =>
                              r === "camera"
                                ? setCamera(rect)
                                : setContent(rect)
                            }
                          />
                          <div className="ac-layout-bar">
                            <div
                              className="ac-segmented"
                              aria-label="Clip layout"
                            >
                              {(["stacked", "full", "fit"] as const).map(
                                (t) => (
                                  <button
                                    key={t}
                                    aria-pressed={template === t}
                                    onClick={() => {
                                      setTemplate(t);
                                      setEditRegion(null);
                                    }}
                                  >
                                    {t === "stacked"
                                      ? "Camera + gameplay"
                                      : t === "full"
                                        ? "Full portrait"
                                        : "Fit whole video"}
                                  </button>
                                ),
                              )}
                            </div>
                            <button
                              aria-pressed={editRegion !== null}
                              onClick={() =>
                                setEditRegion(
                                  editRegion
                                    ? null
                                    : template === "stacked"
                                      ? "camera"
                                      : "content",
                                )
                              }
                            >
                              <Settings2 size={14} />
                              {editRegion
                                ? "Done editing layout"
                                : "Edit layout"}
                            </button>
                          </div>
                          {editRegion && (
                            <div className="ac-layout-editor">
                              <div className="ac-actions">
                                {template === "stacked" && (
                                  <button
                                    aria-pressed={editRegion === "camera"}
                                    onClick={() => setEditRegion("camera")}
                                  >
                                    Camera region
                                  </button>
                                )}
                                <button
                                  aria-pressed={editRegion === "content"}
                                  onClick={() => setEditRegion("content")}
                                >
                                  Gameplay region
                                </button>
                                <button
                                  onClick={() => {
                                    setCamera(analysis.facecam ?? FACE);
                                    setContent(FULL);
                                    setFraction(0.38);
                                  }}
                                >
                                  Reset framing
                                </button>
                              </div>
                              {template === "stacked" && (
                                <Slider
                                  label="Camera height"
                                  min={20}
                                  max={60}
                                  value={fraction * 100}
                                  unit="%"
                                  onChange={(n) => setFraction(n / 100)}
                                />
                              )}
                              <p className="ac-help">
                                Drag the output preview to position the picture.
                                Use source boxes to choose or resize a region.
                              </p>
                            </div>
                          )}
                          <div className="ac-review-settings">
                            <fieldset>
                              <legend>Trim selected clip</legend>
                              <div className="ac-config-grid">
                                {(["start", "end"] as const).map((k) => (
                                  <ClipTimeField
                                    key={k}
                                    label={
                                      k === "start" ? "Clip in" : "Clip out"
                                    }
                                    min={rangeStart}
                                    max={rangeEnd}
                                    value={active[k]}
                                    onChange={(n) =>
                                      setCandidates((old) =>
                                        old.map((c) =>
                                          c.id !== active.id
                                            ? c
                                            : k === "start"
                                              ? {
                                                  ...c,
                                                  start: Math.min(
                                                    c.end - 0.1,
                                                    Math.max(
                                                      rangeStart,
                                                      c.end - 93,
                                                      n,
                                                    ),
                                                  ),
                                                }
                                              : {
                                                  ...c,
                                                  end: Math.min(
                                                    rangeEnd,
                                                    c.start + 93,
                                                    Math.max(c.start + 0.1, n),
                                                  ),
                                                },
                                        ),
                                      )
                                    }
                                  />
                                ))}
                              </div>
                            </fieldset>
                            <fieldset>
                              <legend>Captions</legend>
                              <CheckRow
                                label="Auto CC"
                                checked={captions}
                                onChange={setCaptions}
                              />
                              <div className="ac-config-grid">
                                <SelectRow
                                  label="Words per caption"
                                  value={String(captionOptions.words)}
                                  options={["2", "3", "4"]}
                                  onChange={(v) =>
                                    setCaptionOptions((o) => ({
                                      ...o,
                                      words: Number(v),
                                    }))
                                  }
                                />
                                <SelectRow
                                  label="Caption position"
                                  value={
                                    captionOptions.y === undefined
                                      ? "auto"
                                      : "bottom"
                                  }
                                  options={["auto", "bottom"]}
                                  optionLabels={{
                                    auto: "Automatic",
                                    bottom: "Lower safe area",
                                  }}
                                  onChange={(v) =>
                                    setCaptionOptions((o) => ({
                                      ...o,
                                      y: v === "auto" ? undefined : 0.8,
                                    }))
                                  }
                                />
                              </div>
                              <CheckRow
                                label="Highlight spoken word"
                                checked={captionOptions.highlight}
                                onChange={(v) =>
                                  setCaptionOptions((o) => ({
                                    ...o,
                                    highlight: v,
                                  }))
                                }
                              />
                            </fieldset>
                          </div>
                          <fieldset className="ac-output-formats">
                            <legend>Output formats</legend>
                            {RATIOS.map((r) => (
                              <button
                                type="button"
                                key={r}
                                aria-pressed={formats.includes(r)}
                                onClick={() => {
                                  setFormats((old) =>
                                    old.includes(r)
                                      ? old.filter((v) => v !== r)
                                      : [...old, r],
                                  );
                                  setRatio(r);
                                }}
                              >
                                <span
                                  className="ac-ratio-art"
                                  style={{ aspectRatio: r.replace(":", "/") }}
                                />
                                {r}
                                {formats.includes(r) && <Check size={13} />}
                              </button>
                            ))}
                          </fieldset>
                          <p className="ac-help">
                            Captions follow the final cuts; prepared speech is
                            reused. Preview suggestions before creating clips.
                          </p>
                        </div>
                        <aside className="ac-candidates">
                          <div>
                            <h3>Suggested moments</h3>
                            <small>{selected.length} selected</small>
                          </div>
                          <MomentStrip>{candidates.slice(0, 16).map((c) => (
                            <article
                              key={c.id}
                              className={active.id === c.id ? "active" : ""}
                            >
                              <button
                                type="button"
                                className="ac-candidate-select"
                                aria-label={`Select ${c.title}`}
                                aria-pressed={selected.includes(c.id)}
                                disabled={
                                  !selected.includes(c.id) &&
                                  selected.length >= 6
                                }
                                onClick={() =>
                                  setSelected((old) =>
                                    old.includes(c.id)
                                      ? old.filter((id) => id !== c.id)
                                      : [...old, c.id],
                                  )
                                }
                              >
                                {selected.includes(c.id) && <Check size={12} />}
                              </button>
                              <button onClick={() => reviewMoment(c.id)} aria-label={`Preview ${c.title}`}>
                                  <span
                                    className="ac-thumbnail"
                                    aria-hidden="true"
                                    style={atlas ? {
                                      backgroundImage: `url("${atlas}")`,
                                      backgroundPosition: `${(Math.min(9, Math.floor(((c.start + c.end) / 2 / analysis.duration) * 10)) / 9) * 100}% center`,
                                    } : undefined}
                                  />
                                <strong>{c.title}</strong>
                                <small>
                                  {formatClipTime(c.start)} ·{" "}
                                  {(c.end - c.start).toFixed(1)}s
                                </small>
                                <span>{c.reason}</span>
                              </button>
                            </article>
                          ))}</MomentStrip>
                        </aside>
                      </div>
                    )}
                  </>
                )}
                {error && (
                  <p role="alert" className="ac-message ac-error">
                    {error}
                  </p>
                )}
                {notice && (
                  <p role="status" className="ac-message">
                    {notice}
                  </p>
                )}
                {analysis?.warnings.map((w) => (
                  <p className="ac-message" key={w}>
                    {w}
                  </p>
                ))}
                {created.length > 0 && (
                  <div className="ac-saved">
                    <h3>Created clips</h3>
                    <p className="ac-help">
                      Open a clip to edit it. Use Original timeline in the
                      editor to return to this project.
                    </p>
                    {created.map((c) => (
                      <button
                        disabled={disabled}
                        key={c.path}
                        onClick={() => void openCreated(c)}
                      >
                        <span>{c.name}</span>Open in editor
                        <ChevronRight size={14} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <footer className="ac-footer">
              <span>
                <Clock3 size={14} />
                {info
                  ? `${durationText(rangeLength)} selected`
                  : "Local processing"}
              </span>
              <div>
                <button disabled={disabled} onClick={onClose}>
                  {created.length ? "Done" : "Close"}
                </button>
                {step > 0 && !busy && (
                  <button onClick={() => setStep(step - 1)}>
                    <ChevronLeft size={14} />
                    Back
                  </button>
                )}
                {step === 0 ? (
                  <button
                    className="ac-primary"
                    disabled={disabled || !validRange}
                    onClick={() => {
                      rangeVideo.current?.pause();
                      setStep(1);
                    }}
                  >
                    Continue
                    <ChevronRight size={15} />
                  </button>
                ) : step === 1 ? (
                  <button
                    className="ac-primary"
                    disabled={
                      disabled ||
                      !validRange ||
                      ((captions || useAI) && !ccReady)
                    }
                    onClick={() => void analyze()}
                  >
                    <Scissors size={15} />
                    Find clips
                  </button>
                ) : created.length ? (
                  <button
                    className="ac-primary"
                    disabled={disabled}
                    onClick={() => void openCreated(created[0])}
                  >
                    {created.length > 1 ? "Edit first clip" : "Edit clip"}
                    <ChevronRight size={15} />
                  </button>
                ) : (
                  <button
                    className="ac-primary"
                    disabled={
                      disabled ||
                      !selected.length ||
                      !formats.length ||
                      (captions && !ccReady)
                    }
                    onClick={() => void create()}
                  >
                    Create {selected.length * formats.length} clips
                    <ChevronRight size={15} />
                  </button>
                )}
              </div>
            </footer>
          </section>
        </div>
      )}
      {showLink && (
        <LinkImportDialog
          actionLabel="Download for Auto Clips"
          onClose={() => setShowLink(false)}
          onBusy={() => {}}
          onImported={async (next) => {
            setExtras((old) => [
              ...old,
              { path: next, name: next.split(/[\\/]/).pop() ?? "Linked video" },
            ]);
            setPath(next);
          }}
        />
      )}
    </>
  );
}
