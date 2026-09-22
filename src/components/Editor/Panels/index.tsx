import { useEffect, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { MousePointer, MousePointer2, Triangle, Diamond, Star, Square, Circle, Minus, ArrowLeft, ArrowRight, Hand, PenLine, Slash, Radio, Disc3, LocateFixed, Sparkles, PartyPopper, Snowflake, ScanSearch, Blend, Search, Trash2, FlipHorizontal2, FlipVertical2, AlignLeft, AlignCenter, AlignRight, AudioWaveform, Languages, Check, ChevronDown, Plus, Music2, ImagePlus, X, Palette, WandSparkles, FolderPlus, Folder, FileAudio, FileImage, FileVideo, UploadCloud, Captions, type LucideIcon } from "lucide-react";
import type { AudioTrack, CaptionTrack, CaptionSegmentSelection, EditorConfig, CursorPackInfo, Layer, TextLayer, ShapeLayer, MaskLayer, ClickEffect, MovementSpeed, ZoomRegionSettings, AutoZoomPreset } from "../../../lib/types";
import { AUTO_ZOOM_PRESETS } from "../../../lib/types";
import { GRADIENT_PRESETS, COLOR_PRESETS, WALLPAPER_PRESETS, gradientToCss, type GradientPreset } from "../../../lib/wallpapers";
import { preloadImageAsset } from "../../../lib/canvasDraw";
import { getTranscriptionEnvironment, transcribeTrack, updateCaptionTiming, type TranscriptionEnvironment, type TranscriptionLanguage, type TranscriptionModel } from "../../../lib/captions";
import type { SidebarToolTab } from "../Editor";
import Slider, { ColorInput } from "../../shared/Slider";
import "./Panels.css";

interface Props {
  config: EditorConfig;
  onConfigChange: (cfg: EditorConfig) => void;
  duration: number;
  currentTime: number;
  layers: Layer[];
  selectedLayerId: string | null;
  onAddLayer: (layer: Layer) => void;
  onSelectLayer: (id: string | null) => void;
  activeTab: SidebarToolTab;
  onAddManualZoom: () => void;
  onRegenerateAutoZoom: () => void;
  onZoomModeChange: (mode: "auto" | "manual") => void;
  selectedZoomRegion: ZoomRegionSettings | null;
  onSelectedZoomChange: (patch: Partial<ZoomRegionSettings>) => void;
  onClearSelectedZoom: () => void;
  onDeleteSelectedZoom: () => void;
  audioTracks: AudioTrack[];
  audioError: string;
  onAddAudio: () => void;
  onAddAudioSources: (paths: string[]) => Promise<void>;
  onAddManualCaption: () => void;
  onAudioTracksChange: (tracks: AudioTrack[]) => void;
  captionTracks: CaptionTrack[];
  onCaptionTracksChange: (tracks: CaptionTrack[]) => void;
  selectedCaption: CaptionSegmentSelection | null;
  onSelectCaption: (selection: CaptionSegmentSelection | null) => void;
}
const CLICK_EFFECTS: { value: ClickEffect; label: string }[] = [
  { value: "none", label: "None" },
  { value: "default", label: "Default" },
  { value: "ripple", label: "Ripple" },
  { value: "ring", label: "Ring" },
  { value: "diffusion", label: "Diffusion" },
  { value: "spotlight", label: "Spotlight" },
  { value: "sparkle", label: "Sparkle" },
  { value: "firework", label: "Firework" },
  { value: "christmas", label: "Christmas" },
];

const TRANSCRIPTION_MODEL_LABELS: Record<TranscriptionModel, string> = {
  auto: "Automatic",
  tiny: "Tiny",
  base: "Base",
  small: "Small",
  medium: "Medium",
  "large-v3-turbo": "Large v3 Turbo",
};

const TRANSCRIPTION_MODEL_SIZES: Record<Exclude<TranscriptionModel, "auto">, string> = {
  tiny: "75 MB",
  base: "142 MB",
  small: "466 MB",
  medium: "1.5 GB",
  "large-v3-turbo": "1.5 GB",
};

const CAPTION_MODEL_OPTIONS: Array<{ value: TranscriptionModel; label: string; description: string }> = [
  { value: "auto", label: "Automatic", description: "Best installed model" },
  { value: "tiny", label: "Tiny", description: "75 MB · Fastest" },
  { value: "base", label: "Base", description: "142 MB · Balanced" },
  { value: "small", label: "Small", description: "466 MB · Accurate" },
  { value: "medium", label: "Medium", description: "1.5 GB · Higher accuracy" },
  { value: "large-v3-turbo", label: "Large v3 Turbo", description: "1.5 GB · Best quality" },
];
const MEDIA_LIBRARY_KEY = "snap.editorMediaLibrary.v1";
type MediaKind = "image" | "audio" | "video";
interface MediaFolder { id: string; name: string }
interface MediaAsset { id: string; name: string; path: string; kind: MediaKind; folderId: string | null }

function mediaKind(path: string): MediaKind {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "webp", "bmp", "gif"].includes(extension)) return "image";
  if (["wav", "mp3", "m4a", "aac", "flac", "ogg", "opus", "wma"].includes(extension)) return "audio";
  return "video";
}

const CLICK_EFFECT_ICONS: Record<ClickEffect, LucideIcon> = {
  none: Slash,
  default: MousePointer2,
  ripple: Radio,
  ring: Circle,
  diffusion: Disc3,
  spotlight: LocateFixed,
  sparkle: Sparkles,
  firework: PartyPopper,
  christmas: Snowflake,
};

export default function Panels({
  config, onConfigChange, duration, currentTime,
  layers, selectedLayerId, onAddLayer, onSelectLayer,
  activeTab, onAddManualZoom, onRegenerateAutoZoom, onZoomModeChange,
  selectedZoomRegion, onSelectedZoomChange, onClearSelectedZoom, onDeleteSelectedZoom,
  audioTracks, audioError, onAddAudio, onAddAudioSources, onAddManualCaption, onAudioTracksChange, captionTracks, onCaptionTracksChange, selectedCaption, onSelectCaption,
}: Props) {
  const [cursorPacks, setCursorPacks] = useState<CursorPackInfo[]>([]);
  const [cursorPacksError, setCursorPacksError] = useState("");
  const [bgCategory, setBgCategory] = useState<"gradient" | "color" | "image">("gradient");
  const [customGradient, setCustomGradient] = useState({ start: "#7c3aed", middle: "#ec4899", end: "#f59e0b", angle: 135 });
  const annotationDrawerRef = useRef<HTMLDivElement>(null);
  const [captionSource, setCaptionSource] = useState("");
  const [captionLanguage, setCaptionLanguage] = useState<TranscriptionLanguage>("auto");
  const [captionModel, setCaptionModel] = useState<TranscriptionModel>("auto");
  const [transcriptionEnv, setTranscriptionEnv] = useState<TranscriptionEnvironment | null>(null);
  const [captionStatus, setCaptionStatus] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [installingTranscription, setInstallingTranscription] = useState(false);
  const [cancellingTranscription, setCancellingTranscription] = useState(false);
  const [installProgress, setInstallProgress] = useState(0);
  const [installPhase, setInstallPhase] = useState("");
  const [mediaLibrary, setMediaLibrary] = useState<{ folders: MediaFolder[]; assets: MediaAsset[] }>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(MEDIA_LIBRARY_KEY) || "{}");
      return { folders: Array.isArray(parsed.folders) ? parsed.folders : [], assets: Array.isArray(parsed.assets) ? parsed.assets : [] };
    } catch { return { folders: [], assets: [] }; }
  });
  const [mediaSearch, setMediaSearch] = useState("");
  const [activeMediaFolder, setActiveMediaFolder] = useState("all");
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  const update = (patch: Partial<EditorConfig>) => onConfigChange({ ...config, ...patch });
  const updateCursor = (patch: Partial<EditorConfig["cursorStyle"]>) =>
    onConfigChange({ ...config, cursorStyle: { ...config.cursorStyle, ...patch } });
  const updateShadow = (patch: Partial<EditorConfig["shadow"]>) =>
    onConfigChange({ ...config, shadow: { ...config.shadow, ...patch } });
  const updateBlur = (patch: Partial<EditorConfig["motionBlur"]>) =>
    onConfigChange({ ...config, motionBlur: { ...config.motionBlur, ...patch } });
  const updateCursorMov = (patch: Partial<EditorConfig["cursorMovement"]>) =>
    onConfigChange({ ...config, cursorMovement: { ...config.cursorMovement, ...patch } });
  const updateZoomMov = (patch: Partial<EditorConfig["zoomMovement"]>) =>
    onConfigChange({ ...config, zoomMovement: { ...config.zoomMovement, ...patch } });
  const updateAutoZoom = (patch: Partial<EditorConfig["autoZoom"]>) =>
    onConfigChange({ ...config, autoZoom: { ...config.autoZoom, ...patch, preset: patch.preset ?? "custom" } });
  const applyAutoZoomPreset = (preset: AutoZoomPreset) => {
    if (preset === "custom") return updateAutoZoom({ preset });
    onConfigChange({ ...config, autoZoom: { preset, ...AUTO_ZOOM_PRESETS[preset] } });
  };
  const updateAudio = (patch: Partial<EditorConfig["audio"]>) =>
    onConfigChange({ ...config, audio: { ...config.audio, ...patch } });

  const applyAudioPreset = (preset: "balanced" | "voice" | "system" | "reset") => {
    const mix = preset === "voice"
      ? { systemVolume: 55, micVolume: 115, systemMuted: false, micMuted: false }
      : preset === "system"
        ? { systemVolume: 115, micVolume: 55, systemMuted: false, micMuted: false }
        : { systemVolume: 100, micVolume: 100, systemMuted: false, micMuted: false };
    onConfigChange({ ...config, audio: { ...config.audio, ...mix } });
    if (preset === "reset") onAudioTracksChange(audioTracks.map((track) => ({ ...track, muted: false, volume: 1 })));
  };

  useEffect(() => { localStorage.setItem(MEDIA_LIBRARY_KEY, JSON.stringify(mediaLibrary)); }, [mediaLibrary]);

  const importMedia = async () => {
    const selected = await openDialog({
      multiple: true,
      directory: false,
      title: "Upload media",
      filters: [{ name: "Media", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif", "wav", "mp3", "m4a", "aac", "flac", "ogg", "opus", "wma", "mp4", "mov", "mkv", "webm"] }],
    });
    const paths = typeof selected === "string" ? [selected] : selected ?? [];
    if (!paths.length) return;
    setMediaLibrary((current) => {
      const known = new Set(current.assets.map((asset) => asset.path.toLowerCase()));
      const folderId = activeMediaFolder !== "all" && activeMediaFolder !== "unfiled" ? activeMediaFolder : null;
      const additions = paths.filter((path) => !known.has(path.toLowerCase())).map((path, index) => ({
        id: `media-${Date.now()}-${index}`, path, folderId, kind: mediaKind(path),
        name: path.split(/[\\/]/).pop() || `Media ${index + 1}`,
      }));
      return { ...current, assets: [...current.assets, ...additions] };
    });
  };

  const createMediaFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    const folder = { id: `folder-${Date.now()}`, name };
    setMediaLibrary((current) => ({ ...current, folders: [...current.folders, folder] }));
    setActiveMediaFolder(folder.id);
    setNewFolderName("");
    setCreatingFolder(false);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try { const packs = await invoke<CursorPackInfo[]>("list_cursor_packs"); if (alive) setCursorPacks(packs); }
      catch (e) { if (alive) setCursorPacksError(`Failed to load cursor packs: ${e}`); }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (activeTab !== "captions" || transcriptionEnv) return;
    void getTranscriptionEnvironment()
      .then(setTranscriptionEnv)
      .catch((error) => setCaptionStatus(`Unable to inspect transcription engine: ${error}`));
  }, [activeTab, transcriptionEnv]);

  useEffect(() => {
    if (audioTracks.some((track) => track.id === captionSource)) return;
    const preferred = audioTracks.find((track) => track.kind === "microphone") ?? audioTracks[0];
    setCaptionSource(preferred?.id ?? "");
  }, [audioTracks, captionSource]);

  const generateCaptions = async () => {
    const modelReady = !transcriptionEnv || (captionModel === "auto"
      ? transcriptionEnv.available
      : transcriptionEnv.available && transcriptionEnv.installedModels?.includes(captionModel));
    if (!modelReady) {
      setCaptionStatus("Install the selected model before generating captions.");
      return;
    }
    setTranscribing(true);
    const selectedSource = audioTracks.find((track) => track.id === captionSource);
    setCaptionStatus(`Transcribing ${selectedSource?.label ?? "audio"}…`);
    try {
      const sourceTrack = audioTracks.find((track) => track.id === captionSource);
      if (!sourceTrack) throw new Error("Choose an audio track to transcribe");
      const track = await transcribeTrack(sourceTrack, captionLanguage, captionModel);
      if (track.segments.length === 0) {
        setCaptionStatus("No audible speech was found on this track. No caption layer was added.");
        return;
      }
      const existingIndex = captionTracks.findIndex((candidate) =>
        candidate.sourceTrackIds.length === 1 && candidate.sourceTrackIds[0] === sourceTrack.id
      );
      if (existingIndex >= 0) {
        onCaptionTracksChange(captionTracks.map((candidate, index) => index === existingIndex ? {
          ...track,
          id: candidate.id,
          visible: candidate.visible,
          burnedIn: candidate.burnedIn,
          style: { ...track.style, ...candidate.style, animation: "none", animationDurationMs: 0 },
        } : candidate));
        setCaptionStatus(`Re-synced ${track.segments.length} captions to the speech waveform`);
      } else {
        onCaptionTracksChange([...captionTracks, track]);
        setCaptionStatus(`Created ${track.segments.length} speech-synced caption segments`);
      }
    } catch (error) {
      setCaptionStatus(`Transcription failed: ${error}`);
    } finally {
      setTranscribing(false);
    }
  };

  const installTranscription = async (model: TranscriptionModel = "base") => {
    setInstallingTranscription(true);
    setInstallProgress(0);
    const requestedModel = model === "auto" ? "base" : model;
    setCaptionStatus(`Downloading the offline engine and ${requestedModel} model…`);
    const unlisten = await listen<{ percent: number; phase: string }>("transcription-install-progress", ({ payload }) => {
      setInstallProgress(payload.percent);
      setInstallPhase(payload.phase);
    });
    try {
      const environment = model === "auto"
        ? await invoke<TranscriptionEnvironment>("install_transcription_dependencies")
        : await invoke<TranscriptionEnvironment>("install_transcription_model", { model: requestedModel });
      setTranscriptionEnv(environment);
      setCaptionStatus(`${TRANSCRIPTION_MODEL_LABELS[requestedModel]} model installed and ready`);
    } catch (error) {
      setCaptionStatus(String(error).toLowerCase().includes("cancel")
        ? "Model download cancelled. You can restart it whenever you are ready."
        : `Installation failed: ${error}`);
    } finally {
      unlisten();
      setInstallingTranscription(false);
      setCancellingTranscription(false);
    }
  };

  const cancelTranscriptionInstall = async () => {
    setCancellingTranscription(true);
    setCaptionStatus("Cancelling model download…");
    try {
      await invoke("cancel_transcription_install");
    } catch (error) {
      setCancellingTranscription(false);
      setCaptionStatus(`Unable to cancel download: ${error}`);
    }
  };

  const updateCaptionTrack = (trackId: string, updater: (track: CaptionTrack) => CaptionTrack) => {
    onCaptionTracksChange(captionTracks.map((track) => track.id === trackId ? updater(track) : track));
  };

  useEffect(() => {
    // The 4K/8K originals remain available to export, while the editor warms
    // compact preview images after its first paint. This keeps opening Images
    // and switching backgrounds responsive even on slower disks.
    const timer = window.setTimeout(() => {
      WALLPAPER_PRESETS.forEach((preset) => {
        preloadImageAsset(preset.thumbnailUrl);
        preloadImageAsset(preset.previewUrl);
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, []);

  const packHotspotOrDefault = (packId: string): { x: number; y: number } => {
    const stored = config.cursorHotspots[packId];
    if (stored) return stored;
    return /\bhand\b/i.test(packId) ? { x: 20, y: 0 } : { x: 10, y: 10 };
  };

  const selectPack = (pack: CursorPackInfo) => {
    onConfigChange({
      ...config,
      cursorStyle: { ...config.cursorStyle, pack: { id: pack.name, label: pack.label, imageUrl: pack.pointer_url } },
      cursorHotspots: { ...config.cursorHotspots, [pack.name]: packHotspotOrDefault(pack.name) },
    });
  };

  const applyCustomGradient = (patch: Partial<typeof customGradient> = {}) => {
    const next = { ...customGradient, ...patch };
    setCustomGradient(next);
    const encoded = `custom-gradient|linear|${next.angle}|${next.start}|${next.middle}|${next.end}`;
    update({ bgType: "gradient", wallpaperUrl: encoded });
  };

  const importBackgroundImage = async () => {
    const selected = await openDialog({
      multiple: false,
      directory: false,
      title: "Choose a background image",
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }],
    });
    if (!selected || Array.isArray(selected)) return;
    update({ bgType: "image", wallpaperUrl: selected });
  };

  const clearPack = () => updateCursor({ pack: null });

  const addLayer = (layer: Layer) => {
    onAddLayer(layer);
    onSelectLayer(layer.id);
  };

  const genId = () => `layer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const layerTiming = () => {
    const clipEnd = config.trimEnd > 0 ? Math.min(duration, config.trimEnd) : duration;
    const start = Math.max(config.trimStart, currentTime - 0.15);
    return { start, end: Math.max(start, Math.min(clipEnd, currentTime + 3)) };
  };

  const makeTextLayer = (style: TextLayer["style"]): TextLayer => {
    const timing = layerTiming();
    return {
      id: genId(), type: "text", ...timing, x: 0.2, y: 0.4, w: 0.6, h: 0.16,
      content: "Text", style, color: "#ffffff", fontSize: 24,
      fontFamily: "system", fontWeight: 700, align: "center", backgroundColor: "#059669",
      letterSpacing: 0, opacity: 1, rotation: 0, flipX: false, flipY: false,
    };
  };

  const makeShapeLayer = (shape: ShapeLayer["shape"], color: string): ShapeLayer => {
    const timing = layerTiming();
    return {
      id: genId(), type: "shape", ...timing, x: 0.3, y: 0.3, w: 0.4, h: 0.4,
      shape, color, strokeWidth: 4, fillColor: color, fillOpacity: ["downArrow", "pointer"].includes(shape) ? 1 : 0,
      strokeOpacity: 1, cornerRadius: 18, opacity: 1, rotation: 0, flipX: false, flipY: false,
    };
  };

  const makeMaskLayer = (mask: MaskLayer["mask"]): MaskLayer => {
    const timing = layerTiming();
    return {
      id: genId(), type: "mask", ...timing, x: 0.32, y: 0.28, w: 0.36, h: 0.34,
      mask, intensity: mask === "blur" ? 12 : mask === "magnifier" ? 2.0 : 1,
      feather: 8, opacity: 1,
    };
  };

  // ── Layers list ───────────────────────────────────────────────────
  const deleteLayer = (id: string) => {
    onConfigChange({ ...config, layers: config.layers.filter((l) => l.id !== id) });
    if (selectedLayerId === id) onSelectLayer(null);
  };
  const selectedLayer = layers.find((layer) => layer.id === selectedLayerId) ?? null;
  const selectedCaptionTrack = selectedCaption ? captionTracks.find((track) => track.id === selectedCaption.trackId) ?? null : null;
  const selectedCaptionSegment = selectedCaptionTrack?.segments.find((segment) => segment.id === selectedCaption?.segmentId) ?? null;
  const captionModelReady = Boolean(transcriptionEnv && (captionModel === "auto"
    ? transcriptionEnv.available
    : transcriptionEnv.available && transcriptionEnv.installedModels?.includes(captionModel)));
  const visibleMedia = mediaLibrary.assets.filter((asset) => {
    const folderMatch = activeMediaFolder === "all" || (activeMediaFolder === "unfiled" ? !asset.folderId : asset.folderId === activeMediaFolder);
    return folderMatch && asset.name.toLowerCase().includes(mediaSearch.trim().toLowerCase());
  });
  const updateSelectedLayer = (patch: Partial<Layer>) => {
    if (!selectedLayer) return;
    onConfigChange({ ...config, layers: config.layers.map((layer) => layer.id === selectedLayer.id ? ({ ...layer, ...patch } as Layer) : layer) });
  };

  useEffect(() => {
    if (selectedLayerId && annotationDrawerRef.current) annotationDrawerRef.current.scrollTop = 0;
  }, [selectedLayerId]);

  const customGradientPreset: GradientPreset = {
    id: "custom-gradient-preview",
    name: "Custom gradient",
    type: "linear",
    angle: customGradient.angle,
    colors: [
      { color: customGradient.start, offset: 0 },
      { color: customGradient.middle, offset: 50 },
      { color: customGradient.end, offset: 100 },
    ],
  };

  return (
    <aside className="ss-panels-drawer">
      {activeTab === "uploads" && (
        <div className="ss-drawer-content uploads-drawer-content">
          <div className="media-library-actions">
            <button type="button" className="media-upload-primary" onClick={() => void importMedia()}><UploadCloud size={16} /> Upload media</button>
            <button type="button" className="media-folder-button" title="Create folder" aria-label="Create media folder" onClick={() => setCreatingFolder((value) => !value)}><FolderPlus size={16} /></button>
          </div>
          {creatingFolder && <div className="media-new-folder"><input autoFocus value={newFolderName} placeholder="Folder name" onChange={(event) => setNewFolderName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") createMediaFolder(); if (event.key === "Escape") setCreatingFolder(false); }} /><button type="button" onClick={createMediaFolder}><Check size={14} /></button></div>}
          <label className="media-search"><Search size={15} /><input value={mediaSearch} onChange={(event) => setMediaSearch(event.target.value)} placeholder="Search media" /></label>
          <div className="media-folder-strip" aria-label="Media folders">
            <button className={activeMediaFolder === "all" ? "active" : ""} onClick={() => setActiveMediaFolder("all")}>All <span>{mediaLibrary.assets.length}</span></button>
            <button className={activeMediaFolder === "unfiled" ? "active" : ""} onClick={() => setActiveMediaFolder("unfiled")}>Unfiled</button>
            {mediaLibrary.folders.map((folder) => <button className={activeMediaFolder === folder.id ? "active" : ""} key={folder.id} onClick={() => setActiveMediaFolder(folder.id)}><Folder size={12} />{folder.name}</button>)}
          </div>
          <div className="media-asset-list">
            {visibleMedia.map((asset) => {
              const Icon = asset.kind === "image" ? FileImage : asset.kind === "audio" ? FileAudio : FileVideo;
              return <article className="media-asset-card" key={asset.id}>
                <span className={`media-kind-icon ${asset.kind}`}><Icon size={17} /></span>
                <span className="media-asset-name"><strong title={asset.name}>{asset.name}</strong><small>{asset.kind}</small></span>
                {asset.kind === "audio" && <button title="Add to timeline" onClick={() => void onAddAudioSources([asset.path])}><Music2 size={14} /></button>}
                {asset.kind === "image" && <button title="Use as background" onClick={() => update({ bgType: "image", wallpaperUrl: asset.path })}><ImagePlus size={14} /></button>}
                <button className="danger" title="Remove from library" onClick={() => setMediaLibrary((current) => ({ ...current, assets: current.assets.filter((item) => item.id !== asset.id) }))}><X size={14} /></button>
                <select aria-label={`Folder for ${asset.name}`} value={asset.folderId ?? ""} onChange={(event) => setMediaLibrary((current) => ({ ...current, assets: current.assets.map((item) => item.id === asset.id ? { ...item, folderId: event.target.value || null } : item) }))}>
                  <option value="">Unfiled</option>
                  {mediaLibrary.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                </select>
              </article>;
            })}
            {visibleMedia.length === 0 && <div className="media-library-empty"><UploadCloud size={22} /><strong>No media here</strong><span>Upload files or choose another folder.</span></div>}
          </div>
        </div>
      )}
      {/* ═══ CANVAS TAB ═══════════════════════════════════════════════ */}
      {activeTab === "canvas" && (
        <div className="ss-drawer-content canvas-drawer-content">
          <Section title="Canvas Styling">
            <Slider label="Padding" value={config.padding} min={0} max={160} step={4} unit="px" onChange={(v) => update({ padding: v })} defaultValue={48} onReset={() => update({ padding: 48 })} />
            <Slider label="Roundness" value={config.borderRadius} min={0} max={60} step={1} unit="px" onChange={(v) => update({ borderRadius: v })} defaultValue={14} onReset={() => update({ borderRadius: 14 })} />
            <Slider label="Shadow" value={config.shadow.blur} min={0} max={100} step={2} unit="px" onChange={(v) => updateShadow({ blur: v })} defaultValue={40} onReset={() => updateShadow({ blur: 40 })} />
            <Slider label="Inset" value={config.inset} min={0} max={40} step={1} unit="px" onChange={(v) => update({ inset: v })} defaultValue={0} onReset={() => update({ inset: 0 })} />
            <ColorInput label="Inset color" value={config.insetColor} onChange={(insetColor) => update({ insetColor })} />
          </Section>

          <Section title="Background">
            <div className="ss-subtab-segmented animated-pills" style={{ "--pill-count": 3, "--pill-index": bgCategory === "gradient" ? 0 : bgCategory === "color" ? 1 : 2 } as CSSProperties}>
              {(["gradient", "color", "image"] as const).map((cat) => (
                <button key={cat} className={`subtab-btn ${bgCategory === cat ? "active" : ""}`} onClick={() => setBgCategory(cat)}>
                  {cat === "gradient" ? "Gradients" : cat === "color" ? "Colors" : "Images"}
                </button>
              ))}
            </div>
            {bgCategory === "gradient" && (
              <>
                <div className="ss-wallpaper-grid swatch-grid">
                  {GRADIENT_PRESETS.map((preset) => (
                    <button
                      type="button"
                      key={preset.id}
                      className={`ss-wallpaper-card background-swatch ${config.bgType === "gradient" && config.wallpaperUrl === preset.id ? "active" : ""}`}
                      style={{ background: gradientToCss(preset) }}
                      onClick={() => update({ bgType: "gradient", wallpaperUrl: preset.id })}
                      title={preset.name}
                    />
                  ))}
                </div>
                <div className="custom-gradient-builder">
                  <div className="custom-gradient-preview" style={{ background: gradientToCss(customGradientPreset) }}><span>Custom</span></div>
                  <div className="custom-gradient-stops">
                    {(["start", "middle", "end"] as const).map((stop) => <input key={stop} type="color" value={customGradient[stop]} onChange={(event) => applyCustomGradient({ [stop]: event.target.value })} aria-label={`${stop} gradient color`} />)}
                  </div>
                  <Slider label="Angle" value={customGradient.angle} min={0} max={360} step={5} unit="°" onChange={(angle) => applyCustomGradient({ angle })} />
                  <button type="button" className="apply-gradient-button" onClick={() => applyCustomGradient()}>Apply custom gradient</button>
                </div>
              </>
            )}
            {bgCategory === "color" && (
              <>
                <div className="ss-wallpaper-grid swatch-grid">
                  {COLOR_PRESETS.map((preset) => (
                    <button
                      type="button"
                      key={preset.id}
                      className={`ss-wallpaper-card background-swatch color-swatch-card ${config.bgType === "color" && config.backgroundColor === preset.color ? "active" : ""}`}
                      style={{ background: preset.color }}
                      onClick={() => update({ bgType: "color", backgroundColor: preset.color })}
                      title={preset.name}
                    />
                  ))}
                </div>
                <div className="custom-background-color">
                  <ColorInput label="Custom color" value={config.backgroundColor} onChange={(backgroundColor) => update({ bgType: "color", backgroundColor })} />
                </div>
              </>
            )}
            {bgCategory === "image" && (
              <>
                <div className="ss-wallpaper-grid image-grid">
                  <button type="button" className="ss-wallpaper-card custom-image-card" onClick={() => void importBackgroundImage()} title="Add your own image"><ImagePlus size={22} /><span>Add image</span></button>
                  {WALLPAPER_PRESETS.map((preset) => (
                    <button
                      type="button"
                      key={preset.id}
                      className={`ss-wallpaper-card ${config.bgType === "image" && config.wallpaperUrl === preset.id ? "active" : ""}`}
                      style={{ backgroundImage: `url(${preset.thumbnailUrl})` }}
                      onPointerEnter={() => preloadImageAsset(preset.previewUrl)}
                      onClick={() => update({ bgType: "image", wallpaperUrl: preset.id })}
                      title={preset.name}
                    />
                  ))}
                </div>
                <Slider label="Blur Radius" value={config.bgBlur} min={0} max={100} step={2} unit="px" onChange={(v) => update({ bgBlur: v })} />
              </>
            )}
          </Section>
        </div>
      )}

      {/* ═══ CURSOR TAB ═══════════════════════════════════════════════ */}
      {activeTab === "cursor" && (
        <div className="ss-drawer-content">
          <Section title="Cursor">
            <Slider label="Cursor Size" value={config.cursorStyle.size} min={8} max={40} step={1} unit="px" onChange={(v) => updateCursor({ size: v })} defaultValue={16} onReset={() => updateCursor({ size: 16 })} />

            <div className="cursor-pack-grid">
              <button type="button" className={`cursor-pack-card icon-choice ${!config.cursorStyle.pack ? "active" : ""}`} onClick={clearPack} aria-label="Default cursor" data-tooltip="Default">
                <div className="cursor-pack-thumb default-thumb"><MousePointer size={16} /></div>
              </button>
              {cursorPacks.map((pack) => (
                <button
                  type="button"
                  key={pack.name}
                  className={`cursor-pack-card icon-choice ${config.cursorStyle.pack?.id === pack.name ? "active" : ""}`}
                  onClick={() => selectPack(pack)}
                  aria-label={`${pack.label} cursor`}
                  data-tooltip={pack.label}
                >
                  <div className="cursor-pack-thumb"><img src={pack.pointer_url} alt={pack.label} draggable={false} /></div>
                </button>
              ))}
            </div>
            {cursorPacksError && <p className="cursor-pack-error">{cursorPacksError}</p>}

            {!config.cursorStyle.pack && (
              <ColorInput label="Cursor Color" value={config.cursorStyle.color} onChange={(v) => updateCursor({ color: v })} />
            )}
          </Section>

          <Section title="Click Effect">
            <div className="effect-grid">
              {CLICK_EFFECTS.map((eff) => (
                <button
                  type="button"
                  key={eff.value}
                  className={`effect-card icon-choice ${config.cursorStyle.clickEffect === eff.value ? "active" : ""}`}
                  onClick={() => updateCursor({ clickEffect: eff.value })}
                  aria-label={`${eff.label} click effect`}
                  data-tooltip={eff.label}
                >
                  <EffectThumbnail effect={eff.value} />
                </button>
              ))}
            </div>
          </Section>

          <Section title="Cursor Behavior">
            <CheckRow label="Show Cursor" checked={config.showCursor} onChange={(v) => update({ showCursor: v })} />
            <CheckRow label="Click Sound" checked={config.cursorStyle.clickSound} onChange={(v) => updateCursor({ clickSound: v })} />
            <CheckRow label="Hide When Idle" checked={config.cursorStyle.hideWhenIdle} onChange={(v) => updateCursor({ hideWhenIdle: v })} />
          </Section>
        </div>
      )}

      {/* ═══ ANNOTATIONS TAB ═══════════════════════════════════════════ */}
      {activeTab === "annotations" && (
        <div ref={annotationDrawerRef} className={`ss-drawer-content ${selectedLayer ? "layer-inspector-mode" : ""}`}>
          {!selectedLayer && <>
          <Section title="Text">
            <div className="annotation-card-grid">
              {(["plain", "boxed", "pill"] as TextLayer["style"][]).map((style) => (
                <button type="button" key={style} className="annotation-card icon-choice" onClick={() => addLayer(makeTextLayer(style))} aria-label={`Add ${style} text`} data-tooltip={style.charAt(0).toUpperCase() + style.slice(1)}>
                  <div className={`annotation-preview text-preview text-preview-${style}`}>
                    <span className="text-style-example">{style === "plain" ? "Text" : style === "boxed" ? "Boxed" : "Pill"}</span>
                  </div>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Shape">
            <div className="annotation-card-grid">
              {([
                { shape: "triangle" as const, label: "Triangle", icon: <Triangle size={18} /> },
                { shape: "diamond" as const, label: "Diamond", icon: <Diamond size={18} /> },
                { shape: "star" as const, label: "Star", icon: <Star size={18} /> },
                { shape: "line" as const, label: "Line", icon: <Minus size={17} /> },
                { shape: "dashedLine" as const, label: "Dashed", icon: <PenLine size={17} /> },
                { shape: "arrow" as const, label: "Arrow", icon: <ArrowRight size={17} /> },
                { shape: "rectangle" as const, label: "Rectangle", icon: <Square size={17} /> },
                { shape: "roundedRect" as const, label: "Rounded", icon: <Square size={17} /> },
                { shape: "circle" as const, label: "Circle", icon: <Circle size={17} /> },
                { shape: "blob" as const, label: "Ellipse", icon: <Circle size={17} /> },
                { shape: "downArrow" as const, label: "Down", icon: <ArrowRight size={17} style={{ transform: "rotate(90deg)" }} /> },
                { shape: "pointer" as const, label: "Pointer", icon: <Hand size={17} /> },
              ]).map(({ shape, label, icon }) => (
                <button type="button" key={shape} className="annotation-card icon-choice" onClick={() => addLayer(makeShapeLayer(shape, "#e8e8e4"))} aria-label={`Add ${label}`} data-tooltip={label}>
                  <div className="annotation-preview">{icon}</div>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Mask">
            <div className="annotation-card-grid">
              {([
                { mask: "spotlight" as const, label: "Spotlight", icon: <ScanSearch size={18} /> },
                { mask: "blur" as const, label: "Blur", icon: <Blend size={18} /> },
                { mask: "magnifier" as const, label: "Magnifier", icon: <Search size={18} /> },
              ]).map(({ mask, label, icon }) => (
                <button type="button" key={mask} className="annotation-card icon-choice" onClick={() => addLayer(makeMaskLayer(mask))} aria-label={`Add ${label}`} data-tooltip={label}>
                  <div className={`annotation-preview mask-preview ${mask}`}>
                    {icon}
                  </div>
                </button>
              ))}
            </div>
          </Section>
          </>}
          {selectedLayer && (
            <>
              <div className="layer-inspector-header">
                <button onClick={() => onSelectLayer(null)} title="Back to annotation tools" aria-label="Back to annotation tools"><ArrowLeft size={17} /></button>
                <span><strong>Editing {selectedLayer.type}</strong><small>{selectedLayer.start.toFixed(1)}s–{selectedLayer.end.toFixed(1)}s</small></span>
              </div>
              <Section title={`${selectedLayer.type.charAt(0).toUpperCase() + selectedLayer.type.slice(1)} Properties`}>
                {selectedLayer.type === "text" && (
                  <>
                    <label className="layer-field-stack"><span>Content</span><textarea className="layer-textarea" rows={3} value={selectedLayer.content} onChange={(e) => updateSelectedLayer({ content: e.target.value })} /></label>
                    <SelectRow label="Style" value={selectedLayer.style === "badge" ? "boxed" : selectedLayer.style} options={["plain", "boxed", "pill"]} onChange={(style) => updateSelectedLayer({ style: style as TextLayer["style"] })} />
                    <SelectRow label="Typeface" value={selectedLayer.fontFamily ?? "system"} options={["system", "serif", "mono"]} onChange={(fontFamily) => updateSelectedLayer({ fontFamily: fontFamily as TextLayer["fontFamily"] })} />
                    <SelectRow label="Weight" value={String(selectedLayer.fontWeight ?? 700)} options={["400", "500", "600", "700", "800"]} onChange={(fontWeight) => updateSelectedLayer({ fontWeight: Number(fontWeight) as TextLayer["fontWeight"] })} />
                    <ColorInput label="Text Color" value={selectedLayer.color} onChange={(color) => updateSelectedLayer({ color })} />
                    {selectedLayer.style !== "plain" && <ColorInput label="Background" value={selectedLayer.backgroundColor ?? "#059669"} onChange={(backgroundColor) => updateSelectedLayer({ backgroundColor })} />}
                    <Slider label="Font Size" value={selectedLayer.fontSize} min={10} max={120} step={1} unit="px" onChange={(fontSize) => updateSelectedLayer({ fontSize })} />
                    <Slider label="Letter Space" value={selectedLayer.letterSpacing ?? 0} min={-2} max={12} step={0.5} unit="px" onChange={(letterSpacing) => updateSelectedLayer({ letterSpacing })} />
                    <Slider label="Line Height" value={selectedLayer.lineHeight ?? 1.3} min={1} max={2} step={0.05} unit="×" onChange={(lineHeight) => updateSelectedLayer({ lineHeight })} />
                    {selectedLayer.style !== "plain" && <><Slider label="Padding" value={selectedLayer.padding ?? 12} min={0} max={40} step={1} unit="px" onChange={(padding) => updateSelectedLayer({ padding })} /><Slider label="Corner Radius" value={selectedLayer.cornerRadius ?? 8} min={0} max={60} step={1} unit="px" onChange={(cornerRadius) => updateSelectedLayer({ cornerRadius })} /></>}
                    <div className="layer-icon-pills" aria-label="Text alignment">
                      {([ ["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight] ] as const).map(([align, Icon]) => <button key={align} className={(selectedLayer.align ?? "center") === align ? "active" : ""} onClick={() => updateSelectedLayer({ align })} title={`${align} align`}><Icon size={16} /></button>)}
                    </div>
                  </>
                )}
                {selectedLayer.type === "shape" && (
                  <>
                    <SelectRow label="Shape" value={selectedLayer.shape} options={["line", "dashedLine", "arrow", "rectangle", "roundedRect", "circle", "blob", "downArrow", "pointer", "triangle", "diamond", "star"]} onChange={(shape) => updateSelectedLayer({ shape: shape as ShapeLayer["shape"] })} />
                    <ColorInput label="Stroke" value={selectedLayer.color} onChange={(color) => updateSelectedLayer({ color })} />
                    <ColorInput label="Fill" value={selectedLayer.fillColor ?? selectedLayer.color} onChange={(fillColor) => updateSelectedLayer({ fillColor })} />
                    <Slider label="Stroke Width" value={selectedLayer.strokeWidth} min={1} max={24} step={1} unit="px" onChange={(strokeWidth) => updateSelectedLayer({ strokeWidth })} />
                    <Slider label="Stroke Opacity" value={Math.round((selectedLayer.strokeOpacity ?? 1) * 100)} min={0} max={100} step={1} unit="%" onChange={(value) => updateSelectedLayer({ strokeOpacity: value / 100 })} />
                    <Slider label="Fill Opacity" value={Math.round((selectedLayer.fillOpacity ?? 0) * 100)} min={0} max={100} step={1} unit="%" onChange={(value) => updateSelectedLayer({ fillOpacity: value / 100 })} />
                    {selectedLayer.shape === "roundedRect" && <Slider label="Roundness" value={selectedLayer.cornerRadius ?? 18} min={0} max={80} step={1} unit="px" onChange={(cornerRadius) => updateSelectedLayer({ cornerRadius })} />}
                  </>
                )}
                {selectedLayer.type === "mask" && (
                  <>
                    <SelectRow label="Effect" value={selectedLayer.mask} options={["spotlight", "blur", "magnifier"]} onChange={(mask) => updateSelectedLayer({ mask: mask as MaskLayer["mask"] })} />
                    <Slider label="Intensity" value={selectedLayer.intensity} min={0.5} max={selectedLayer.mask === "blur" ? 40 : 4} step={0.1} onChange={(intensity) => updateSelectedLayer({ intensity })} />
                    <SelectRow label="Mask Shape" value={selectedLayer.shape ?? "ellipse"} options={["ellipse", "rectangle"]} onChange={(shape) => updateSelectedLayer({ shape: shape as MaskLayer["shape"] })} />
                    {selectedLayer.mask === "magnifier" && <><Slider label="Lens Border" value={selectedLayer.borderWidth ?? 3} min={0} max={12} step={1} unit="px" onChange={(borderWidth) => updateSelectedLayer({ borderWidth })} /><ColorInput label="Border Color" value={selectedLayer.borderColor ?? "#ffffff"} onChange={(borderColor) => updateSelectedLayer({ borderColor })} /></>}
                    {selectedLayer.mask !== "blur" && <Slider label={selectedLayer.mask === "magnifier" ? "Lens Shadow" : "Edge Feather"} value={selectedLayer.feather ?? 8} min={0} max={30} step={1} unit="px" onChange={(feather) => updateSelectedLayer({ feather })} />}
                  </>
                )}
              </Section>
              <Section title="Transform">
                <div className="layer-number-grid">
                  <NumberField label="X" value={selectedLayer.x * 100} onChange={(value) => updateSelectedLayer({ x: Math.max(0, Math.min(1 - selectedLayer.w, value / 100)) })} />
                  <NumberField label="Y" value={selectedLayer.y * 100} onChange={(value) => updateSelectedLayer({ y: Math.max(0, Math.min(1 - selectedLayer.h, value / 100)) })} />
                  <NumberField label="W" value={selectedLayer.w * 100} onChange={(value) => updateSelectedLayer({ w: Math.max(.04, Math.min(1 - selectedLayer.x, value / 100)) })} />
                  <NumberField label="H" value={selectedLayer.h * 100} onChange={(value) => updateSelectedLayer({ h: Math.max(.04, Math.min(1 - selectedLayer.y, value / 100)) })} />
                </div>
                {selectedLayer.type !== "mask" && <Slider label="Rotation" value={selectedLayer.rotation ?? 0} min={0} max={360} step={1} unit="°" onChange={(rotation) => updateSelectedLayer({ rotation })} />}
                <Slider label="Opacity" value={Math.round((selectedLayer.opacity ?? 1) * 100)} min={5} max={100} step={1} unit="%" onChange={(value) => updateSelectedLayer({ opacity: value / 100 })} />
                {selectedLayer.type !== "mask" && <div className="layer-icon-pills"><button className={selectedLayer.flipX ? "active" : ""} onClick={() => updateSelectedLayer({ flipX: !selectedLayer.flipX })} title="Flip horizontally"><FlipHorizontal2 size={17} /><span>Flip X</span></button><button className={selectedLayer.flipY ? "active" : ""} onClick={() => updateSelectedLayer({ flipY: !selectedLayer.flipY })} title="Flip vertically"><FlipVertical2 size={17} /><span>Flip Y</span></button></div>}
              </Section>
              <Section title="Timing">
                <Slider label="Start" value={selectedLayer.start} min={config.trimStart} max={Math.max(config.trimStart, selectedLayer.end - .2)} step={0.05} unit="s" onChange={(start) => updateSelectedLayer({ start: Math.min(start, selectedLayer.end - .2) })} />
                <Slider label="End" value={selectedLayer.end} min={selectedLayer.start + .2} max={config.trimEnd || duration} step={0.05} unit="s" onChange={(end) => updateSelectedLayer({ end: Math.max(end, selectedLayer.start + .2) })} />
                <p className="panel-help-text">Drag the timeline bar to move it or trim either edge. On canvas, drag inside to move, use eight handles to scale, and drag the top handle to rotate. Hold Shift to snap rotation.</p>
                <button className="ss-drawer-action-btn danger" onClick={() => deleteLayer(selectedLayer.id)}><Trash2 size={14} /> Delete Layer</button>
              </Section>
            </>
          )}
        </div>
      )}

      {/* ═══ MOTION TAB ═══════════════════════════════════════════════ */}
      {activeTab === "motion" && (
        <div className={`ss-drawer-content motion-drawer-content ${selectedZoomRegion ? "layer-inspector-mode" : ""}`}>
          {selectedZoomRegion ? <>
            <div className="layer-inspector-header">
              <button onClick={onClearSelectedZoom} title="Back to motion tools" aria-label="Back to motion tools"><ArrowLeft size={17} /></button>
              <span><strong>{selectedZoomRegion.source === "auto" ? "Auto zoom" : "Manual zoom"}</strong><small>{(selectedZoomRegion.startMs / 1000).toFixed(1)}s–{(selectedZoomRegion.endMs / 1000).toFixed(1)}s</small></span>
            </div>
            <Section title="Camera framing">
              <div className="selection-source-badge">{selectedZoomRegion.source === "auto" ? "Generated camera move" : "Custom camera move"}</div>
              <Slider label="Zoom amount" value={selectedZoomRegion.scale} min={1.05} max={5} step={0.05} unit="×" onChange={(scale) => onSelectedZoomChange({ scale })} />
              <Slider label="Focus X" value={Math.round(selectedZoomRegion.x * 100)} min={0} max={100} step={1} unit="%" onChange={(value) => onSelectedZoomChange({ x: value / 100 })} />
              <Slider label="Focus Y" value={Math.round(selectedZoomRegion.y * 100)} min={0} max={100} step={1} unit="%" onChange={(value) => onSelectedZoomChange({ y: value / 100 })} />
              <div className="focus-preset-grid" aria-label="Focus point presets">
                {([[.25,.25,"Top left"],[.5,.25,"Top"],[.75,.25,"Top right"],[.25,.5,"Left"],[.5,.5,"Center"],[.75,.5,"Right"],[.25,.75,"Bottom left"],[.5,.75,"Bottom"],[.75,.75,"Bottom right"]] as const).map(([x,y,label]) => <button key={label} title={label} aria-label={label} className={Math.abs(selectedZoomRegion.x-x)<.08 && Math.abs(selectedZoomRegion.y-y)<.08 ? "active" : ""} onClick={() => onSelectedZoomChange({x,y})}><i /></button>)}
              </div>
            </Section>
            <Section title="Motion & timing">
              <Slider label="Transition in" value={selectedZoomRegion.transitionMs} min={40} max={Math.max(80, Math.min(2500, (selectedZoomRegion.endMs - selectedZoomRegion.startMs) / 2))} step={20} unit="ms" onChange={(transitionMs) => onSelectedZoomChange({ transitionMs })} />
              <Slider label="Transition out" value={selectedZoomRegion.exitTransitionMs} min={40} max={Math.max(80, Math.min(2500, (selectedZoomRegion.endMs - selectedZoomRegion.startMs) / 2))} step={20} unit="ms" onChange={(exitTransitionMs) => onSelectedZoomChange({ exitTransitionMs })} />
              <SelectRow label="Motion curve" value={selectedZoomRegion.easing} options={["linear", "ease-in", "ease-out", "ease-in-out", "smoother", "sine"]} optionLabels={{ linear: "Linear", "ease-in": "Ease In", "ease-out": "Ease Out", "ease-in-out": "Smooth", smoother: "Cinematic", sine: "Gentle Sine" }} onChange={(easing) => onSelectedZoomChange({ easing: easing as ZoomRegionSettings["easing"] })} />
              <Slider label="Start" value={selectedZoomRegion.startMs / 1000} min={config.trimStart} max={Math.max(config.trimStart, selectedZoomRegion.endMs / 1000 - 0.35)} step={0.05} unit="s" onChange={(value) => onSelectedZoomChange({ startMs: value * 1000 })} />
              <Slider label="End" value={selectedZoomRegion.endMs / 1000} min={selectedZoomRegion.startMs / 1000 + 0.35} max={config.trimEnd || duration} step={0.05} unit="s" onChange={(value) => onSelectedZoomChange({ endMs: value * 1000 })} />
              <p className="panel-help-text">Drag the focus marker in the preview or use the nine-point framing grid. Timeline edges control the region duration.</p>
              <button className="ss-drawer-action-btn danger" onClick={onDeleteSelectedZoom}><Trash2 size={14} /> Delete Zoom Region</button>
            </Section>
          </> : <>
          <Section title="Motion Blur">
            <CheckRow label="Motion Blur" checked={config.motionBlur.enabled} onChange={(v) => updateBlur({ enabled: v })} />
            {config.motionBlur.enabled && <div className="conditional-control-group">
              <Slider label="Zoom-in Blur" value={config.motionBlur.zoomAmount} min={0} max={100} step={5} unit="%" onChange={(v) => updateBlur({ zoomAmount: v })} defaultValue={0} onReset={() => updateBlur({ zoomAmount: 0 })} />
              <Slider label="Screen Blur" value={config.motionBlur.panAmount} min={0} max={100} step={5} unit="%" onChange={(v) => updateBlur({ panAmount: v })} defaultValue={0} onReset={() => updateBlur({ panAmount: 0 })} />
              <Slider label="Cursor Blur" value={config.motionBlur.cursorAmount} min={0} max={100} step={5} unit="%" onChange={(v) => updateBlur({ cursorAmount: v })} defaultValue={0} onReset={() => updateBlur({ cursorAmount: 0 })} />
            </div>}
          </Section>

          <Section title="Cursor Movement">
            <CheckRow label="Cursor Movement" checked={config.cursorMovement.enabled} onChange={(v) => updateCursorMov({ enabled: v })} />
            {config.cursorMovement.enabled && <div className="conditional-control-group">
              <SelectRow label="Response" value={config.cursorMovement.speed} options={["slow", "medium", "fast", "rapid", "custom"]} optionLabels={{ slow: "Fluid", medium: "Balanced", fast: "Responsive", rapid: "Snappy", custom: "Custom" }} onChange={(speed) => updateCursorMov({ speed: speed as MovementSpeed })} />
              <Slider label="Smoothing" value={config.cursorMovement.durationMs} min={80} max={2000} step={20} unit="ms" onChange={(durationMs) => updateCursorMov({ durationMs, speed: "custom" })} />
              <p className="panel-help-text">Higher smoothing creates a softer cursor glide; lower values follow input more closely.</p>
            </div>}
          </Section>

          <Section title="Zoom & Pan">
            <div className="toggle-segmented animated-pills" style={{ "--pill-count": 2, "--pill-index": config.zoomMode === "auto" ? 0 : 1 } as CSSProperties}>
              <button className={`seg-btn ${config.zoomMode === "auto" ? "active" : ""}`} onClick={() => onZoomModeChange("auto")}>Auto</button>
              <button className={`seg-btn ${config.zoomMode === "manual" ? "active" : ""}`} onClick={() => onZoomModeChange("manual")}>Manual</button>
            </div>
            {config.zoomMode === "auto" && (
              <>
                <SelectRow label="Camera Style" value={config.autoZoom.preset} options={["gentle", "balanced", "dynamic", "custom"]} optionLabels={{ gentle: "Gentle", balanced: "Balanced", dynamic: "Dynamic", custom: "Custom" }} onChange={(value) => applyAutoZoomPreset(value as AutoZoomPreset)} />
                <Slider label="Maximum Zoom" value={config.autoZoom.maxScale} min={1.2} max={3} step={0.05} unit="×" onChange={(maxScale) => updateAutoZoom({ maxScale })} />
                <Slider label="Hold Time" value={config.autoZoom.holdMs} min={300} max={2500} step={50} unit="ms" onChange={(holdMs) => updateAutoZoom({ holdMs })} />
                <Slider label="Camera Cooldown" value={config.autoZoom.cooldownMs} min={0} max={1800} step={50} unit="ms" onChange={(cooldownMs) => updateAutoZoom({ cooldownMs })} />
                <Slider label="Typing Intent" value={config.autoZoom.typingSensitivity} min={2} max={12} step={1} unit=" keys" onChange={(typingSensitivity) => updateAutoZoom({ typingSensitivity })} />
                <Slider label="Scroll Intent" value={config.autoZoom.scrollSensitivity} min={1} max={8} step={1} unit=" ticks" onChange={(scrollSensitivity) => updateAutoZoom({ scrollSensitivity })} />
              </>
            )}
            <CheckRow label="Zoom Movement" checked={config.zoomMovement.enabled} onChange={(v) => updateZoomMov({ enabled: v })} />
            {config.zoomMovement.enabled && <div className="conditional-control-group">
              <SelectRow label="Camera Curve" value={config.zoomMovement.curve ?? "keyframes"} options={["keyframes", "linear", "ease-in", "ease-out", "ease-in-out", "smoother", "sine"]} optionLabels={{ keyframes: "Per region", linear: "Linear", "ease-in": "Ease In", "ease-out": "Ease Out", "ease-in-out": "Smooth", smoother: "Cinematic", sine: "Gentle Sine" }} onChange={(curve) => updateZoomMov({ curve: curve as EditorConfig["zoomMovement"]["curve"] })} />
              <SelectRow label="Transition" value={config.zoomMovement.speed} options={["slow", "medium", "fast", "rapid", "custom"]} optionLabels={{ slow: "Slow drift", medium: "Balanced", fast: "Quick", rapid: "Snap", custom: "Custom" }} onChange={(speed) => updateZoomMov({ speed: speed as MovementSpeed })} />
              <Slider label="Duration" value={config.zoomMovement.durationMs} min={100} max={3000} step={50} unit="ms" onChange={(durationMs) => updateZoomMov({ durationMs, speed: "custom" })} />
            </div>}
            <p className="panel-help-text">
              {config.zoomMode === "auto"
                ? "Regenerate Auto-Zoom analyzes the recording again and refreshes the automatic zoom regions in the timeline."
                : "Add Zoom Region creates a bar at the playhead immediately. Move or trim the bar in the timeline, then drag directly in the preview to place its focus point."}
            </p>
            {config.zoomMode === "manual" ? (
              <button className="ss-drawer-action-btn primary" onClick={onAddManualZoom}>
                + Add Zoom Region
              </button>
            ) : (
              <button className="ss-drawer-action-btn" onClick={onRegenerateAutoZoom}>
                Regenerate Auto-Zoom
              </button>
            )}
          </Section>
          </>}
        </div>
      )}

      {/* ═══ AUDIO TAB ═══════════════════════════════════════════════ */}
      {activeTab === "audio" && (
        <div className="ss-drawer-content">
          <Section title="Quick mix">
            <div className="audio-preset-grid" aria-label="Audio mix presets">
              <button type="button" onClick={() => applyAudioPreset("balanced")}><strong>Balanced</strong><small>Even levels</small></button>
              <button type="button" onClick={() => applyAudioPreset("voice")}><strong>Voice focus</strong><small>Lift microphone</small></button>
              <button type="button" onClick={() => applyAudioPreset("system")}><strong>Screen focus</strong><small>Lift system audio</small></button>
              <button type="button" onClick={() => applyAudioPreset("reset")}><strong>Reset</strong><small>Restore 100%</small></button>
            </div>
          </Section>
          {audioTracks.some((track) => track.kind === "system" || track.kind === "device") && <Section title={audioTracks.some((track) => track.kind === "device") ? "Device Audio" : "System Audio"}>
            <CheckRow label={audioTracks.some((track) => track.kind === "device") ? "Mute Device Audio" : "Mute System Audio"} checked={config.audio.systemMuted} onChange={(v) => updateAudio({ systemMuted: v })} />
            <Slider label="Volume" value={config.audio.systemVolume} min={0} max={200} step={5} unit="%" onChange={(v) => updateAudio({ systemVolume: v })} disabled={config.audio.systemMuted} />
          </Section>}
          {audioTracks.some((track) => track.kind === "microphone") && <Section title="Microphone">
            <CheckRow label="Mute Microphone" checked={config.audio.micMuted} onChange={(v) => updateAudio({ micMuted: v })} />
            <Slider label="Volume" value={config.audio.micVolume} min={0} max={200} step={5} unit="%" onChange={(v) => updateAudio({ micVolume: v })} disabled={config.audio.micMuted} />
          </Section>}
          {audioTracks.filter((track) => track.kind === "imported").map((track) => <Section title={track.label} key={track.id}>
            <CheckRow label="Mute track" checked={track.muted} onChange={(muted) => onAudioTracksChange(audioTracks.map((candidate) => candidate.id === track.id ? { ...candidate, muted } : candidate))} />
            <Slider label="Volume" value={Math.round(track.volume * 100)} min={0} max={200} step={5} unit="%" onChange={(volume) => onAudioTracksChange(audioTracks.map((candidate) => candidate.id === track.id ? { ...candidate, volume: volume / 100 } : candidate))} disabled={track.muted} />
            <button type="button" className="audio-remove-button" onClick={() => onAudioTracksChange(audioTracks.filter((candidate) => candidate.id !== track.id))}><Trash2 size={13} /> Remove from project</button>
          </Section>)}
          {audioTracks.length === 0 && <div className="audio-empty-state"><Music2 size={20} /><span><strong>No audio tracks</strong><small>Add music, narration, or another recording.</small></span></div>}
          {audioError && <div className="audio-inline-error" role="alert">{audioError}</div>}
          <button type="button" className="audio-import-button audio-import-button-last" onClick={onAddAudio}><Plus size={15} /><span>Add audio</span><small>MP3, WAV, M4A and more</small></button>
        </div>
      )}

      {activeTab === "captions" && (
        <div className={`ss-drawer-content captions-drawer-content ${selectedCaptionSegment ? "layer-inspector-mode" : ""}`}>
          {selectedCaptionTrack && selectedCaptionSegment ? <>
            <div className="layer-inspector-header">
              <button onClick={() => onSelectCaption(null)} title="Back to caption tools" aria-label="Back to caption tools"><ArrowLeft size={17} /></button>
              <span><strong>Caption</strong><small>{(selectedCaptionSegment.startMs / 1000).toFixed(1)}s–{(selectedCaptionSegment.endMs / 1000).toFixed(1)}s</small></span>
            </div>
            <div className="caption-copy-edit">
              <textarea aria-label="Caption text" className="layer-textarea caption-copy-editor" rows={3} value={selectedCaptionSegment.text} onChange={(event) => updateCaptionTrack(selectedCaptionTrack.id, (track) => ({ ...track, segments: track.segments.map((segment) => segment.id === selectedCaptionSegment.id ? { ...segment, text: event.target.value, userEdited: true } : segment) }))} />
              <div className="caption-time-row caption-inspector-time">
                <label><span>Start</span><div><input aria-label="Caption start time" type="number" step="0.05" value={(selectedCaptionSegment.startMs / 1000).toFixed(2)} onChange={(event) => updateCaptionTrack(selectedCaptionTrack.id, (track) => ({ ...track, segments: updateCaptionTiming(track.segments, selectedCaptionSegment.id, "start", Number(event.target.value) * 1000, config.trimStart * 1000, (config.trimEnd || duration) * 1000) }))} /><em>s</em></div></label>
                <label><span>End</span><div><input aria-label="Caption end time" type="number" step="0.05" value={(selectedCaptionSegment.endMs / 1000).toFixed(2)} onChange={(event) => updateCaptionTrack(selectedCaptionTrack.id, (track) => ({ ...track, segments: updateCaptionTiming(track.segments, selectedCaptionSegment.id, "end", Number(event.target.value) * 1000, config.trimStart * 1000, (config.trimEnd || duration) * 1000) }))} /><em>s</em></div></label>
              </div>
            </div>
            <Section title="Text style">
              <div className="caption-compact-section">
              <SelectRow label="Typeface" value={selectedCaptionTrack.style.fontFamily} options={["Segoe UI Variable", "Arial", "Calibri", "Verdana", "Tahoma", "Trebuchet MS", "Georgia", "Times New Roman", "Courier New", "Impact"]} onChange={(fontFamily) => updateCaptionTrack(selectedCaptionTrack.id, (track) => ({ ...track, style: { ...track.style, fontFamily } }))} />
              <SelectRow label="Weight" value={String(selectedCaptionTrack.style.fontWeight)} options={["400", "500", "600", "700", "800"]} optionLabels={{"400":"Regular","500":"Medium","600":"Semibold","700":"Bold","800":"Extra bold"}} onChange={(fontWeight) => updateCaptionTrack(selectedCaptionTrack.id, (track) => ({ ...track, style: { ...track.style, fontWeight: Number(fontWeight) as CaptionTrack["style"]["fontWeight"] } }))} />
              <div className="caption-format-pills" role="toolbar" aria-label="Caption text formatting">
                <button title="Bold" aria-label="Bold" className={selectedCaptionTrack.style.fontWeight >= 700 ? "active" : ""} onClick={() => updateCaptionTrack(selectedCaptionTrack.id, (track) => ({ ...track, style: { ...track.style, fontWeight: track.style.fontWeight >= 700 ? 500 : 700 } }))}><strong>B</strong></button>
                <button title="Italic" aria-label="Italic" className={(selectedCaptionTrack.style.fontStyle ?? "normal") === "italic" ? "active" : ""} onClick={() => updateCaptionTrack(selectedCaptionTrack.id, (track) => ({ ...track, style: { ...track.style, fontStyle: track.style.fontStyle === "italic" ? "normal" : "italic" } }))}><em>I</em></button>
                {(["left", "center", "right"] as const).map((align) => { const Icon = align === "left" ? AlignLeft : align === "right" ? AlignRight : AlignCenter; return <button type="button" title={`Align ${align}`} aria-label={`Align ${align}`} key={align} className={(selectedCaptionTrack.style.align ?? "center") === align ? "active" : ""} onClick={() => updateCaptionTrack(selectedCaptionTrack.id, (track) => ({ ...track, style: { ...track.style, align } }))}><Icon size={15} /></button>; })}
              </div>
              <Slider label="Font size" value={selectedCaptionTrack.style.fontSize} min={14} max={120} step={1} unit="px" onChange={(fontSize) => updateCaptionTrack(selectedCaptionTrack.id, (track) => ({ ...track, style: { ...track.style, fontSize } }))} />
              <Slider label="Letter spacing" value={selectedCaptionTrack.style.letterSpacing ?? 0} min={-2} max={12} step={0.5} unit="px" onChange={(letterSpacing) => updateCaptionTrack(selectedCaptionTrack.id, (track) => ({ ...track, style: { ...track.style, letterSpacing } }))} />
              <Slider label="Line height" value={selectedCaptionTrack.style.lineHeight ?? 1.22} min={0.9} max={2} step={0.05} unit="×" onChange={(lineHeight) => updateCaptionTrack(selectedCaptionTrack.id, (track) => ({ ...track, style: { ...track.style, lineHeight } }))} />
              <div className="caption-color-grid" aria-label="Caption colors">
                <label title={selectedCaptionTrack.style.color}><span><Palette size={12} /> Text</span><input type="color" aria-label="Caption text color" value={selectedCaptionTrack.style.color} onChange={(event) => updateCaptionTrack(selectedCaptionTrack.id, (track) => ({ ...track, style: { ...track.style, color: event.target.value } }))} /></label>
                {selectedCaptionTrack.style.backgroundEnabled !== false && <label title={selectedCaptionTrack.style.backgroundColor}><span>Fill</span><input type="color" aria-label="Caption background color" value={selectedCaptionTrack.style.backgroundColor.startsWith("#") ? selectedCaptionTrack.style.backgroundColor : "#17130f"} onChange={(event) => updateCaptionTrack(selectedCaptionTrack.id, (track) => ({ ...track, style: { ...track.style, backgroundColor: event.target.value } }))} /></label>}
                <label title={selectedCaptionTrack.style.outlineColor}><span>Stroke</span><input type="color" aria-label="Caption outline color" value={selectedCaptionTrack.style.outlineColor} onChange={(event) => updateCaptionTrack(selectedCaptionTrack.id, (track) => ({ ...track, style: { ...track.style, outlineColor: event.target.value } }))} /></label>
              </div>
              <CheckRow label="Background box" checked={selectedCaptionTrack.style.backgroundEnabled !== false} onChange={(backgroundEnabled) => updateCaptionTrack(selectedCaptionTrack.id, (track) => ({ ...track, style: { ...track.style, backgroundEnabled } }))} />
              <Slider label="Outline" value={selectedCaptionTrack.style.outlineWidth} min={0} max={10} step={1} unit="px" onChange={(outlineWidth) => updateCaptionTrack(selectedCaptionTrack.id, (track) => ({ ...track, style: { ...track.style, outlineWidth } }))} />
              </div>
            </Section>
            <Section title="Position & box">
              <div className="caption-compact-section">
              <Slider label="Horizontal" value={Math.round(selectedCaptionTrack.style.x * 100)} min={5} max={95} step={1} unit="%" onChange={(value) => updateCaptionTrack(selectedCaptionTrack.id, (track) => ({ ...track, style: { ...track.style, x: value / 100 } }))} />
              <Slider label="Vertical" value={Math.round(selectedCaptionTrack.style.y * 100)} min={5} max={95} step={1} unit="%" onChange={(value) => updateCaptionTrack(selectedCaptionTrack.id, (track) => ({ ...track, style: { ...track.style, y: value / 100 } }))} />
              <Slider label="Maximum width" value={Math.round(selectedCaptionTrack.style.maxWidth * 100)} min={30} max={96} step={1} unit="%" onChange={(value) => updateCaptionTrack(selectedCaptionTrack.id, (track) => ({ ...track, style: { ...track.style, maxWidth: value / 100 } }))} />
              {selectedCaptionTrack.style.backgroundEnabled !== false && <>
                <Slider label="Box padding" value={selectedCaptionTrack.style.backgroundPadding ?? .4} min={0} max={1.2} step={.05} unit="×" onChange={(backgroundPadding) => updateCaptionTrack(selectedCaptionTrack.id, (track) => ({ ...track, style: { ...track.style, backgroundPadding } }))} />
                <Slider label="Box roundness" value={selectedCaptionTrack.style.backgroundRadius ?? .18} min={0} max={1} step={.05} unit="×" onChange={(backgroundRadius) => updateCaptionTrack(selectedCaptionTrack.id, (track) => ({ ...track, style: { ...track.style, backgroundRadius } }))} />
              </>}
              <CheckRow label="Text shadow" checked={selectedCaptionTrack.style.shadow} onChange={(shadow) => updateCaptionTrack(selectedCaptionTrack.id, (track) => ({ ...track, style: { ...track.style, shadow } }))} />
              {selectedCaptionTrack.style.shadow && <Slider label="Shadow softness" value={selectedCaptionTrack.style.shadowBlur ?? .18} min={0} max={.8} step={.02} unit="×" onChange={(shadowBlur) => updateCaptionTrack(selectedCaptionTrack.id, (track) => ({ ...track, style: { ...track.style, shadowBlur } }))} />}
              </div>
            </Section>
            <Section title="Entrance">
              <div className="caption-section-kicker"><WandSparkles size={13} /> Animate each caption when it appears</div>
              <div className="caption-animation-presets expanded" aria-label="Caption entrance animation">
                {(["none", "fade", "reveal", "pop", "rise", "slide", "blur", "bounce"] as const).map((animation) => <button type="button" key={animation} className={(selectedCaptionTrack.style.animation ?? "none") === animation ? "active" : ""} onClick={() => updateCaptionTrack(selectedCaptionTrack.id, (track) => ({ ...track, style: { ...track.style, animation } }))}><span className={`caption-animation-preview ${animation}`}>Aa</span><span>{animation[0].toUpperCase() + animation.slice(1)}</span></button>)}
              </div>
              <Slider label="Animation speed" value={selectedCaptionTrack.style.animationDurationMs ?? 420} min={120} max={1200} step={20} unit="ms" onChange={(animationDurationMs) => updateCaptionTrack(selectedCaptionTrack.id, (track) => ({ ...track, style: { ...track.style, animationDurationMs } }))} />
              <CheckRow label="Show captions" checked={selectedCaptionTrack.visible} onChange={(visible) => updateCaptionTrack(selectedCaptionTrack.id, (track) => ({ ...track, visible }))} />
              <CheckRow label="Include in export" checked={selectedCaptionTrack.burnedIn} onChange={(burnedIn) => updateCaptionTrack(selectedCaptionTrack.id, (track) => ({ ...track, burnedIn }))} />
              <button className="ss-drawer-action-btn danger" onClick={() => { updateCaptionTrack(selectedCaptionTrack.id, (track) => ({ ...track, segments: track.segments.filter((segment) => segment.id !== selectedCaptionSegment.id) })); onSelectCaption(null); }}><Trash2 size={14} /> Delete Caption</button>
            </Section>
          </> : <>
          <button type="button" className="ss-drawer-action-btn manual-caption-action" onClick={onAddManualCaption}><Captions size={15} /> Add caption manually</button>
          <Section title="Automatic Captions">
            <div className="caption-picker-stack">
              <CaptionAudioSourcePicker tracks={audioTracks} value={captionSource} onChange={setCaptionSource} onAddAudio={onAddAudio} />
              <CaptionLanguagePicker value={captionLanguage} onChange={setCaptionLanguage} />
              <CaptionModelPicker value={captionModel} installedModels={transcriptionEnv?.installedModels ?? []} engineAvailable={Boolean(transcriptionEnv?.available)} onChange={(model) => { setCaptionModel(model); setCaptionStatus(""); }} />
            </div>
            {transcriptionEnv && !captionModelReady && <>
              <button className="ss-drawer-action-btn primary model-install-action" disabled={installingTranscription} onClick={() => void installTranscription(captionModel)}>{installingTranscription ? `${installPhase || "Installing model"} — ${installProgress}%` : `Install ${captionModel === "auto" ? "Base · 142 MB" : `${TRANSCRIPTION_MODEL_LABELS[captionModel]} · ${TRANSCRIPTION_MODEL_SIZES[captionModel]}`}`}</button>
              {installingTranscription && <div className="caption-install-state">
                <div className="caption-install-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={installProgress}><span style={{ width: `${installProgress}%` }} /></div>
                <button type="button" className="caption-install-cancel" disabled={cancellingTranscription} onClick={() => void cancelTranscriptionInstall()}><X size={13} />{cancellingTranscription ? "Cancelling…" : "Cancel download"}</button>
              </div>}
            </>}
            {captionModelReady && <button className="ss-drawer-action-btn primary" disabled={transcribing || audioTracks.length === 0} onClick={() => void generateCaptions()}>
              {transcribing ? "Transcribing…" : captionTracks.some((track) => track.sourceTrackIds.includes(captionSource)) ? "Regenerate Synced Captions" : "Generate Captions"}
            </button>}
            {captionStatus && <p className="caption-status-message" role="status">{captionStatus}</p>}
          </Section>
          {captionTracks.map((track) => (
            <Section key={track.id} title={track.name}>
              <CheckRow label="Show Captions" checked={track.visible} onChange={(visible) => updateCaptionTrack(track.id, (current) => ({ ...current, visible }))} />
              <CheckRow label="Burn Into Export" checked={track.burnedIn} onChange={(burnedIn) => updateCaptionTrack(track.id, (current) => ({ ...current, burnedIn }))} />
              <div className="caption-track-summary"><span><strong>{track.segments.length} captions</strong><small>{track.language.toUpperCase()} · click any caption bar in the timeline to edit it</small></span>{track.segments[0] && <button onClick={() => onSelectCaption({ trackId: track.id, segmentId: track.segments[0].id })}>Edit captions</button>}</div>
              <button className="ss-drawer-action-btn danger" onClick={() => onCaptionTracksChange(captionTracks.filter((item) => item.id !== track.id))}><Trash2 size={14} /> Delete Caption Track</button>
            </Section>
          ))}
          </>}
        </div>
      )}

    </aside>
  );
}

/* ── Helpers ────────────────────────────────────────────────────────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="ss-section"><h4 className="ss-section-heading">{title}</h4><div className="ss-section-body">{children}</div></section>;
}

function SelectRow({ label, value, options, optionLabels, onChange }: { label: string; value: string; options: string[]; optionLabels?: Record<string, string>; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const optionLabel = (option: string) => optionLabels?.[option] ?? option.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="field-row select-row custom-select-row" ref={rootRef}>
      <span className="field-label">{label}</span>
      <div className="custom-select">
        <button type="button" className={`custom-select-trigger ${open ? "open" : ""}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
          <span>{optionLabel(value)}</span><ChevronDown size={14} />
        </button>
        {open && <div className="custom-select-menu" role="listbox" aria-label={label}>
          {options.map((option) => <button type="button" role="option" aria-selected={option === value} key={option} onClick={() => { onChange(option); setOpen(false); }}><span>{optionLabel(option)}</span>{option === value && <Check size={14} />}</button>)}
        </div>}
      </div>
    </div>
  );
}

const CAPTION_LANGUAGES: Array<{ value: TranscriptionLanguage; label: string; description: string }> = [
  { value: "auto", label: "Auto detect", description: "Detect multilingual speech" },
  { value: "en", label: "English", description: "English speech" },
  { value: "hi", label: "Hindi", description: "हिंदी भाषण" },
  { value: "es", label: "Spanish", description: "Español" },
  { value: "fr", label: "French", description: "Français" },
  { value: "de", label: "German", description: "Deutsch" },
  { value: "it", label: "Italian", description: "Italiano" },
  { value: "pt", label: "Portuguese", description: "Português" },
  { value: "ja", label: "Japanese", description: "日本語" },
  { value: "zh", label: "Chinese", description: "中文" },
  { value: "ko", label: "Korean", description: "한국어" },
];

function captionSourceDescription(track: AudioTrack): string {
  if (track.kind === "microphone") return "Microphone voice track";
  if (track.kind === "device") return "Captured device audio";
  if (track.kind === "system") return "Browser and desktop audio";
  return "Added audio file";
}

function CaptionAudioSourcePicker({ tracks, value, onChange, onAddAudio }: {
  tracks: AudioTrack[];
  value: string;
  onChange: (value: string) => void;
  onAddAudio: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = tracks.find((track) => track.id === value) ?? tracks[0];

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="caption-language-field caption-audio-source-field" ref={rootRef}>
      <span className="caption-control-label">Transcribe audio from</span>
      <button type="button" className={`caption-language-trigger ${open ? "open" : ""}`} disabled={tracks.length === 0} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <AudioWaveform size={17} />
        <span><strong>{selected?.label ?? "No audio available"}</strong><small>{selected ? captionSourceDescription(selected) : "Add an audio track first"}</small></span>
        <ChevronDown className="caption-language-chevron" size={16} />
      </button>
      {open && <div className="caption-language-menu caption-audio-source-menu" role="listbox" aria-label="Audio track to transcribe">
        {tracks.map((track) => <button type="button" role="option" aria-selected={track.id === selected?.id} key={track.id} onClick={() => { onChange(track.id); setOpen(false); }}>
          <span><strong>{track.label}</strong><small>{captionSourceDescription(track)}</small></span>
          {track.id === selected?.id && <Check size={16} />}
        </button>)}
        <button type="button" className="caption-source-add" onClick={() => { setOpen(false); onAddAudio(); }}><span><strong>Add another audio file</strong><small>Import music, narration, or dialogue</small></span><Plus size={15} /></button>
      </div>}
      {tracks.length === 0 && <button type="button" className="caption-source-empty-add" onClick={onAddAudio}><Plus size={14} /> Add audio</button>}
    </div>
  );
}

function CaptionLanguagePicker({ value, onChange }: { value: TranscriptionLanguage; onChange: (value: TranscriptionLanguage) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = CAPTION_LANGUAGES.find((language) => language.value === value) ?? CAPTION_LANGUAGES[0];

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="caption-language-field" ref={rootRef}>
      <span className="caption-control-label">Language</span>
      <button type="button" className={`caption-language-trigger ${open ? "open" : ""}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <Languages size={17} />
        <span><strong>{selected.label}</strong><small>{selected.description}</small></span>
        <ChevronDown className="caption-language-chevron" size={16} />
      </button>
      {open && (
        <div className="caption-language-menu" role="listbox" aria-label="Caption language">
          {CAPTION_LANGUAGES.map((language) => (
            <button
              type="button"
              role="option"
              aria-selected={language.value === value}
              key={language.value}
              onClick={() => { onChange(language.value); setOpen(false); }}
            >
              <span><strong>{language.label}</strong><small>{language.description}</small></span>
              {language.value === value && <Check size={16} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CaptionModelPicker({ value, installedModels, engineAvailable, onChange }: {
  value: TranscriptionModel;
  installedModels: TranscriptionModel[];
  engineAvailable: boolean;
  onChange: (value: TranscriptionModel) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = CAPTION_MODEL_OPTIONS.find((model) => model.value === value) ?? CAPTION_MODEL_OPTIONS[0];
  const isInstalled = (model: TranscriptionModel) => model === "auto" ? engineAvailable : installedModels.includes(model);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="caption-language-field caption-model-field" ref={rootRef}>
      <span className="caption-control-label">Model</span>
      <button type="button" className={`caption-language-trigger caption-model-trigger ${open ? "open" : ""}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <Sparkles size={17} />
        <span><strong>{selected.label}</strong><small>{selected.description}</small></span>
        <ChevronDown className="caption-language-chevron" size={16} />
      </button>
      {open && <div className="caption-language-menu caption-model-menu" role="listbox" aria-label="Caption model">
        {CAPTION_MODEL_OPTIONS.map((model) => (
          <button type="button" role="option" aria-selected={model.value === value} key={model.value} onClick={() => { onChange(model.value); setOpen(false); }}>
            <span><strong>{model.label}</strong><small>{model.description}</small></span>
            <span className="caption-model-option-state">{isInstalled(model.value) ? "Installed" : model.value === "auto" ? "Setup" : "Download"}</span>
          </button>
        ))}
      </div>}
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="layer-number-field"><span>{label}</span><div><input type="number" min={0} max={100} step={1} value={Math.round(value)} onChange={(event) => onChange(Number(event.target.value))} /><em>%</em></div></label>;
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className="field-row check-row" onClick={() => onChange(!checked)} aria-pressed={checked}>
      <span className="field-label">{label}</span>
      <span className={`pro-switch ${checked ? "checked" : ""}`} aria-hidden="true"><span /></span>
    </button>
  );
}

function EffectThumbnail({ effect }: { effect: ClickEffect }) {
  const Icon = CLICK_EFFECT_ICONS[effect];
  return (
    <div className={`effect-icon effect-${effect}`}>
      <span className="effect-orbit" />
      <Icon size={18} strokeWidth={1.8} />
    </div>
  );
}
