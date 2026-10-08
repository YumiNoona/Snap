import { editLayerAtTime, moveLayerGroup } from "../../lib/layerAnimation";
import { userError } from "../../lib/userError";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { MorphIcon } from "morphicons/react";
import { Square as SquareIcon, Minimize2 as RestoreIcon } from "lucide";
import { ChevronLeft, Upload, Minus, X, Frame, Box, MousePointer2, Layers3, Focus, AudioLines, Save, SaveAll, FolderOpen, File, Captions, Sun, Moon, Library, Maximize2, Minimize2, Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Keyboard, Camera, Command, Activity, Snowflake, Image as ImageIcon, Search } from "lucide-react";
import Preview from "./Preview/index";
import Timeline from "./Timeline/index";
import Panels from "./Panels/index";
import ExportModal from "./ExportModal";
import DonateButton from "../shared/DonateButton";
import type { ActionEventEdit, AudioTrack, CaptionTrack, CaptionSegmentSelection, EditorConfig, Keyframe, ExportSettings, ImageLayer, Layer, ZoomRegionSelection, ZoomRegionSettings } from "../../lib/types";
import { DEFAULT_EDITOR_CONFIG, getMovementDuration } from "../../lib/types";
import { runCanvasExport } from "../../lib/canvasExport";
import { collectZoomRegions, findZoomRegion } from "../../lib/zoomRegions";
import { useEditorHistory } from "./hooks/useEditorHistory";
import { useProjectPersistence } from "./hooks/useProjectPersistence";
import { usePlaybackController } from "./hooks/usePlaybackController";
import { discoverAudioTracks, findAvailableCaptionStart, mergeAudioTracks } from "../../lib/captions";
import { loadProjectAtPath } from "../../lib/project";
import { recordingDataPaths } from "../../lib/recordingPaths";
import { trimEndAfterDurationChange } from "../../lib/playbackTransport";
import { clearInputLogCache, loadInputLog } from "../../lib/inputLog";
import { clearImageAssets } from "../../lib/canvasDraw";
import { buildDeliveryPackage } from "../../lib/deliveryPackage";
import { retainedClips, sequenceDuration } from "../../lib/videoEditing";
import "./Editor.css";

interface Props {
  videoPath: string;
  inputLogPath: string;
  initialProjectPath?: string;
  onOpenProject?: (projectPath: string, videoPath: string, inputLogPath: string) => void;
  onClose: () => void;
}

export type SidebarToolTab = "uploads" | "canvas" | "tilt" | "cursor" | "actions" | "camera" | "annotations" | "motion" | "captions" | "audio";

const HOTSPOTS_STORAGE_KEY = "snap.cursorHotspots";
const EDITOR_THEME_STORAGE_KEY = "snap.editorTheme.v1";

function loadCursorHotspots(): Record<string, { x: number; y: number }> {
  try {
    return JSON.parse(localStorage.getItem(HOTSPOTS_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

export default function Editor({ videoPath, inputLogPath, initialProjectPath = "", onOpenProject, onClose }: Props) {
  const isBrowserPreview =
    import.meta.env.DEV && new URLSearchParams(window.location.search).get("preview") === "1";
  const [config, setConfig] = useState<EditorConfig>(() => ({
    ...DEFAULT_EDITOR_CONFIG,
    cursorHotspots: loadCursorHotspots(),
  }));
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const [captionTracks, setCaptionTracks] = useState<CaptionTrack[]>([]);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [audioError, setAudioError] = useState("");
  const [cameraMedia, setCameraMedia] = useState<{ path: string; startOffsetMs: number } | null>(null);
  const metadataDurationRef = useRef(0);
  const [duration, setDuration] = useState(isBrowserPreview ? 21.44 : 0);
  const [exportStatus, setExportStatus] = useState("");
  const [activeTool, setActiveTool] = useState<SidebarToolTab | null>(null);
  const [previewFocusMode, setPreviewFocusMode] = useState(false);
  const [previewMuted, setPreviewMuted] = useState(false);
  const [previewVolume, setPreviewVolume] = useState(100);
  const [previewControlsVisible, setPreviewControlsVisible] = useState(true);
  const [cropMode, setCropMode] = useState(false);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [selectedZoomRegion, setSelectedZoomRegion] = useState<ZoomRegionSelection | null>(null);
  const [selectedCaption, setSelectedCaption] = useState<CaptionSegmentSelection | null>(null);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [editorTheme, setEditorTheme] = useState<"dark" | "light">(() => localStorage.getItem(EDITOR_THEME_STORAGE_KEY) === "light" ? "light" : "dark");
  const [zoomTargetMode, setZoomTargetMode] = useState(false);
  const [autoZoomRevision, setAutoZoomRevision] = useState(0);
  const [zoomProposal, setZoomProposal] = useState<Keyframe[] | null>(null);
  const [compareZoom, setCompareZoom] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandIndex, setCommandIndex] = useState(0);
  const [showProjectHealth, setShowProjectHealth] = useState(false);
  const [fileActionStatus, setFileActionStatus] = useState("");
  const [exportProgress, setExportProgress] = useState(0);
  const [lastExportPath, setLastExportPath] = useState("");
  const [isMaximized, setIsMaximized] = useState(false);
  const appWindow = useMemo(() => isBrowserPreview ? null : getCurrentWindow(), [isBrowserPreview]);
  const fileMenuRef = useRef<HTMLDivElement | null>(null);
  const manualTargetRangeRef = useRef<ZoomRegionSelection | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const previewControlsTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (isBrowserPreview || duration > 0) return;
    let cancelled = false;
    void invoke<number>("probe_media_duration", { path: videoPath })
      .then((probedDuration) => {
        if (cancelled || !Number.isFinite(probedDuration) || probedDuration <= 0) return;
        const previous = metadataDurationRef.current;
        metadataDurationRef.current = probedDuration;
        setDuration(probedDuration);
        setConfig((current) => {
          const trimEnd = trimEndAfterDurationChange(current.trimEnd, previous, probedDuration);
          return trimEnd === current.trimEnd ? current : { ...current, trimEnd };
        });
      })
      .catch((error) => setAudioError((current) => current || `Could not read video duration: ${userError(error)}`));
    return () => { cancelled = true; };
  }, [duration, isBrowserPreview, videoPath]);

  useEffect(() => {
    localStorage.setItem(EDITOR_THEME_STORAGE_KEY, editorTheme);
  }, [editorTheme]);

  // The file menu and floating tool inspector occupy the same left-side
  // workspace. Keep them mutually exclusive so neither can cover the other.
  useEffect(() => {
    if (activeTool) setShowFileMenu(false);
  }, [activeTool]);
  const { undo, redo, replaceWithoutHistory, canUndo, canRedo } = useEditorHistory({
    config, keyframes, captions: captionTracks, audioTracks, setAudioTracks, setConfig, setKeyframes, setCaptions: setCaptionTracks,
  });
  useEffect(()=>()=>{void invoke("cancel_editor_cached_media").catch(()=>{});},[videoPath]);
  const [sourceFrameRate,setSourceFrameRate]=useState(30);
  useEffect(()=>{let cancelled=false;setSourceFrameRate(30);void invoke<number>("editor_source_frame_rate",{path:videoPath}).then(rate=>{if(!cancelled&&Number.isFinite(rate))setSourceFrameRate(rate);}).catch(()=>{});return ()=>{cancelled=true;};},[videoPath]);
  const { currentTime, audioDurations, activeClipId, sequencePosition, seekSequence, playing, playbackStatus, setMediaElement, togglePlay, pausePlayback, seekTo } = usePlaybackController({
    videoPath, trimStart: config.trimStart, trimEnd: config.trimEnd, duration,
    frameRate: sourceFrameRate, playbackRate: config.playbackRate, audioTracks, audioMix: config.audio, previewMuted, previewVolume, videoClips: config.videoClips,
  });
  const footageClips = useMemo(() => retainedClips(config.videoClips, config.trimStart, config.trimEnd || duration), [config.videoClips, config.trimStart, config.trimEnd, duration]);
  const editedDuration = sequenceDuration(footageClips) / (config.playbackRate || 1);

  const decorateRestoredConfig = useCallback((restored: EditorConfig): EditorConfig => ({
    ...restored,
    cursorHotspots: { ...restored.cursorHotspots, ...loadCursorHotspots() },
  }), []);
  const {
    projectReady, hasSavedProject, projectStatus, projectDirty, projectSaving, projectPath,
    saveProjectNow, saveProjectAs,
  } = useProjectPersistence({
    disabled: isBrowserPreview,
    videoPath,
    inputLogPath,
    initialProjectPath,
    duration,
    config,
    keyframes,
    captions: captionTracks,
    audioTracks,
    restore: replaceWithoutHistory,
    restoreAudioTracks: (saved) => setAudioTracks((current) => current.length > 0 ? mergeAudioTracks(current, saved) : saved),
    decorateRestoredConfig,
  });

  const handleSaveProject = useCallback(async () => {
    try {
      await saveProjectNow();
      setFileActionStatus("Project saved");
      setShowFileMenu(false);
    } catch (error) {
      setFileActionStatus(`Could not save project: ${userError(error)}`);
    }
  }, [saveProjectNow]);

  const handleSaveProjectAs = useCallback(async () => {
    try {
      const selected = await saveDialog({
        title: "Save Snap Project As",
        defaultPath: videoPath.replace(/\.[^\\/.]+$/, ".snap"),
        filters: [{ name: "Snap Project", extensions: ["snap"] }],
      });
      if (!selected) return;
      const target = selected.toLowerCase().endsWith(".snap") ? selected : `${selected}.snap`;
      await saveProjectAs(target);
      setFileActionStatus(`Saved as ${target.split(/[\\/]/).pop()}`);
      setShowFileMenu(false);
    } catch (error) {
      setFileActionStatus(`Could not save project: ${userError(error)}`);
    }
  }, [saveProjectAs, videoPath]);

  const handleOpenProject = useCallback(async () => {
    try {
      if (projectDirty) await saveProjectNow();
      const selected = await openDialog({
        title: "Open Snap Project",
        multiple: false,
        directory: false,
        filters: [{ name: "Snap Project", extensions: ["snap", "json"] }],
      });
      if (!selected || Array.isArray(selected)) return;
      const project = await loadProjectAtPath(selected);
      if (!project) throw new Error("The selected project no longer exists");
      pausePlayback();
      setShowFileMenu(false);
      onOpenProject?.(selected, project.media.videoPath, project.media.inputLogPath);
    } catch (error) {
      setFileActionStatus(`Could not open project: ${userError(error)}`);
    }
  }, [onOpenProject, pausePlayback, projectDirty, saveProjectNow]);

  useEffect(() => {
    if (!appWindow || !projectReady) return;
    let committingClose = false;
    const unlisten = appWindow.onCloseRequested(async (event) => {
      if (committingClose) return;
      event.preventDefault();
      if (exportAbortRef.current) {
        setFileActionStatus("Cancel the active export before closing the editor");
        setShowExport(true);
        return;
      }
      committingClose = true;
      try {
        await saveProjectNow();
        await appWindow.close();
      } catch (error) {
        committingClose = false;
        setFileActionStatus(`Could not save before closing: ${userError(error)}`);
        setShowFileMenu(true);
      }
    });
    return () => { void unlisten.then((stop) => stop()); };
  }, [appWindow, projectReady, saveProjectNow]);

  useEffect(() => () => exportAbortRef.current?.abort(), []);

  useEffect(() => {
    if (isBrowserPreview) return;
    let requestId: string | null = null;
    let disposed = false;
    const resume = listen("recording-resuming", () => { requestId = null; });
    const unlisten = listen<string>("recording-starting", ({ payload }) => {
      requestId = payload;
      pausePlayback();
      void (async () => {
        try {
          if (exportAbortRef.current) throw new Error("Finish or cancel the export before recording");
          await saveProjectNow();
          if (disposed || requestId !== payload) return;
          window.dispatchEvent(new CustomEvent("snap-suspend-editor", { detail: projectPath }));
          clearInputLogCache();
          clearImageAssets();
          await emit("editor-suspended", { requestId: payload, ready: true });
        } catch (error) {
          console.error("[Snap] Could not save before recording:", error);
          if (!disposed && requestId === payload) await emit("editor-suspended", { requestId: payload, ready: false });
        }
      })();
    });
    return () => { disposed = true; void unlisten.then((stop) => stop()); void resume.then((stop) => stop()); };
  }, [isBrowserPreview, pausePlayback, projectPath, saveProjectNow]);

  useEffect(() => {
    let cancelled = false;
    setAudioError("");
    void discoverAudioTracks(videoPath).then((discovered) => {
      if (cancelled) return;
      setAudioTracks((current) => mergeAudioTracks(discovered, current));
    }).catch((error) => {
      if (!cancelled) setAudioError(`Audio could not be loaded: ${userError(error)}`);
    });
    return () => { cancelled = true; };
  }, [videoPath]);

  const addAudioSources = useCallback(async (sources: string[]) => {
    setAudioError("");
    try {
      if (sources.length === 0) return;
      const additions = await Promise.all(sources.map(async (source, index): Promise<AudioTrack> => {
        const path = await invoke<string>("import_audio_file", { videoPath, sourcePath: source });
        const label = source.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || `Audio ${index + 1}`;
        return {
          id: `audio-imported-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
          kind: "imported",
          path,
          label,
          muted: false,
          volume: 1,
          linked: false,
          start: 0,
        };
      }));
      setAudioTracks((current) => {
        const known = new Set(current.map((track) => track.path.toLowerCase()));
        return [...current, ...additions.filter((track) => !known.has(track.path.toLowerCase()))];
      });
      setActiveTool("audio");
    } catch (error) {
      setAudioError(`Audio could not be added: ${userError(error)}`);
    }
  }, [videoPath]);

  const addMediaToTimeline = useCallback((paths: string[], atTime = currentTime) => {
    const audio = paths.filter((path) => /\.(wav|mp3|m4a|aac|flac|ogg|opus|wma)$/i.test(path));
    if (audio.length) void addAudioSources(audio);
    const visuals = paths.filter((path) => /\.(png|jpe?g|webp|bmp|gif|mp4|mov|mkv|webm)$/i.test(path));
    if (!visuals.length) return;
    const projectEnd = config.trimEnd || duration || atTime + 3;
    const start = Math.max(config.trimStart, Math.min(atTime, Math.max(config.trimStart, projectEnd - .2)));
    const end = Math.min(projectEnd, start + 3);
    const additions: Layer[] = visuals.map((path, index) => {
      const type = /\.(mp4|mov|mkv|webm)$/i.test(path) ? "video" as const : "image" as const;
      return {
      id: `${type}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
      type, path, fit: "contain", cornerRadius: 10,
      start, end: Math.max(start + .2, end),
      x: .25 + (index % 3) * .035, y: .2 + (index % 3) * .035, w: .5, h: .5,
      opacity: 1, rotation: 0, flipX: false, flipY: false,
    }; });
    setConfig((current) => ({ ...current, layers: [...current.layers, ...additions] }));
    setSelectedLayerId(additions[additions.length - 1].id);
    setSelectedCaption(null);
    setSelectedZoomRegion(null);
    setActiveTool("annotations");
  }, [addAudioSources, config.trimEnd, config.trimStart, currentTime, duration]);

  useEffect(() => {
    if (isBrowserPreview || !appWindow) return;
    const unlisten = appWindow.onDragDropEvent(async ({ payload }) => {
      if (payload.type !== "drop" || payload.paths.length === 0) return;
      const scale = await appWindow.scaleFactor();
      const clientX = payload.position.x / scale;
      const clientY = payload.position.y / scale;
      const target = document.elementFromPoint(clientX, clientY);
      if (target?.closest(".uploads-drawer-content")) {
        window.dispatchEvent(new CustomEvent<string[]>("snap-import-media", { detail: payload.paths }));
        return;
      }
      const timeline = target?.closest<HTMLElement>(".ss-timeline-col");
      if (timeline && duration > 0) {
        const rect = timeline.getBoundingClientRect();
        const at = Math.max(0, Math.min(duration, (clientX - rect.left) / rect.width * duration));
        addMediaToTimeline(payload.paths, at);
      }
    });
    return () => { void unlisten.then((stop) => stop()); };
  }, [addMediaToTimeline, appWindow, duration, isBrowserPreview]);

  const handleAddAudio = useCallback(async () => {
    const selected = await openDialog({
      multiple: true,
      title: "Add audio to the timeline",
      filters: [{ name: "Audio", extensions: ["wav", "mp3", "m4a", "aac", "flac", "ogg", "opus", "wma", "webm"] }],
    });
    const sources = typeof selected === "string" ? [selected] : selected ?? [];
    await addAudioSources(sources);
  }, [addAudioSources]);

  const addManualCaptionAt = useCallback((atSeconds: number) => {
    const now = Date.now();
    const startMs = Math.max(Math.round(config.trimStart * 1000), Math.round(atSeconds * 1000));
    const projectEndMs = Math.round((config.trimEnd || duration || atSeconds + 2.5) * 1000);
    const endMs = Math.max(startMs + 300, Math.min(projectEndMs, startMs + 2_500));
    const segmentId = `caption-manual-${now}`;
    const target = captionTracks[0];
    if (target) {
      setCaptionTracks(captionTracks.map((track) => track.id === target.id ? {
        ...track,
        segments: [...track.segments, { id: segmentId, startMs, endMs, text: "New caption", language: track.language || "en", sourceTrackIds: [], userEdited: true }].sort((a, b) => a.startMs - b.startMs),
      } : track));
      setSelectedCaption({ trackId: target.id, segmentId });
    } else {
      const trackId = `captions-manual-${now}`;
      setCaptionTracks([{
        id: trackId,
        name: "Manual captions",
        language: "en",
        sourceTrackIds: [],
        visible: true,
        burnedIn: true,
        style: {
          fontFamily: "Segoe UI Variable", fontSize: 42, fontWeight: 700, color: "#ffffff",
          backgroundColor: "#171717", backgroundEnabled: true, outlineColor: "#000000", outlineWidth: 2,
          shadow: true, align: "center", x: .5, y: .86, maxWidth: .82,
          fontStyle: "normal", letterSpacing: 0, lineHeight: 1.22,
          backgroundRadius: .18, backgroundPadding: .4, shadowBlur: .18,
          animation: "none", animationDurationMs: 0,
        },
        segments: [{ id: segmentId, startMs, endMs, text: "New caption", language: "en", sourceTrackIds: [], userEdited: true }],
      }]);
      setSelectedCaption({ trackId, segmentId });
    }
    setActiveTool("captions");
    pausePlayback();
    seekTo(startMs / 1000 + .01);
  }, [captionTracks, config.trimEnd, config.trimStart, duration, pausePlayback, seekTo]);

  useEffect(() => {
    if (isBrowserPreview) return;
    let cancelled = false;
    const dataDir = recordingDataPaths(videoPath).dataDir;
    void Promise.all([
      invoke<Array<{ name: string; path: string; is_dir: boolean }>>("list_directory", { path: dataDir }),
      invoke<string | null>("read_optional_text_file", { path: `${dataDir}\\camera.json` }),
    ]).then(([files, metadataText]) => {
      if (cancelled) return;
      const camera = files.find((file) => !file.is_dir && file.name.toLowerCase() === "camera.mp4");
      if (!camera) {
        setCameraMedia(null);
        return;
      }
      let startOffsetMs = 0;
      try {
        startOffsetMs = Math.max(0, Number(JSON.parse(metadataText || "{}").startOffsetMs) || 0);
      } catch {}
      setCameraMedia({ path: camera.path, startOffsetMs });
    }).catch(() => { if (!cancelled) setCameraMedia(null); });
    return () => { cancelled = true; };
  }, [isBrowserPreview, videoPath]);


  // Persist per-pack cursor hotspot nudges across sessions
  useEffect(() => {
    try {
      localStorage.setItem(HOTSPOTS_STORAGE_KEY, JSON.stringify(config.cursorHotspots));
    } catch {
      // ignore storage errors
    }
  }, [config.cursorHotspots]);

  useEffect(() => {
    if (!showFileMenu) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!fileMenuRef.current?.contains(event.target as Node)) setShowFileMenu(false);
    };
    window.addEventListener("pointerdown", closeOnOutsideClick);
    return () => window.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [showFileMenu]);

  useEffect(() => {
    if (isBrowserPreview) return;
    const onProjectShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        if (event.shiftKey) void handleSaveProjectAs();
        else void handleSaveProject();
      } else if (key === "o" && !event.shiftKey) {
        event.preventDefault();
        void handleOpenProject();
      }
    };
    window.addEventListener("keydown", onProjectShortcut);
    return () => window.removeEventListener("keydown", onProjectShortcut);
  }, [handleOpenProject, handleSaveProject, handleSaveProjectAs, isBrowserPreview]);

  useEffect(() => {
    const onCommandKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault(); setShowCommandPalette((open) => !open); setCommandQuery("");
      } else if (event.key === "Escape") {
        setShowCommandPalette(false); setShowProjectHealth(false);
      }
    };
    window.addEventListener("keydown", onCommandKey);
    return () => window.removeEventListener("keydown", onCommandKey);
  }, []);

  const handleToggleCrop = useCallback(() => setCropMode((m) => !m), []);

  const extractFrame = useCallback(async (purpose: "freeze" | "thumbnail") => {
    pausePlayback();
    const stamp = Math.round(currentTime * 1000);
    let outputPath = `${recordingDataPaths(videoPath).dataDir}\\${purpose}-${stamp}.png`;
    if (purpose === "thumbnail") {
      const selected = await saveDialog({ title: "Save thumbnail", defaultPath: videoPath.replace(/\.[^\\/.]+$/i, `-thumbnail-${stamp}.png`), filters: [{ name: "PNG image", extensions: ["png"] }] });
      if (!selected) return;
      outputPath = selected.toLowerCase().endsWith(".png") ? selected : `${selected}.png`;
    }
    const path = await invoke<string>("extract_video_frame", { inputPath: videoPath, outputPath, timeSeconds: currentTime });
    if (purpose === "freeze") {
      const end = Math.min(config.trimEnd || duration, currentTime + 2.5);
      const layer: ImageLayer = { id: `freeze-${Date.now()}`, type: "image", path, fit: "cover", start: currentTime, end: Math.max(currentTime + .25, end), x: 0, y: 0, w: 1, h: 1, opacity: 1, rotation: 0, flipX: false, flipY: false, cornerRadius: 0 };
      setConfig((current) => ({ ...current, layers: [...current.layers, layer] }));
      setSelectedLayerId(layer.id); setActiveTool("annotations");
    } else {
      setFileActionStatus(`Thumbnail saved: ${path.split(/[\\/]/).pop()}`);
    }
  }, [config.trimEnd, currentTime, duration, pausePlayback, videoPath]);

  const snapLayerToAction = useCallback(async (layerId: string) => {
    if (!inputLogPath) return;
    const log = await loadInputLog(inputLogPath);
    const candidates = log.clickEvents.length ? log.clickEvents : log.mouseMoveEvents;
    const targetMs = currentTime * 1000;
    const event = candidates.reduce<typeof candidates[number] | null>((best, candidate) => Math.abs(candidate.ts - targetMs) < Math.abs((best?.ts ?? Number.POSITIVE_INFINITY) - targetMs) ? candidate : best, null);
    if (!event || event.x == null || event.y == null) return;
    const x = log.region ? (event.x - log.region.x) / log.region.w : event.x;
    const y = log.region ? (event.y - log.region.y) / log.region.h : event.y;
    setConfig((current) => current.lockedTracks?.includes("annotations") ? current : ({ ...current, layers: current.layers.map((layer) => layer.id === layerId ? { ...layer, x: Math.max(0, Math.min(1 - layer.w, x - layer.w / 2)), y: Math.max(0, Math.min(1 - layer.h, y - layer.h / 2)) } : layer) }));
  }, [currentTime, inputLogPath]);

  const handleCropApply = useCallback(
    (crop: { x: number; y: number; w: number; h: number } | null) => {
      setConfig((c) => ({ ...c, crop }));
      setCropMode(false);
    },
    []
  );

  const handleCropCancel = useCallback(() => setCropMode(false), []);

  const zoomLocked=config.lockedTracks?.includes("zoom")??false;
  const applyKeyframes=useCallback((frames:Keyframe[])=>{if(!zoomLocked)setKeyframes(frames);},[zoomLocked,setKeyframes]);
  const applyConfigEdit=(next:EditorConfig)=>setConfig(current=>{
    const locked=(id:string)=>current.lockedTracks?.includes(id)&&next.lockedTracks?.includes(id);
    return {...next,layers:locked("annotations")?current.layers:next.layers,videoClips:locked("video")?current.videoClips:next.videoClips,trimStart:locked("video")?current.trimStart:next.trimStart,trimEnd:locked("video")?current.trimEnd:next.trimEnd,actionOverlay:locked("action")?current.actionOverlay:next.actionOverlay};
  });

  const handleTrimStart = (t: number) => {
    if(config.lockedTracks?.includes("video"))return;
    setConfig({ ...config, trimStart: t });
    if (currentTime < t) seekTo(t);
  };

  const handleTrimEnd = (t: number) => {
    if(config.lockedTracks?.includes("video"))return;
    setConfig({ ...config, trimEnd: t });
    if (currentTime > t) seekTo(t);
  };

  const handleExport = async (settings: ExportSettings) => {
    if (exportAbortRef.current) return;
    try {
      const selected = await saveDialog({ title: "Export video", defaultPath: settings.outputPath, filters: [{ name: settings.format.toUpperCase(), extensions: [settings.format] }] });
      if (!selected) return;
      settings = { ...settings, outputPath: selected };
      if (selected.toLowerCase() === videoPath.toLowerCase()) throw new Error("Choose a different filename to preserve your source recording");
      const abortController = new AbortController();
      exportAbortRef.current = abortController;
      setExportStatus("Exporting...");
      setExportProgress(0);
      setLastExportPath("");
      const result = await runCanvasExport(
        videoPath,
        inputLogPath,
        keyframes,
        config,
        captionTracks,
        audioTracks,
        cameraMedia,
        settings,
        config.trimStart,
        config.trimEnd > 0 ? config.trimEnd : duration,
        (p) => {
          if (p.phase === "recording") {
            setExportStatus("Exporting...");
            setExportProgress(p.progress);
          } else if (p.phase === "finalizing") {
            setExportStatus("Finalizing...");
            setExportProgress(0.98);
          }
        },
        abortController.signal
      );
      setExportProgress(1);
      setLastExportPath(settings.outputPath);
      if (settings.deliveryPackage) {
        try {
          await invoke("write_delivery_package", {
            outputPath: settings.outputPath,
            ...buildDeliveryPackage(captionTracks, keyframes, config.trimStart, config.trimEnd || duration, config.playbackRate, config.videoClips),
          });
        } catch (error) {
          console.error("[Snap] Delivery package failed:", error);
          setExportStatus("Done — video saved; delivery package could not be completed. Export again to retry.");
          return;
        }
      }
      setExportStatus("Done — export saved");
      void result;
    } catch (e) {
      setExportStatus(e instanceof DOMException && e.name === "AbortError" ? "Export cancelled" : `Export failed: ${userError(e)}`);
    } finally {
      exportAbortRef.current = null;
    }
  };

  const handleCancelExport = useCallback(() => {
    exportAbortRef.current?.abort();
    setExportStatus("Cancelling export...");
  }, []);

  const getOccupiedZoomRanges = useCallback((frames: Keyframe[], timelineEndMs: number) => {
    return collectZoomRegions(frames, timelineEndMs).map(({ startMs, endMs }) => ({ startMs, endMs }));
  }, []);

  const resolvedSelectedZoom = useMemo(
    () => findZoomRegion(keyframes, selectedZoomRegion, Math.round((config.trimEnd || duration) * 1000)),
    [config.trimEnd, duration, keyframes, selectedZoomRegion]
  );

  const updateSelectedZoom = useCallback((patch: Partial<ZoomRegionSettings>) => {
    if(config.lockedTracks?.includes("zoom"))return;
    const region = resolvedSelectedZoom;
    if (!region) return;
    const timelineStartMs = Math.round(config.trimStart * 1000);
    const timelineEndMs = Math.round((config.trimEnd || duration) * 1000);
    const startMs = Math.max(timelineStartMs, Math.min(patch.startMs ?? region.startMs, region.endMs - 350));
    const endMs = Math.min(timelineEndMs, Math.max(patch.endMs ?? region.endMs, startMs + 350));
    const oldDuration = Math.max(1, region.endMs - region.startMs);
    const newDuration = Math.max(1, endMs - startMs);
    const timeRatio = newDuration / oldDuration;
    const memberSet = new Set(region.memberIndices);
    const zoomSet = new Set(region.zoomIndices);

    const updated = keyframes.map((frame, index) => {
      if (!memberSet.has(index)) return frame;
      const next = { ...frame };
      next.time = Math.round(startMs + (frame.time - region.startMs) * timeRatio);
      if (frame.duration > 0) next.duration = Math.max(40, Math.round(frame.duration * timeRatio));
      if (zoomSet.has(index)) {
        if (patch.scale !== undefined) next.scale = patch.scale;
        if (patch.x !== undefined) next.x = patch.x;
        if (patch.y !== undefined) next.y = patch.y;
      }
      if (patch.easing !== undefined) next.easing = patch.easing;
      if (patch.transitionMs !== undefined && index === region.zoomIndices[0]) {
        next.duration = Math.min(Math.round(newDuration / 2), Math.max(40, patch.transitionMs));
      }
      if (patch.exitTransitionMs !== undefined && index === region.resetIndex) {
        next.duration = Math.min(Math.round(newDuration / 2), Math.max(40, patch.exitTransitionMs));
      }
      return next;
    }).sort((a, b) => a.time - b.time);

    setKeyframes(updated);
    setSelectedZoomRegion({ startMs, endMs, regionId: region.regionId });
  }, [config.lockedTracks, config.trimEnd, config.trimStart, duration, keyframes, resolvedSelectedZoom]);

  const deleteSelectedZoom = useCallback(() => {
    if(config.lockedTracks?.includes("zoom"))return;
    if (!resolvedSelectedZoom) return;
    const selection: ZoomRegionSelection = {
      startMs: resolvedSelectedZoom.startMs,
      endMs: resolvedSelectedZoom.endMs,
      regionId: resolvedSelectedZoom.regionId,
    };
    const timelineEndMs = Math.round((config.trimEnd || duration) * 1000);
    setKeyframes((current) => {
      const region = findZoomRegion(current, selection, timelineEndMs);
      if (!region) return current;
      const memberSet = new Set(region.memberIndices);
      return current.filter((_, index) => !memberSet.has(index));
    });
    setSelectedZoomRegion(null);
  }, [config.lockedTracks, config.trimEnd, duration, resolvedSelectedZoom]);

  const deleteZoomRegion = useCallback((selection: ZoomRegionSelection) => {
    if(config.lockedTracks?.includes("zoom"))return;
    const timelineEndMs = Math.round((config.trimEnd || duration) * 1000);
    setKeyframes((current) => {
      const region = findZoomRegion(current, selection, timelineEndMs);
      if (!region) return current;
      const memberSet = new Set(region.memberIndices);
      return current.filter((_, index) => !memberSet.has(index));
    });
    if (!selection.regionId || selectedZoomRegion?.regionId === selection.regionId) setSelectedZoomRegion(null);
  }, [config.lockedTracks, config.trimEnd, duration, selectedZoomRegion?.regionId]);

  const duplicateZoomRegion = useCallback((selection: ZoomRegionSelection) => {
    if(config.lockedTracks?.includes("zoom"))return;
    const timelineStartMs = Math.round(config.trimStart * 1000);
    const timelineEndMs = Math.round((config.trimEnd || duration) * 1000);
    const region = findZoomRegion(keyframes, selection, timelineEndMs);
    if (!region) return;
    const regionDuration = Math.max(350, region.endMs - region.startMs);
    const occupied = getOccupiedZoomRanges(keyframes, timelineEndMs).sort((a, b) => a.startMs - b.startMs);
    let destination = Math.min(region.endMs + 80, timelineEndMs - regionDuration);
    const overlaps = (start: number) => occupied.some((range) => start < range.endMs + 50 && start + regionDuration > range.startMs - 50);
    if (destination < timelineStartMs || overlaps(destination)) {
      destination = timelineStartMs;
      for (const range of occupied) {
        if (destination + regionDuration <= range.startMs - 50) break;
        destination = Math.max(destination, range.endMs + 50);
      }
    }
    if (destination + regionDuration > timelineEndMs) {
      // A short project may have no empty span large enough. Keep Duplicate
      // reliable by creating an offset overlapping copy that can be moved or
      // trimmed immediately from the timeline.
      destination = Math.max(timelineStartMs, Math.min(timelineEndMs - regionDuration, region.startMs + 200));
    }

    const regionId = `zoom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const copies = region.memberIndices.map((index) => ({
      ...keyframes[index],
      time: Math.round(destination + (keyframes[index].time - region.startMs)),
      regionId,
      source: "manual" as const,
    }));
    const next = [...keyframes, ...copies].sort((a, b) => a.time - b.time);
    setKeyframes(next);
    setSelectedZoomRegion({ startMs: destination, endMs: destination + regionDuration, regionId });
    setActiveTool("motion");
    pausePlayback();
    seekTo(destination / 1000);
  }, [config.lockedTracks, config.trimEnd, config.trimStart, duration, getOccupiedZoomRanges, keyframes, pausePlayback, seekTo]);

  const duplicateLayer = useCallback((id: string) => {
    if(config.lockedTracks?.includes("annotations"))return;
    const layer = config.layers.find((candidate) => candidate.id === id);
    if (!layer) return;
    const timelineEnd = config.trimEnd || duration;
    const layerDuration = Math.max(0.2, layer.end - layer.start);
    const shiftedStart = Math.min(Math.max(config.trimStart, layer.end + 0.15), Math.max(config.trimStart, timelineEnd - layerDuration));
    const copy = {
      ...layer,
      id: `${layer.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      start: shiftedStart,
      end: Math.min(timelineEnd, shiftedStart + layerDuration),
      x: Math.min(0.92, layer.x + 0.025),
      y: Math.min(0.92, layer.y + 0.025),
    } as Layer;
    setConfig((current) => ({ ...current, layers: [...current.layers, copy] }));
    setSelectedLayerId(copy.id);
    setActiveTool("annotations");
    pausePlayback();
    seekTo(copy.start + 0.01);
  }, [config.layers, config.lockedTracks, config.trimEnd, config.trimStart, duration, pausePlayback, seekTo]);

  const deleteLayer = useCallback((id: string) => {
    setConfig((current) => current.lockedTracks?.includes("annotations") ? current : ({ ...current, layers: current.layers.filter((layer) => layer.id !== id) }));
    if (selectedLayerId === id) setSelectedLayerId(null);
  }, [selectedLayerId]);

  const handleAddManualZoom = useCallback(() => {
    if(config.lockedTracks?.includes("zoom"))return;
    const videoEndMs = Math.max(0, Math.round((config.trimEnd || duration) * 1000));
    const trimStartMs = Math.round(config.trimStart * 1000);
    if (videoEndMs - trimStartMs < 600) return;

    const occupied = getOccupiedZoomRanges(keyframes, videoEndMs);
    const minRegionMs = 1400;
    const preferredRegionMs = 4200;
    let startMs = Math.min(videoEndMs - minRegionMs, Math.max(trimStartMs, Math.round(currentTime * 1000)));

    // Keep every existing auto/manual bar intact. If the playhead is already
    // inside one, place the new region in the nearest available gap instead.
    for (const range of occupied) {
      if (startMs < range.endMs + 80 && startMs + minRegionMs > range.startMs - 80) {
        startMs = range.endMs + 80;
      }
    }
    if (startMs + minRegionMs > videoEndMs) {
      let gapStart = trimStartMs;
      let found = false;
      for (const range of occupied) {
        if (range.startMs - gapStart >= minRegionMs) {
          startMs = gapStart;
          found = true;
          break;
        }
        gapStart = Math.max(gapStart, range.endMs + 80);
      }
      if (!found && videoEndMs - gapStart >= minRegionMs) {
        startMs = gapStart;
        found = true;
      }
      if (!found) return;
    }

    const nextOccupied = occupied.find((range) => range.startMs > startMs);
    const availableEndMs = nextOccupied ? Math.min(videoEndMs, nextOccupied.startMs - 80) : videoEndMs;
    const endMs = Math.min(availableEndMs, startMs + preferredRegionMs);
    const available = Math.max(minRegionMs, endMs - startMs);
    // Manual camera moves use the same speed setting as auto zoom. The old
    // hard 450ms ceiling made every manual region snap in and out regardless
    // of the selected movement speed.
    const requestedTransitionMs = Math.max(600, Math.min(1500, getMovementDuration(config.zoomMovement)));
    const transitionMs = Math.max(450, Math.min(requestedTransitionMs, Math.floor((available - 500) / 2)));
    const zoomInMs = Math.min(endMs, startMs + transitionMs);
    const holdUntilMs = Math.max(zoomInMs, endMs - transitionMs);
    const regionId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const zoomKf: Keyframe = {
      time: zoomInMs,
      duration: transitionMs,
      x: 0.5,
      y: 0.5,
      scale: config.zoomLevel || 2.0,
      easing: "ease-in-out",
      source: "manual",
      regionId,
    };
    const holdKf: Keyframe = { ...zoomKf, time: holdUntilMs, duration: 0 };
    const resetKf: Keyframe = {
      time: endMs,
      duration: transitionMs,
      x: 0.5,
      y: 0.5,
      scale: 1,
      easing: "ease-in-out",
      source: "manual",
      regionId,
    };
    const base = keyframes.length > 0
      ? keyframes
      : [{ time: 0, duration: 0, x: 0.5, y: 0.5, scale: 1, easing: "ease" as const }];
    const updated = [...base, zoomKf, holdKf, resetKf].sort((a, b) => a.time - b.time);
    setKeyframes(updated);
    setConfig((current) => ({ ...current, zoomMode: "manual" }));
    manualTargetRangeRef.current = { startMs, endMs, regionId };
    setSelectedZoomRegion({ startMs, endMs, regionId });
    // The bar exists immediately. The next preview click only changes its
    // focus point; Escape keeps the new centered bar.
    setZoomTargetMode(true);
  }, [config.lockedTracks, config.trimEnd, config.trimStart, config.zoomLevel, config.zoomMovement, currentTime, duration, getOccupiedZoomRanges, keyframes]);

  const updateManualZoomTarget = useCallback((point: { x: number; y: number }, commit = true) => {
    if(config.lockedTracks?.includes("zoom"))return;
    const range = manualTargetRangeRef.current;
    if (!range) {
      if (commit) setZoomTargetMode(false);
      return;
    }
    setKeyframes((frames) => frames.map((frame) => (
      frame.scale > 1.02 && (
        range.regionId
          ? frame.regionId === range.regionId
          : frame.time >= range.startMs && frame.time < range.endMs
      )
        ? { ...frame, x: point.x, y: point.y }
        : frame
    )));
    if (commit) {
      manualTargetRangeRef.current = null;
      setZoomTargetMode(false);
    }
  }, [config.lockedTracks, ]);

  useEffect(() => {
    if (!zoomTargetMode) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        manualTargetRangeRef.current = null;
        setZoomTargetMode(false);
      }
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [zoomTargetMode]);

  useEffect(() => {
    if (activeTool === "motion" || !zoomTargetMode) return;
    manualTargetRangeRef.current = null;
    setZoomTargetMode(false);
  }, [activeTool, zoomTargetMode]);

  useEffect(() => {
    if (!previewFocusMode) return;
    const exitPreview = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewFocusMode(false);
    };
    window.addEventListener("keydown", exitPreview);
    return () => window.removeEventListener("keydown", exitPreview);
  }, [previewFocusMode]);

  const revealPreviewControls = useCallback(() => {
    if (!previewFocusMode) return;
    setPreviewControlsVisible(true);
    if (previewControlsTimerRef.current !== null) window.clearTimeout(previewControlsTimerRef.current);
    previewControlsTimerRef.current = window.setTimeout(() => setPreviewControlsVisible(false), 2200);
  }, [previewFocusMode]);

  useEffect(() => {
    if (!previewFocusMode) {
      setPreviewControlsVisible(true);
      if (previewControlsTimerRef.current !== null) window.clearTimeout(previewControlsTimerRef.current);
      previewControlsTimerRef.current = null;
      return;
    }
    revealPreviewControls();
    return () => {
      if (previewControlsTimerRef.current !== null) window.clearTimeout(previewControlsTimerRef.current);
    };
  }, [previewFocusMode, revealPreviewControls]);

  const commandItems = [
    { label: "Freeze frame at playhead", detail: "Adds a still image layer for 2.5 seconds", icon: Snowflake, run: () => void extractFrame("freeze") },
    { label: "Save current frame as thumbnail", detail: "Exports a full-resolution PNG", icon: ImageIcon, run: () => void extractFrame("thumbnail") },
    { label: "3D Tilt", detail: "Animate screen perspective and rotation", icon: Box, run: () => setActiveTool("tilt") },
    { label: "Project health", detail: "Review media, timing, captions, and export readiness", icon: Activity, run: () => setShowProjectHealth(true) },
    { label: "Keys & Clicks", detail: "Open tutorial action overlays", icon: Keyboard, run: () => setActiveTool("actions") },
    ...(cameraMedia ? [{ label: "Webcam Studio", detail: "Frame and style the camera track", icon: Camera, run: () => setActiveTool("camera" as const) }] : []),
  ];
  const filteredCommands = commandItems.filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(commandQuery.trim().toLowerCase()));

  return (
    <div className={`screenstudio-editor-layout ${previewFocusMode ? "preview-focus-mode" : ""} ${previewFocusMode && !previewControlsVisible ? "preview-controls-hidden" : ""}`} data-theme={editorTheme} onPointerMove={revealPreviewControls}>
      {/* ── Top Bar ────────────────────────────────────────────── */}
      <header className="ss-topbar" data-tauri-drag-region>
        <div className="ss-drag-area" data-tauri-drag-region />
        <div className="ss-topbar-left">
          {/* Back button */}
          <button className="ss-icon-btn back-btn" onClick={onClose} title="Save and close editor">
            <ChevronLeft size={20} />
          </button>

          <div className="ss-file-menu-wrap" ref={fileMenuRef}>
            <button
              className={`ss-file-menu-trigger ${showFileMenu ? "active" : ""}`}
              type="button"
              onClick={() => {
                if (!showFileMenu) setActiveTool(null);
                setShowFileMenu(!showFileMenu);
              }}
              aria-haspopup="menu"
              aria-expanded={showFileMenu}
              aria-label="Project file menu"
              title="Project file menu"
            >
              <File size={15} />
              {projectDirty && <i aria-label="Unsaved changes" />}
            </button>
            {showFileMenu && (
              <div className="ss-file-menu" role="menu">
                <div className="ss-file-menu-heading">
                  <strong>{projectPath.split(/[\\/]/).pop()}</strong>
                  <small>{projectDirty ? "Unsaved editor changes" : projectSaving ? "Saving project…" : "All changes saved"}</small>
                </div>
                <button role="menuitem" onClick={() => void handleOpenProject()}>
                  <FolderOpen size={16} /><span><strong>Open Project…</strong><small>Open a saved Snap edit</small></span><kbd>Ctrl O</kbd>
                </button>
                <div className="ss-file-menu-divider" />
                <button role="menuitem" disabled={!projectReady || projectSaving} onClick={() => void handleSaveProject()}>
                  <Save size={16} /><span><strong>Save</strong><small>Save without exporting</small></span><kbd>Ctrl S</kbd>
                </button>
                <button role="menuitem" disabled={!projectReady || projectSaving} onClick={() => void handleSaveProjectAs()}>
                  <SaveAll size={16} /><span><strong>Save As…</strong><small>Create another project file</small></span><kbd>Ctrl Shift S</kbd>
                </button>
                {fileActionStatus && <p className="ss-file-menu-status" role="status">{fileActionStatus}</p>}
              </div>
            )}
          </div>

          <span className="ss-file-title">
            {videoPath.split("\\").pop()}
          </span>
          {projectStatus && <span className={`ss-project-status ${projectDirty ? "dirty" : ""}`} title="Non-destructive project save status">{projectStatus}</span>}
        </div>

        <div className="ss-topbar-right">
          <button className="ss-theme-toggle" onClick={() => { setShowCommandPalette(true); setCommandQuery(""); }} title="Command palette (Ctrl Shift P)" aria-label="Open command palette"><Command size={16} /></button>
          <button
            className="ss-theme-toggle"
            onClick={() => setEditorTheme((theme) => theme === "dark" ? "light" : "dark")}
            title={`Switch to ${editorTheme === "dark" ? "light" : "dark"} mode`}
            aria-label={`Switch to ${editorTheme === "dark" ? "light" : "dark"} mode`}
          >
            {editorTheme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <DonateButton compact />
          <button
            className="ss-topbar-export-btn"
            onClick={() => setShowExport(true)}
          >
            <Upload size={17} />
            Export
          </button>

          <div className="ss-window-controls">
            <button className="window-btn" title="Minimize" onClick={() => appWindow?.minimize()}>
              <Minus size={15} />
            </button>
            <button className="window-btn" title={isMaximized ? "Restore" : "Maximize"} onClick={async () => {
              if (!appWindow) return;
              await appWindow.toggleMaximize();
              setIsMaximized(await appWindow.isMaximized());
            }}>
              <MorphIcon icon={isMaximized ? RestoreIcon : SquareIcon} spring="snappy" size={15} />
            </button>
            <button className="window-btn close-btn" title="Close" onClick={() => appWindow?.close()}>
              <X size={15} />
            </button>
          </div>
        </div>
      </header>

      {/* ── Main Workspace: Sidebar + Preview + Panels ─────────── */}
      <div className="ss-editor-body">
        {/* Left Vertical Tool Bar (Screen Studio style) */}
        <aside className="ss-vertical-tool-palette">
          <button
            className={`ss-tool-icon-btn ${activeTool === "uploads" ? "active" : ""}`}
            onClick={() => setActiveTool("uploads")}
            onDoubleClick={() => setActiveTool(null)}
            aria-pressed={activeTool === "uploads"}
            title="Uploads and media"
          >
            <Library size={20} /><span className="ss-tool-label">Uploads</span>
          </button>
          <button
            className={`ss-tool-icon-btn ${activeTool === "canvas" ? "active" : ""}`}
            onClick={() => setActiveTool("canvas")}
            onDoubleClick={() => setActiveTool(null)}
            aria-pressed={activeTool === "canvas"}
            title="Canvas & Background"
          >
            <Frame size={20} /><span className="ss-tool-label">Canvas</span>
          </button>

          <button className={`ss-tool-icon-btn ${activeTool === "tilt" ? "active" : ""}`} onClick={() => setActiveTool("tilt")} onDoubleClick={() => setActiveTool(null)} aria-pressed={activeTool === "tilt"} title="3D Tilt">
            <Box size={20}/><span className="ss-tool-label">3D Tilt</span>
          </button>
          <button
            className={`ss-tool-icon-btn ${activeTool === "cursor" ? "active" : ""}`}
            onClick={() => setActiveTool("cursor")}
            onDoubleClick={() => setActiveTool(null)}
            aria-pressed={activeTool === "cursor"}
            title="Cursor & Pointer Styling"
          >
            <MousePointer2 size={20} /><span className="ss-tool-label">Cursor</span>
          </button>

          <button className={`ss-tool-icon-btn ${activeTool === "actions" ? "active" : ""}`} onClick={() => setActiveTool("actions")} onDoubleClick={() => setActiveTool(null)} aria-pressed={activeTool === "actions"} title="Keys and Clicks">
            <Keyboard size={20} /><span className="ss-tool-label">Actions</span>
          </button>

          {cameraMedia && <button className={`ss-tool-icon-btn ${activeTool === "camera" ? "active" : ""}`} onClick={() => setActiveTool("camera")} onDoubleClick={() => setActiveTool(null)} aria-pressed={activeTool === "camera"} title="Webcam Studio">
            <Camera size={20} /><span className="ss-tool-label">Camera</span>
          </button>}

          <button
            className={`ss-tool-icon-btn ${activeTool === "annotations" ? "active" : ""}`}
            onClick={() => setActiveTool("annotations")}
            onDoubleClick={() => setActiveTool(null)}
            aria-pressed={activeTool === "annotations"}
            title="Annotations & Layers"
          >
            <Layers3 size={20} /><span className="ss-tool-label">Layers</span>
          </button>

          <button
            className={`ss-tool-icon-btn ${activeTool === "motion" ? "active" : ""}`}
            onClick={() => setActiveTool("motion")}
            onDoubleClick={() => setActiveTool(null)}
            aria-pressed={activeTool === "motion"}
            title="Motion & Blur"
          >
            <Focus size={20} /><span className="ss-tool-label">Motion</span>
          </button>

          <button
            className={`ss-tool-icon-btn ${activeTool === "audio" ? "active" : ""}`}
            onClick={() => setActiveTool("audio")}
            onDoubleClick={() => setActiveTool(null)}
            aria-pressed={activeTool === "audio"}
            title="Audio"
          >
            <AudioLines size={20} /><span className="ss-tool-label">Audio</span>
          </button>

          <button
            className={`ss-tool-icon-btn ${activeTool === "captions" ? "active" : ""}`}
            onClick={() => setActiveTool("captions")}
            onDoubleClick={() => setActiveTool(null)}
            aria-pressed={activeTool === "captions"}
            title="Captions & Subtitles"
            aria-label="Captions and subtitles"
          >
            <Captions size={20} /><span className="ss-tool-label">Captions</span>
          </button>

        </aside>

        {/* Center Preview Workspace */}
        <div className="ss-preview-center-area">
          <button
            type="button"
            className="ss-preview-focus-toggle"
            title={previewFocusMode ? "Exit preview focus (Esc)" : "Maximize preview"}
            aria-label={previewFocusMode ? "Exit preview focus" : "Maximize preview"}
            aria-pressed={previewFocusMode}
            onClick={() => setPreviewFocusMode((value) => !value)}
          >
            {previewFocusMode ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
          <Preview
            videoPath={videoPath}
            sourceDuration={duration}
            inputLogPath={isBrowserPreview ? "" : inputLogPath}
            cameraMedia={cameraMedia}
            config={config}
            keyframes={compareZoom && zoomProposal ? zoomProposal : keyframes}
            onKeyframesChange={applyKeyframes}
            onAutoZoomProposal={setZoomProposal}
            playing={playing}
            previewMuted={previewMuted}
            previewVolume={previewVolume}
            onDuration={(d) => {
              if (!Number.isFinite(d) || d <= 0) return;
              const previous = metadataDurationRef.current;
              metadataDurationRef.current = d;
              setDuration(d);
              setConfig((c) => {
                const trimEnd = trimEndAfterDurationChange(c.trimEnd, previous, d);
                return trimEnd === c.trimEnd ? c : { ...c, trimEnd };
              });
            }}
            onMediaElementChange={setMediaElement}
            cropMode={cropMode}
            onCropApply={handleCropApply}
            onCropCancel={handleCropCancel}
            selectedLayerId={selectedLayerId}
            onLayerSelect={(id) => {
              setSelectedLayerId(id);
              if (id) {
                setSelectedZoomRegion(null);
                setSelectedCaption(null);
                setActiveTool("annotations");
              }
            }}
            onLayerChange={(updated) => setConfig((c) => ({
              ...c,
              layers: c.lockedTracks?.includes("annotations") ? c.layers : editLayerAtTime(c.layers, updated, currentTime),
            }))}
            zoomTargetMode={activeTool === "motion" && zoomTargetMode}
            zoomFocusPoint={activeTool === "motion" && zoomTargetMode && resolvedSelectedZoom ? { x: resolvedSelectedZoom.x, y: resolvedSelectedZoom.y } : null}
            zoomFocusSource={resolvedSelectedZoom?.source ?? config.zoomMode}
            onZoomTargetPick={updateManualZoomTarget}
          autoZoomRevision={autoZoomRevision}
          autoZoomReady={projectReady}
            preserveProjectKeyframes={hasSavedProject && keyframes.length > 0}
            captionTracks={captionTracks}
            hasExternalAudio={audioTracks.length > 0}
            originalOnly={false}
          />
          {zoomProposal && <div className="editor-enhancements"><strong>Suggested camera movement</strong><p>{keyframes.length} current keys · {zoomProposal.length} suggested keys</p><div className="editor-tool-row"><button aria-pressed={compareZoom} onClick={() => setCompareZoom(value => !value)}>{compareZoom ? "Show current" : "Preview suggestion"}</button><button disabled={config.lockedTracks?.includes("zoom")} onClick={() => { setKeyframes(zoomProposal); setZoomProposal(null); setCompareZoom(false); }}>Apply suggestion</button><button onClick={() => { setZoomProposal(null); setCompareZoom(false); }}>Discard</button></div></div>}
          {previewFocusMode && <div className="ss-preview-player" role="group" aria-label="Preview playback controls">
            <div className="ss-preview-player-time"><span>{formatPlayerTime(sequencePosition / (config.playbackRate || 1))}</span><span>{formatPlayerTime(editedDuration)}</span></div>
            <input aria-label="Preview position" type="range" min={0} max={editedDuration || 1} step="0.01" value={Math.min(sequencePosition / (config.playbackRate || 1), editedDuration)} onChange={(event) => seekSequence(Number(event.target.value) * (config.playbackRate || 1))} />
            <div className="ss-preview-player-buttons">
              <button type="button" title="Back 5 seconds" onClick={() => seekSequence(sequencePosition - 5 * (config.playbackRate || 1))}><SkipBack size={18} /></button>
              <button type="button" className="primary" title={playing ? "Pause" : "Play"} onClick={togglePlay}>{playing ? <Pause size={21} /> : <Play size={21} fill="currentColor" />}</button>
              <button type="button" title="Forward 5 seconds" onClick={() => seekSequence(sequencePosition + 5 * (config.playbackRate || 1))}><SkipForward size={18} /></button>
              <div className="ss-preview-volume">
                <button type="button" title={previewMuted ? "Unmute preview" : "Mute preview"} onClick={() => setPreviewMuted((muted) => !muted)}>{previewMuted || previewVolume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
                <input aria-label="Preview volume" type="range" min={0} max={100} step={1} value={previewMuted ? 0 : previewVolume} onChange={(event) => { const value = Number(event.target.value); setPreviewVolume(value); setPreviewMuted(value === 0); }} />
              </div>
            </div>
          </div>}
        </div>

        {/* Right Tool Settings Panel Drawer */}
        {activeTool && <Panels
          config={config}
          inputLogPath={inputLogPath}
          onConfigChange={applyConfigEdit}
          duration={duration}
          currentTime={currentTime}
          layers={config.layers}
          selectedLayerId={selectedLayerId}
          onAddLayer={(layer: Layer) => setConfig((c) => c.lockedTracks?.includes("annotations") ? c : ({ ...c, layers: [...c.layers, layer] }))}
          onSelectLayer={setSelectedLayerId}
          activeTab={activeTool}
          onAddManualZoom={handleAddManualZoom}
          onRegenerateAutoZoom={() => {
            setConfig((c) => ({ ...c, zoomMode: "auto" }));
            setSelectedZoomRegion(null);
            setAutoZoomRevision((value) => value + 1);
          }}
          onZoomModeChange={(mode) => {
            setConfig((c) => ({ ...c, zoomMode: mode }));
            setZoomTargetMode(false);
            manualTargetRangeRef.current = null;
          }}
          selectedZoomRegion={resolvedSelectedZoom}
          onSelectedZoomChange={updateSelectedZoom}
          onClearSelectedZoom={() => { setSelectedZoomRegion(null); setZoomTargetMode(false); manualTargetRangeRef.current = null; }}
          onDeleteSelectedZoom={deleteSelectedZoom}
          audioTracks={audioTracks}
          audioError={audioError}
          onAddAudio={handleAddAudio}
          onAddAudioSources={addAudioSources}
          onAddMediaToTimeline={addMediaToTimeline}
          onAddManualCaption={() => addManualCaptionAt(currentTime)}
          onAudioTracksChange={(next) => setAudioTracks(current => [...next.filter(t => !config.lockedTracks?.includes(t.id)),...current.filter(t => config.lockedTracks?.includes(t.id))])}
          captionTracks={captionTracks}
          onCaptionTracksChange={(tracks) => {if(!config.lockedTracks?.includes("caption"))setCaptionTracks(tracks);}}
          selectedCaption={selectedCaption}
          onSelectCaption={(selection) => { setSelectedCaption(selection); if(selection) { const segment=captionTracks.find(track=>track.id===selection.trackId)?.segments.find(s=>s.id===selection.segmentId); if(segment) { pausePlayback(); seekTo(segment.startMs/1000); } } }}
          selectedActionId={selectedActionId}
          onSelectAction={setSelectedActionId}
          onSnapLayerToAction={snapLayerToAction}
        />}
      </div>

      {/* ── Multi-Track Timeline (Screen Studio Style) ─────────────── */}
      <Timeline
        audioDurations={audioDurations}
        frameRate={sourceFrameRate}
        activeClipId={activeClipId}
        videoPath={videoPath}
        onTrackLocksChange={lockedTracks => setConfig(c => ({ ...c, lockedTracks }))}
        onAnimationKeyChange={(kind, id, time, nextTime) => {
          setConfig(c => {
            if (c.lockedTracks?.includes(kind === "layer" ? "annotations" : kind)) return c;
            const retime = <T extends { time: number }>(keys: T[]): T[] => {
              const key = keys.find(item => Math.abs(item.time-time)<.000001);
              if (!key) return keys;
              const rest = keys.filter(item => item !== key && (nextTime === null || Math.abs(item.time-nextTime)>.000001));
              return nextTime === null ? rest : [...rest, { ...key, time: nextTime }].sort((a,b)=>a.time-b.time);
            };
            if (kind === "tilt" && c.screenTilt) return { ...c, screenTilt: { ...c.screenTilt, keys: retime(c.screenTilt.keys) } };
            if (kind === "camera") return { ...c, cameraOverlay: { ...c.cameraOverlay, animation: retime(c.cameraOverlay.animation??[]) } };
            return { ...c, layers: c.layers.map(layer => layer.id === id ? { ...layer, animation: retime(layer.animation??[]) } : layer) };
          });
        }}
        onTrackClear={(kind, id) => {
          const lockId = kind === "layer" ? "annotations" : kind;
          if (config.lockedTracks?.includes(lockId)) return;
          if (kind === "zoom") {
            setKeyframes([]);
            setSelectedZoomRegion(null);
            setConfig(c => ({ ...c, zoomMode: "manual" }));
          } else if (kind === "caption") {
            setCaptionTracks(tracks => tracks.map(track => track.id === id ? { ...track, segments: [] } : track));
            setSelectedCaption(null);
          } else if (kind === "layer") {
            setConfig(c => ({ ...c, layers: c.layers.filter(layer => layer.type !== id) }));
            setSelectedLayerId(null);
          } else if (kind === "action") {
            setConfig(c => ({ ...c, actionOverlay: { ...c.actionOverlay, enabled: false } }));
            setSelectedActionId(null);
          } else {
            pausePlayback();
            setConfig(c => ({ ...c, videoClips: null, cuts: [] }));
          }
        }}
        editorTheme={editorTheme}
        inputLogPath={isBrowserPreview ? "" : inputLogPath}
        audioTracks={audioTracks}
        duration={duration}
        currentTime={currentTime}
        keyframes={keyframes}
        config={config}
        playing={playing}
        playbackStatus={playbackStatus}
        onTogglePlay={togglePlay}
        onSeek={seekTo}
        onTrimStartChange={handleTrimStart}
        onTrimEndChange={handleTrimEnd}
        onCutsChange={(newCuts: number[]) =>
            setConfig((c) => ({ ...c, cuts: newCuts }))
        }
        onVideoClipsChange={(videoClips) => { if(config.lockedTracks?.includes("video"))return; pausePlayback(); setConfig(c => ({ ...c, videoClips })); }}
        onAspectChange={(ar) => setConfig((c) => ({ ...c, aspectRatio: ar }))}
        onToggleCrop={handleToggleCrop}
        cropActive={cropMode || !!config.crop}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onKeyframesChange={setKeyframes}
        selectedZoomRegion={selectedZoomRegion}
        onZoomRegionSelect={(region) => {
          // Selecting a bar enters focus editing at the beginning of that
          // camera move. This keeps the source frame stable while the blue
          // focus marker is repositioned in the preview.
          pausePlayback();
          setSelectedZoomRegion(region);
          setSelectedLayerId(null);
          setSelectedCaption(null);
          setActiveTool("motion");
          manualTargetRangeRef.current = region;
          setZoomTargetMode(true);
          seekTo(region.startMs / 1000);
        }}
        onZoomRegionDuplicate={duplicateZoomRegion}
        onZoomRegionDelete={deleteZoomRegion}
        onAudioMuteChange={(track, muted) => setConfig((current) => ({
          ...current,
          audio: {
            ...current.audio,
            ...(track === "system" ? { systemMuted: muted } : { micMuted: muted }),
          },
        }))}
        onAddAudio={handleAddAudio}
        onMediaDrop={addMediaToTimeline}
        onAddCaptionAtTime={addManualCaptionAt}
        onAudioTrackChange={(updated) => { if(!config.lockedTracks?.includes(updated.id))setAudioTracks((tracks) => tracks.map((track) => track.id === updated.id ? updated : track)); }}
        onAudioTrackRemove={(trackId) => { if(!config.lockedTracks?.includes(trackId))setAudioTracks((tracks) => tracks.filter((track) => track.id !== trackId)); }}
        selectedActionId={selectedActionId}
        onActionSelect={(id) => {
          pausePlayback();
          setSelectedActionId(id);
          setSelectedLayerId(null);
          setSelectedCaption(null);
          setSelectedZoomRegion(null);
          setZoomTargetMode(false);
          setActiveTool("actions");
        }}
        onActionEdit={(id, patch: ActionEventEdit) => setConfig((current) => current.lockedTracks?.includes("action") ? current : ({
          ...current,
          actionOverlay: {
            ...current.actionOverlay,
            eventEdits: {
              ...current.actionOverlay.eventEdits,
              [id]: { ...current.actionOverlay.eventEdits[id], ...patch },
            },
          },
        }))}
        layers={config.layers}
        selectedLayerId={selectedLayerId}
        onLayerSelect={(id) => {
          pausePlayback();
          setSelectedLayerId(id);
          setSelectedZoomRegion(null);
          setSelectedCaption(null);
          setActiveTool("annotations");
          const layer = config.layers.find((candidate) => candidate.id === id);
          if (layer && (currentTime < layer.start || currentTime > layer.end)) seekTo(layer.start + 0.01);
        }}
        onLayerChange={(updated) => setConfig((current) => ({
          ...current,
          layers: current.lockedTracks?.includes("annotations") ? current.layers : moveLayerGroup(current.layers, updated),
        }))}
        onLayerDuplicate={duplicateLayer}
        onLayerDelete={deleteLayer}
        captionTracks={captionTracks}
        selectedCaption={selectedCaption}
        onCaptionSegmentSelect={(selection) => {
          pausePlayback();
          setSelectedCaption(selection);
          setSelectedLayerId(null);
          setSelectedZoomRegion(null);
          setZoomTargetMode(false);
          setActiveTool("captions");
          const track = captionTracks.find((candidate) => candidate.id === selection.trackId);
          const segment = track?.segments.find((candidate) => candidate.id === selection.segmentId);
          if (segment && (currentTime < segment.startMs / 1000 || currentTime >= segment.endMs / 1000)) seekTo(segment.startMs / 1000 + .01);
        }}
        onCaptionSegmentChange={(trackId, segment) => setCaptionTracks((tracks) => config.lockedTracks?.includes("caption") ? tracks : tracks.map((track) => track.id === trackId ? {
          ...track,
          segments: track.segments
            .map((item) => item.id === segment.id ? segment : item)
            .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs),
        } : track))}
        onCaptionSegmentDuplicate={(trackId, segmentId) => setCaptionTracks((tracks) => config.lockedTracks?.includes("caption") ? tracks : tracks.map((track) => {
          if (track.id !== trackId) return track;
          const source = track.segments.find((segment) => segment.id === segmentId);
          if (!source) return track;
          const durationMs = Math.max(100, source.endMs - source.startMs);
          const projectStartMs = Math.round(config.trimStart * 1000);
          const projectEndMs = Math.round((config.trimEnd || duration) * 1000);
          const startMs = findAvailableCaptionStart(
            track.segments,
            source.id,
            durationMs,
            projectStartMs,
            projectEndMs,
            source.endMs + 100,
          );
          if (startMs === null) return track;
          const copy = { ...source, id: `caption-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, startMs, endMs: startMs + durationMs, userEdited: true };
          return { ...track, segments: [...track.segments, copy].sort((a, b) => a.startMs - b.startMs) };
        }))}
        onPlaybackRateChange={(playbackRate) => setConfig((current) => ({ ...current, playbackRate }))}
        onCaptionSegmentDelete={(trackId, segmentId) => {
          if(config.lockedTracks?.includes("caption"))return;
          setCaptionTracks((tracks) => tracks.map((track) => track.id === trackId ? { ...track, segments: track.segments.filter((segment) => segment.id !== segmentId) } : track));
          if (selectedCaption?.trackId === trackId && selectedCaption.segmentId === segmentId) setSelectedCaption(null);
        }}
      />
      {showCommandPalette && <div className="ss-command-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowCommandPalette(false)}>
        <section className="ss-command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
          <header className="ss-command-header"><span><Command size={16} /></span><div><strong>Quick actions</strong><small>Jump to an editor tool</small></div><kbd>Esc</kbd></header>
          <div className="ss-command-search"><Search size={17} /><input autoFocus value={commandQuery} onChange={(event) => { setCommandQuery(event.target.value); setCommandIndex(0); }} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); setCommandIndex((index) => Math.max(0, Math.min(filteredCommands.length - 1, index + 1))); } else if (event.key === "ArrowUp") { event.preventDefault(); setCommandIndex((index) => Math.max(0, index - 1)); } else if (event.key === "Enter" && filteredCommands[commandIndex]) { filteredCommands[commandIndex].run(); setShowCommandPalette(false); } }} placeholder="Search actions" aria-label="Search quick actions" /></div>
          <div className="ss-command-list">
            {filteredCommands.map(({ label, detail, icon: Icon, run }, index) => <button key={label} className={index === commandIndex ? "active" : ""} onMouseEnter={() => setCommandIndex(index)} onClick={() => { run(); setShowCommandPalette(false); }}><i><Icon size={17} /></i><span><strong>{label}</strong><small>{detail}</small></span><em>Open</em></button>)}
            {!filteredCommands.length && <p>No matching actions</p>}
          </div>
          <footer><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>Enter</kbd> select</span></footer>
        </section>
      </div>}
      {showProjectHealth && <div className="ss-command-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowProjectHealth(false)}>
        <section className="ss-health-panel" role="dialog" aria-modal="true" aria-label="Project health">
          <header><div><Activity size={20} /><span><strong>Project health</strong><small>Pre-export readiness</small></span></div><button onClick={() => setShowProjectHealth(false)}><X size={17} /></button></header>
          <div className="ss-health-score"><strong>{duration > 0 && (config.trimEnd || duration) > config.trimStart ? "Ready" : "Needs attention"}</strong><span>{editedDuration.toFixed(1)}s edited duration</span></div>
          <ul>
            <li className={duration > 0 ? "ok" : "warn"}><span>Source video</span><strong>{duration > 0 ? "Loaded" : "Metadata missing"}</strong></li>
            <li className={inputLogPath ? "ok" : "warn"}><span>Input actions</span><strong>{inputLogPath ? "Available" : "Imported video"}</strong></li>
            <li className={cameraMedia ? "ok" : "neutral"}><span>Webcam track</span><strong>{cameraMedia ? "Connected" : "Not recorded"}</strong></li>
            <li className="ok"><span>Visual layers</span><strong>{config.layers.length}</strong></li>
            <li className="ok"><span>Audio tracks</span><strong>{audioTracks.length}</strong></li>
            <li className={captionTracks.length ? "ok" : "neutral"}><span>Captions</span><strong>{captionTracks.reduce((sum, track) => sum + track.segments.length, 0)} segments</strong></li>
            <li className={projectDirty ? "warn" : "ok"}><span>Project file</span><strong>{projectDirty ? "Unsaved changes" : "Saved"}</strong></li>
          </ul>
          <button className="ss-health-export" onClick={() => { setShowProjectHealth(false); setShowExport(true); }}><Upload size={16} /> Continue to export</button>
        </section>
      </div>}
      {showExport && (
        <ExportModal
          videoPath={videoPath}
          duration={duration}
          config={config}
          captionTrackCount={captionTracks.length}
          status={exportStatus}
          progress={exportProgress}
          exportedPath={lastExportPath}
          onClose={() => setShowExport(false)}
          onCancel={handleCancelExport}
          onOpenFile={() => {
            if (!lastExportPath) return;
            void openPath(lastExportPath).catch((error) => {
              setExportStatus(`Done — export saved. Could not open the file: ${userError(error)}`);
            });
          }}
          onExport={handleExport}
        />
      )}
    </div>
  );
}

function formatPlayerTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const remaining = whole % 60;
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}
