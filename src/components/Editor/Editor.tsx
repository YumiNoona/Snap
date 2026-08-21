import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { MorphIcon } from "morphicons/react";
import { Square as SquareIcon, Minimize2 as RestoreIcon } from "lucide";
import { ChevronLeft, Bookmark, ChevronDown, Upload, Minus, X, LayoutTemplate, MousePointer2, Type, Sparkles, AudioWaveform, Save, SaveAll, FolderOpen, File, Trash2, RotateCcw, Captions, Sun, Moon } from "lucide-react";
import Preview from "./Preview/index";
import Timeline from "./Timeline/index";
import Panels from "./Panels/index";
import ExportModal from "./ExportModal";
import DonateButton from "../shared/DonateButton";
import type { AudioTrack, CaptionTrack, CaptionSegmentSelection, EditorConfig, Keyframe, ExportSettings, Layer, ZoomRegionSelection, ZoomRegionSettings } from "../../lib/types";
import { DEFAULT_EDITOR_CONFIG, getMovementDuration } from "../../lib/types";
import { runCanvasExport } from "../../lib/canvasExport";
import { collectZoomRegions, findZoomRegion } from "../../lib/zoomRegions";
import { useEditorHistory } from "./hooks/useEditorHistory";
import { useProjectPersistence } from "./hooks/useProjectPersistence";
import { usePlaybackController } from "./hooks/usePlaybackController";
import { discoverAudioTracks, mergeAudioTracks } from "../../lib/captions";
import { loadProjectAtPath } from "../../lib/project";
import "./Editor.css";

interface Props {
  videoPath: string;
  inputLogPath: string;
  initialProjectPath?: string;
  onOpenProject?: (projectPath: string, videoPath: string, inputLogPath: string) => void;
  onClose: () => void;
}

export type SidebarToolTab = "canvas" | "cursor" | "annotations" | "motion" | "captions" | "audio";

const HOTSPOTS_STORAGE_KEY = "snap.cursorHotspots";
const EDITOR_PRESETS_STORAGE_KEY = "snap.editorPresets.v1";
const EDITOR_THEME_STORAGE_KEY = "snap.editorTheme.v1";

type PresetSettings = Pick<EditorConfig,
  "backgroundColor" | "bgType" | "wallpaperUrl" | "bgBlur" | "padding" |
  "borderRadius" | "inset" | "insetColor" | "shadow" | "cursorStyle" |
  "showCursor" | "zoomEnabled" | "zoomMode" | "zoomLevel" | "fixedZoomPart" |
  "aspectRatio" | "motionBlur" | "cursorMovement" | "zoomMovement" | "audio"
  | "autoZoom"
>;

interface SavedEditorPreset {
  id: string;
  name: string;
  createdAt: number;
  settings: PresetSettings;
}

function snapshotPresetSettings(config: EditorConfig): PresetSettings {
  return {
    backgroundColor: config.backgroundColor,
    bgType: config.bgType,
    wallpaperUrl: config.wallpaperUrl,
    bgBlur: config.bgBlur,
    padding: config.padding,
    borderRadius: config.borderRadius,
    inset: config.inset,
    insetColor: config.insetColor,
    shadow: { ...config.shadow },
    cursorStyle: { ...config.cursorStyle },
    showCursor: config.showCursor,
    zoomEnabled: config.zoomEnabled,
    zoomMode: config.zoomMode,
    zoomLevel: config.zoomLevel,
    fixedZoomPart: config.fixedZoomPart,
    aspectRatio: config.aspectRatio ? { ...config.aspectRatio } : null,
    motionBlur: { ...config.motionBlur },
    cursorMovement: { ...config.cursorMovement },
    zoomMovement: { ...config.zoomMovement },
    autoZoom: { ...config.autoZoom },
    audio: { ...config.audio },
  };
}

function loadEditorPresets(): SavedEditorPreset[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(EDITOR_PRESETS_STORAGE_KEY) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((preset): preset is SavedEditorPreset => !!preset?.id && !!preset?.name && !!preset?.settings)
      : [];
  } catch {
    return [];
  }
}

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
  const [audioStatus, setAudioStatus] = useState("Finding recorded audio…");
  const [duration, setDuration] = useState(isBrowserPreview ? 21.44 : 0);
  const [exportStatus, setExportStatus] = useState("");
  const [activeTool, setActiveTool] = useState<SidebarToolTab>("canvas");
  const [cropMode, setCropMode] = useState(false);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [selectedZoomRegion, setSelectedZoomRegion] = useState<ZoomRegionSelection | null>(null);
  const [selectedCaption, setSelectedCaption] = useState<CaptionSegmentSelection | null>(null);
  const [editorTheme, setEditorTheme] = useState<"dark" | "light">(() => localStorage.getItem(EDITOR_THEME_STORAGE_KEY) === "light" ? "light" : "dark");
  const [zoomTargetMode, setZoomTargetMode] = useState(false);
  const [autoZoomRevision, setAutoZoomRevision] = useState(0);
  const [showExport, setShowExport] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [fileActionStatus, setFileActionStatus] = useState("");
  const [presetName, setPresetName] = useState("");
  const [savedPresets, setSavedPresets] = useState<SavedEditorPreset[]>(loadEditorPresets);
  const [exportProgress, setExportProgress] = useState(0);
  const [isMaximized, setIsMaximized] = useState(false);
  const appWindow = useMemo(() => isBrowserPreview ? null : getCurrentWindow(), [isBrowserPreview]);
  const presetMenuRef = useRef<HTMLDivElement | null>(null);
  const fileMenuRef = useRef<HTMLDivElement | null>(null);
  const manualTargetRangeRef = useRef<ZoomRegionSelection | null>(null);

  useEffect(() => {
    localStorage.setItem(EDITOR_THEME_STORAGE_KEY, editorTheme);
  }, [editorTheme]);
  const { undo, redo, replaceWithoutHistory, canUndo, canRedo } = useEditorHistory({
    config, keyframes, captions: captionTracks, setConfig, setKeyframes, setCaptions: setCaptionTracks,
  });
  const { currentTime, playing, playbackStatus, setMediaElement, togglePlay, pausePlayback, seekTo } = usePlaybackController({
    videoPath, trimStart: config.trimStart, trimEnd: config.trimEnd, duration,
    playbackRate: config.playbackRate, audioTracks, audioMix: config.audio,
  });

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
      setFileActionStatus(`Could not save project: ${error}`);
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
      setFileActionStatus(`Could not save project: ${error}`);
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
      setFileActionStatus(`Could not open project: ${error}`);
    }
  }, [onOpenProject, pausePlayback, projectDirty, saveProjectNow]);

  useEffect(() => {
    if (!appWindow || !projectReady) return;
    let committingClose = false;
    const unlisten = appWindow.onCloseRequested(async (event) => {
      if (committingClose) return;
      event.preventDefault();
      committingClose = true;
      try {
        await saveProjectNow();
        await appWindow.close();
      } catch (error) {
        committingClose = false;
        setFileActionStatus(`Could not save before closing: ${error}`);
        setShowFileMenu(true);
      }
    });
    return () => { void unlisten.then((stop) => stop()); };
  }, [appWindow, projectReady, saveProjectNow]);

  useEffect(() => {
    if (isBrowserPreview) return;
    const unlisten = listen("recording-starting", () => {
      pausePlayback();
      void saveProjectNow().catch((error) => {
        console.error("[Snap] Could not autosave before recording:", error);
      });
    });
    return () => { void unlisten.then((stop) => stop()); };
  }, [isBrowserPreview, pausePlayback, saveProjectNow]);

  useEffect(() => {
    let cancelled = false;
    setAudioStatus("Finding recorded audio…");
    void discoverAudioTracks(videoPath).then((discovered) => {
      if (cancelled) return;
      setAudioTracks((current) => mergeAudioTracks(discovered, current));
      setAudioStatus(discovered.length > 0
        ? `${discovered.length} editable audio ${discovered.length === 1 ? "track" : "tracks"} ready`
        : "No separate audio tracks were found for this recording");
    }).catch((error) => {
      if (!cancelled) setAudioStatus(`Audio could not be loaded: ${error}`);
    });
    return () => { cancelled = true; };
  }, [videoPath]);


  // Persist per-pack cursor hotspot nudges across sessions
  useEffect(() => {
    try {
      localStorage.setItem(HOTSPOTS_STORAGE_KEY, JSON.stringify(config.cursorHotspots));
    } catch {
      // ignore storage errors
    }
  }, [config.cursorHotspots]);

  useEffect(() => {
    try {
      localStorage.setItem(EDITOR_PRESETS_STORAGE_KEY, JSON.stringify(savedPresets));
    } catch {
      // Presets remain available for the current session if storage is unavailable.
    }
  }, [savedPresets]);

  useEffect(() => {
    if (!showPresets) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!presetMenuRef.current?.contains(event.target as Node)) setShowPresets(false);
    };
    window.addEventListener("pointerdown", closeOnOutsideClick);
    return () => window.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [showPresets]);

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

  const applyPresetSettings = useCallback((settings: PresetSettings) => {
    setConfig((current) => ({
      ...current,
      ...settings,
      shadow: { ...settings.shadow },
      cursorStyle: { ...settings.cursorStyle },
      motionBlur: { ...settings.motionBlur },
      cursorMovement: { ...settings.cursorMovement },
      zoomMovement: { ...settings.zoomMovement },
      autoZoom: { ...settings.autoZoom },
      audio: { ...settings.audio },
      // These are recording-specific and must never be overwritten by a look preset.
      cursorHotspots: current.cursorHotspots,
      crop: current.crop,
      trimStart: current.trimStart,
      trimEnd: current.trimEnd,
      cuts: current.cuts,
      layers: current.layers,
    }));
    setShowPresets(false);
  }, []);

  const saveCurrentPreset = useCallback(() => {
    const name = presetName.trim() || `Preset ${savedPresets.length + 1}`;
    const next: SavedEditorPreset = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      createdAt: Date.now(),
      settings: snapshotPresetSettings(config),
    };
    setSavedPresets((presets) => [next, ...presets].slice(0, 20));
    setPresetName("");
  }, [config, presetName, savedPresets.length]);

  useEffect(() => {
    if (isBrowserPreview) return;
    invoke("window_ready").catch((e) => {
      console.error("[Snap] window_ready failed — editor window will stay hidden:", e);
    });
  }, [isBrowserPreview]);

  const handleToggleCrop = useCallback(() => setCropMode((m) => !m), []);

  const handleCropApply = useCallback(
    (crop: { x: number; y: number; w: number; h: number } | null) => {
      setConfig((c) => ({ ...c, crop }));
      setCropMode(false);
    },
    []
  );

  const handleCropCancel = useCallback(() => setCropMode(false), []);

  const handleTrimStart = (t: number) => {
    setConfig({ ...config, trimStart: t });
    if (currentTime < t) seekTo(t);
  };

  const handleTrimEnd = (t: number) => {
    setConfig({ ...config, trimEnd: t });
    if (currentTime > t) seekTo(t);
  };

  const handleExport = async (settings: ExportSettings) => {
    setExportStatus("Exporting...");
    setExportProgress(0);
    try {
      const result = await runCanvasExport(
        videoPath,
        inputLogPath,
        keyframes,
        config,
        captionTracks,
        settings,
        config.trimStart,
        config.trimEnd > 0 ? config.trimEnd : duration,
        (p) => {
          if (p.phase === "recording") {
            setExportStatus(`Exporting... ${Math.round(p.progress * 100)}%`);
            setExportProgress(p.progress);
          } else if (p.phase === "finalizing") {
            setExportStatus("Finalizing...");
            setExportProgress(0.98);
          }
        }
      );
      setExportStatus(`Done: ${settings.outputPath}`);
      setExportProgress(1);
      void result;
    } catch (e) {
      setExportStatus(`Export failed: ${e}`);
    }
  };

  const getOccupiedZoomRanges = useCallback((frames: Keyframe[], timelineEndMs: number) => {
    return collectZoomRegions(frames, timelineEndMs).map(({ startMs, endMs }) => ({ startMs, endMs }));
  }, []);

  const resolvedSelectedZoom = useMemo(
    () => findZoomRegion(keyframes, selectedZoomRegion, Math.round((config.trimEnd || duration) * 1000)),
    [config.trimEnd, duration, keyframes, selectedZoomRegion]
  );

  const updateSelectedZoom = useCallback((patch: Partial<ZoomRegionSettings>) => {
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
  }, [config.trimEnd, config.trimStart, duration, keyframes, resolvedSelectedZoom]);

  const deleteSelectedZoom = useCallback(() => {
    if (!resolvedSelectedZoom) return;
    const memberSet = new Set(resolvedSelectedZoom.memberIndices);
    setKeyframes(keyframes.filter((_, index) => !memberSet.has(index)));
    setSelectedZoomRegion(null);
  }, [keyframes, resolvedSelectedZoom]);

  const deleteZoomRegion = useCallback((selection: ZoomRegionSelection) => {
    const region = findZoomRegion(keyframes, selection, Math.round((config.trimEnd || duration) * 1000));
    if (!region) return;
    const memberSet = new Set(region.memberIndices);
    setKeyframes(keyframes.filter((_, index) => !memberSet.has(index)));
    if (selectedZoomRegion?.regionId === region.regionId) setSelectedZoomRegion(null);
  }, [config.trimEnd, duration, keyframes, selectedZoomRegion?.regionId]);

  const duplicateZoomRegion = useCallback((selection: ZoomRegionSelection) => {
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
  }, [config.trimEnd, config.trimStart, duration, getOccupiedZoomRanges, keyframes, pausePlayback, seekTo]);

  const duplicateLayer = useCallback((id: string) => {
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
  }, [config.layers, config.trimEnd, config.trimStart, duration, pausePlayback, seekTo]);

  const deleteLayer = useCallback((id: string) => {
    setConfig((current) => ({ ...current, layers: current.layers.filter((layer) => layer.id !== id) }));
    if (selectedLayerId === id) setSelectedLayerId(null);
  }, [selectedLayerId]);

  const handleAddManualZoom = useCallback(() => {
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
  }, [config.trimEnd, config.trimStart, config.zoomLevel, config.zoomMovement, currentTime, duration, getOccupiedZoomRanges, keyframes]);

  const updateManualZoomTarget = useCallback((point: { x: number; y: number }, commit = true) => {
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
  }, []);

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

  return (
    <div className="screenstudio-editor-layout" data-theme={editorTheme}>
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
              onClick={() => setShowFileMenu((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={showFileMenu}
            >
              <File size={15} />
              <span>File</span>
              {projectDirty && <i aria-label="Unsaved changes" />}
              <ChevronDown size={13} />
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

        <div className="ss-topbar-center">
          <div className="ss-presets-wrap" ref={presetMenuRef}>
            <button
              className={`ss-presets-pill ${showPresets ? "active" : ""}`}
              onClick={() => setShowPresets((open) => !open)}
              aria-expanded={showPresets}
              aria-haspopup="dialog"
            >
              <Bookmark size={15} />
              <span>Presets</span>
              {savedPresets.length > 0 && <span className="preset-count">{savedPresets.length}</span>}
              <ChevronDown size={14} className={showPresets ? "rotate" : ""} />
            </button>

            {showPresets && (
              <div className="presets-popover" role="dialog" aria-label="Editor presets">
                <div className="presets-popover-head">
                  <div>
                    <strong>Saved looks</strong>
                    <span>Reuse your canvas, cursor, motion and audio settings.</span>
                  </div>
                </div>

                <div className="preset-save-row">
                  <input
                    value={presetName}
                    onChange={(event) => setPresetName(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") saveCurrentPreset(); }}
                    placeholder={`Preset ${savedPresets.length + 1}`}
                    maxLength={36}
                    aria-label="Preset name"
                  />
                  <button onClick={saveCurrentPreset} title="Save current settings">
                    <Save size={15} />
                    Save
                  </button>
                </div>

                <div className="preset-list">
                  <button className="preset-row built-in" onClick={() => applyPresetSettings(snapshotPresetSettings(DEFAULT_EDITOR_CONFIG))}>
                    <span className="preset-row-icon"><RotateCcw size={15} /></span>
                    <span className="preset-row-copy"><strong>Snap Default</strong><small>Restore the default editor look</small></span>
                  </button>

                  {savedPresets.map((preset) => (
                    <div className="preset-row" key={preset.id}>
                      <button className="preset-apply-btn" onClick={() => applyPresetSettings(preset.settings)}>
                        <span className="preset-row-icon"><Bookmark size={15} /></span>
                        <span className="preset-row-copy"><strong>{preset.name}</strong><small>Apply saved settings</small></span>
                      </button>
                      <button
                        className="preset-delete-btn"
                        onClick={() => setSavedPresets((presets) => presets.filter((item) => item.id !== preset.id))}
                        title={`Delete ${preset.name}`}
                        aria-label={`Delete ${preset.name}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}

                  {savedPresets.length === 0 && (
                    <p className="preset-empty">Save your current setup and it will appear here.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="ss-topbar-right">
          <button
            className="ss-theme-toggle"
            onClick={() => setEditorTheme((theme) => theme === "dark" ? "light" : "dark")}
            title={`Switch to ${editorTheme === "dark" ? "light" : "dark"} mode`}
            aria-label={`Switch to ${editorTheme === "dark" ? "light" : "dark"} mode`}
          >
            {editorTheme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <DonateButton />
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
            className={`ss-tool-icon-btn ${activeTool === "canvas" ? "active" : ""}`}
            onClick={() => setActiveTool("canvas")}
            title="Canvas & Background"
          >
            <LayoutTemplate size={21} />
          </button>

          <button
            className={`ss-tool-icon-btn ${activeTool === "cursor" ? "active" : ""}`}
            onClick={() => setActiveTool("cursor")}
            title="Cursor & Pointer Styling"
          >
            <MousePointer2 size={21} />
          </button>

          <button
            className={`ss-tool-icon-btn ${activeTool === "annotations" ? "active" : ""}`}
            onClick={() => setActiveTool("annotations")}
            title="Annotations & Layers"
          >
            <Type size={21} />
          </button>

          <button
            className={`ss-tool-icon-btn ${activeTool === "motion" ? "active" : ""}`}
            onClick={() => setActiveTool("motion")}
            title="Motion & Blur"
          >
            <Sparkles size={21} />
          </button>

          <button
            className={`ss-tool-icon-btn ${activeTool === "audio" ? "active" : ""}`}
            onClick={() => setActiveTool("audio")}
            title="Audio"
          >
            <AudioWaveform size={21} />
          </button>

          <button
            className={`ss-tool-icon-btn ${activeTool === "captions" ? "active" : ""}`}
            onClick={() => setActiveTool("captions")}
            title="Captions & Subtitles"
            aria-label="Captions and subtitles"
          >
            <Captions size={21} />
          </button>

        </aside>

        {/* Center Preview Workspace */}
        <div className="ss-preview-center-area">
          <Preview
            videoPath={videoPath}
            inputLogPath={isBrowserPreview ? "" : inputLogPath}
            config={config}
            keyframes={keyframes}
            onKeyframesChange={setKeyframes}
            playing={playing}
            onDuration={(d) => {
              setDuration(d);
              setConfig((c) => (c.trimEnd === 0 ? { ...c, trimEnd: d } : c));
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
              layers: c.layers.map((layer) => layer.id === updated.id ? updated : layer),
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
          />
        </div>

        {/* Right Tool Settings Panel Drawer */}
        <Panels
          config={config}
          onConfigChange={setConfig}
          duration={duration}
          currentTime={currentTime}
          layers={config.layers}
          selectedLayerId={selectedLayerId}
          onAddLayer={(layer: Layer) => setConfig((c) => ({ ...c, layers: [...c.layers, layer] }))}
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
          audioStatus={audioStatus}
          captionTracks={captionTracks}
          onCaptionTracksChange={setCaptionTracks}
          selectedCaption={selectedCaption}
          onSelectCaption={setSelectedCaption}
        />
      </div>

      {/* ── Multi-Track Timeline (Screen Studio Style) ─────────────── */}
      <Timeline
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
          layers: current.layers.map((layer) => layer.id === updated.id ? updated : layer),
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
          if (segment && (currentTime < segment.startMs / 1000 || currentTime > segment.endMs / 1000)) seekTo(segment.startMs / 1000 + .01);
        }}
        onCaptionSegmentChange={(trackId, segment) => setCaptionTracks((tracks) => tracks.map((track) => track.id === trackId ? { ...track, segments: track.segments.map((item) => item.id === segment.id ? segment : item) } : track))}
        onCaptionSegmentDuplicate={(trackId, segmentId) => setCaptionTracks((tracks) => tracks.map((track) => {
          if (track.id !== trackId) return track;
          const source = track.segments.find((segment) => segment.id === segmentId);
          if (!source) return track;
          const durationMs = Math.max(100, source.endMs - source.startMs);
          const projectEndMs = Math.round((config.trimEnd || duration) * 1000);
          const startMs = Math.min(Math.max(Math.round(config.trimStart * 1000), source.endMs + 100), Math.max(0, projectEndMs - durationMs));
          const copy = { ...source, id: `caption-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, startMs, endMs: startMs + durationMs, userEdited: true };
          return { ...track, segments: [...track.segments, copy].sort((a, b) => a.startMs - b.startMs) };
        }))}
        onPlaybackRateChange={(playbackRate) => setConfig((current) => ({ ...current, playbackRate }))}
        onCaptionSegmentDelete={(trackId, segmentId) => {
          setCaptionTracks((tracks) => tracks.map((track) => track.id === trackId ? { ...track, segments: track.segments.filter((segment) => segment.id !== segmentId) } : track));
          if (selectedCaption?.trackId === trackId && selectedCaption.segmentId === segmentId) setSelectedCaption(null);
        }}
      />
      {showExport && (
        <ExportModal
          videoPath={videoPath}
          duration={duration}
          config={config}
          captionTrackCount={captionTracks.length}
          status={exportStatus}
          progress={exportProgress}
          onClose={() => setShowExport(false)}
          onExport={handleExport}
        />
      )}
    </div>
  );
}
