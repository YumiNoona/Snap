import { useEffect, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { MousePointer, MousePointer2, Type, Square, Circle, Minus, ArrowLeft, ArrowRight, Hand, PenLine, Slash, Radio, Disc3, LocateFixed, Sparkles, PartyPopper, Snowflake, ScanSearch, Blend, Search, Trash2, FlipHorizontal2, FlipVertical2, AlignLeft, AlignCenter, AlignRight, AudioWaveform, type LucideIcon } from "lucide-react";
import type { AudioTrack, CaptionTrack, EditorConfig, CursorPackInfo, Layer, TextLayer, ShapeLayer, MaskLayer, ClickEffect, MovementSpeed, ZoomRegionSettings, AutoZoomPreset, AudioTrackKind } from "../../../lib/types";
import { AUTO_ZOOM_PRESETS } from "../../../lib/types";
import { GRADIENT_PRESETS, COLOR_PRESETS, WALLPAPER_PRESETS, gradientToCss } from "../../../lib/wallpapers";
import { preloadImageAsset } from "../../../lib/canvasDraw";
import { getTranscriptionEnvironment, transcribeTrack, type TranscriptionEnvironment, type TranscriptionLanguage } from "../../../lib/captions";
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
  onDeleteSelectedZoom: () => void;
  audioTracks: AudioTrack[];
  audioStatus: string;
  captionTracks: CaptionTrack[];
  onCaptionTracksChange: (tracks: CaptionTrack[]) => void;
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
  selectedZoomRegion, onSelectedZoomChange, onDeleteSelectedZoom,
  audioTracks, audioStatus, captionTracks, onCaptionTracksChange,
}: Props) {
  const [cursorPacks, setCursorPacks] = useState<CursorPackInfo[]>([]);
  const [cursorPacksError, setCursorPacksError] = useState("");
  const [bgCategory, setBgCategory] = useState<"gradient" | "color" | "image">("gradient");
  const annotationDrawerRef = useRef<HTMLDivElement>(null);
  const [captionSource, setCaptionSource] = useState<AudioTrackKind>("microphone");
  const [captionLanguage, setCaptionLanguage] = useState<TranscriptionLanguage>("auto");
  const [transcriptionEnv, setTranscriptionEnv] = useState<TranscriptionEnvironment | null>(null);
  const [captionStatus, setCaptionStatus] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [installingTranscription, setInstallingTranscription] = useState(false);
  const [installProgress, setInstallProgress] = useState(0);
  const [installPhase, setInstallPhase] = useState("");

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
    if (audioTracks.some((track) => track.kind === captionSource)) return;
    const preferred = audioTracks.find((track) => track.kind === "microphone") ?? audioTracks[0];
    if (preferred) setCaptionSource(preferred.kind);
  }, [audioTracks, captionSource]);

  const generateCaptions = async () => {
    setTranscribing(true);
    setCaptionStatus(`Transcribing ${captionSource === "microphone" ? "microphone" : captionSource} audio…`);
    try {
      const sourceTrack = audioTracks.find((track) => track.kind === captionSource);
      if (!sourceTrack) throw new Error(`No ${captionSource} audio track is available in this recording`);
      const track = await transcribeTrack(sourceTrack, captionLanguage);
      onCaptionTracksChange([...captionTracks, track]);
      setCaptionStatus(`Created ${track.segments.length} editable caption segments`);
    } catch (error) {
      setCaptionStatus(`Transcription failed: ${error}`);
    } finally {
      setTranscribing(false);
    }
  };

  const installTranscription = async () => {
    setInstallingTranscription(true);
    setInstallProgress(0);
    setCaptionStatus("Downloading the offline engine and multilingual model…");
    const unlisten = await listen<{ percent: number; phase: string }>("transcription-install-progress", ({ payload }) => {
      setInstallProgress(payload.percent);
      setInstallPhase(payload.phase);
    });
    try {
      const environment = await invoke<TranscriptionEnvironment>("install_transcription_dependencies");
      setTranscriptionEnv(environment);
      setCaptionStatus("Offline captions are ready");
    } catch (error) {
      setCaptionStatus(`Installation failed: ${error}`);
    } finally {
      unlisten();
      setInstallingTranscription(false);
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
      content: style === "badge" ? "1" : "Text", style, color: "#ffffff", fontSize: 24,
      fontFamily: "system", fontWeight: 700, align: "center", backgroundColor: "#2563eb",
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
  const updateSelectedLayer = (patch: Partial<Layer>) => {
    if (!selectedLayer) return;
    onConfigChange({ ...config, layers: config.layers.map((layer) => layer.id === selectedLayer.id ? ({ ...layer, ...patch } as Layer) : layer) });
  };

  useEffect(() => {
    if (selectedLayerId && annotationDrawerRef.current) annotationDrawerRef.current.scrollTop = 0;
  }, [selectedLayerId]);

  return (
    <aside className="ss-panels-drawer">
      {/* ═══ CANVAS TAB ═══════════════════════════════════════════════ */}
      {activeTab === "canvas" && (
        <div className="ss-drawer-content">
          <Section title="Canvas Styling">
            <Slider label="Padding" value={config.padding} min={0} max={160} step={4} unit="px" onChange={(v) => update({ padding: v })} defaultValue={48} onReset={() => update({ padding: 48 })} />
            <div className="field-row">
              <label>Inset</label>
              <div className="inset-control-row">
                <div className="inset-slider-wrap">
                  <Slider value={config.inset} min={0} max={40} step={1} unit="px" onChange={(v) => update({ inset: v })} defaultValue={0} onReset={() => update({ inset: 0 })} compact />
                </div>
                <input type="color" value={config.insetColor} onChange={(e) => update({ insetColor: e.target.value })} className="color-swatch inset-color-swatch" aria-label="Inset color" />
              </div>
            </div>
            <Slider label="Roundness" value={config.borderRadius} min={0} max={60} step={1} unit="px" onChange={(v) => update({ borderRadius: v })} defaultValue={14} onReset={() => update({ borderRadius: 14 })} />
            <Slider label="Shadow" value={config.shadow.blur} min={0} max={100} step={2} unit="px" onChange={(v) => updateShadow({ blur: v })} defaultValue={40} onReset={() => updateShadow({ blur: 40 })} />
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
            )}
            {bgCategory === "color" && (
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
            )}
            {bgCategory === "image" && (
              <>
                <div className="ss-wallpaper-grid image-grid">
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
            <CheckRow label="Show Cursor" checked={config.showCursor} onChange={(v) => update({ showCursor: v })} />
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
              {(["plain", "boxed", "pill", "badge"] as TextLayer["style"][]).map((style) => (
                <button type="button" key={style} className="annotation-card icon-choice" onClick={() => addLayer(makeTextLayer(style))} aria-label={`Add ${style} text`} data-tooltip={style.charAt(0).toUpperCase() + style.slice(1)}>
                  <div className={`annotation-preview text-preview text-preview-${style}`}>
                    <Type size={20} />
                  </div>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Shape">
            <div className="annotation-card-grid">
              {([
                { shape: "line" as const, label: "Line", color: "#ef4444", icon: <Minus size={16} color="#ef4444" /> },
                { shape: "dashedLine" as const, label: "Dashed", color: "#ef4444", icon: <PenLine size={16} color="#ef4444" /> },
                { shape: "arrow" as const, label: "Arrow", color: "#ef4444", icon: <ArrowRight size={16} color="#ef4444" /> },
                { shape: "rectangle" as const, label: "Rectangle", color: "#ef4444", icon: <Square size={16} color="#ef4444" /> },
                { shape: "roundedRect" as const, label: "Rounded", color: "#eab308", icon: <Square size={16} color="#eab308" /> },
                { shape: "circle" as const, label: "Circle", color: "#8b5cf6", icon: <Circle size={16} color="#8b5cf6" /> },
                { shape: "blob" as const, label: "Ellipse", color: "#ef4444", icon: <Circle size={16} color="#ef4444" /> },
                { shape: "downArrow" as const, label: "Down", color: "#ec4899", icon: <ArrowRight size={16} color="#ec4899" style={{ transform: "rotate(90deg)" }} /> },
                { shape: "pointer" as const, label: "Pointer", color: "#ec4899", icon: <Hand size={16} color="#ec4899" /> },
              ]).map(({ shape, label, color, icon }) => (
                <button type="button" key={shape} className="annotation-card icon-choice" onClick={() => addLayer(makeShapeLayer(shape, color))} aria-label={`Add ${label}`} data-tooltip={label}>
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
                    <SelectRow label="Style" value={selectedLayer.style} options={["plain", "boxed", "pill", "badge"]} onChange={(style) => updateSelectedLayer({ style: style as TextLayer["style"] })} />
                    <SelectRow label="Typeface" value={selectedLayer.fontFamily ?? "system"} options={["system", "serif", "mono"]} onChange={(fontFamily) => updateSelectedLayer({ fontFamily: fontFamily as TextLayer["fontFamily"] })} />
                    <SelectRow label="Weight" value={String(selectedLayer.fontWeight ?? 700)} options={["400", "500", "600", "700", "800"]} onChange={(fontWeight) => updateSelectedLayer({ fontWeight: Number(fontWeight) as TextLayer["fontWeight"] })} />
                    <ColorInput label="Text Color" value={selectedLayer.color} onChange={(color) => updateSelectedLayer({ color })} />
                    {selectedLayer.style !== "plain" && <ColorInput label="Background" value={selectedLayer.backgroundColor ?? "#2563eb"} onChange={(backgroundColor) => updateSelectedLayer({ backgroundColor })} />}
                    <Slider label="Font Size" value={selectedLayer.fontSize} min={10} max={120} step={1} unit="px" onChange={(fontSize) => updateSelectedLayer({ fontSize })} />
                    <Slider label="Letter Space" value={selectedLayer.letterSpacing ?? 0} min={-2} max={12} step={0.5} unit="px" onChange={(letterSpacing) => updateSelectedLayer({ letterSpacing })} />
                    <div className="layer-icon-pills" aria-label="Text alignment">
                      {([ ["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight] ] as const).map(([align, Icon]) => <button key={align} className={(selectedLayer.align ?? "center") === align ? "active" : ""} onClick={() => updateSelectedLayer({ align })} title={`${align} align`}><Icon size={16} /></button>)}
                    </div>
                  </>
                )}
                {selectedLayer.type === "shape" && (
                  <>
                    <SelectRow label="Shape" value={selectedLayer.shape} options={["line", "dashedLine", "arrow", "rectangle", "roundedRect", "circle", "blob", "downArrow", "pointer"]} onChange={(shape) => updateSelectedLayer({ shape: shape as ShapeLayer["shape"] })} />
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
                    <Slider label="Edge Feather" value={selectedLayer.feather ?? 8} min={0} max={30} step={1} unit="px" onChange={(feather) => updateSelectedLayer({ feather })} />
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
        <div className="ss-drawer-content">
          <Section title="Motion Blur">
            <CheckRow label="Motion Blur" checked={config.motionBlur.enabled} onChange={(v) => updateBlur({ enabled: v })} />
            <Slider label="Zoom-in Blur" value={config.motionBlur.zoomAmount} min={0} max={100} step={5} unit="%" onChange={(v) => updateBlur({ zoomAmount: v })} defaultValue={0} onReset={() => updateBlur({ zoomAmount: 0 })} disabled={!config.motionBlur.enabled} />
            <Slider label="Screen Blur" value={config.motionBlur.panAmount} min={0} max={100} step={5} unit="%" onChange={(v) => updateBlur({ panAmount: v })} defaultValue={0} onReset={() => updateBlur({ panAmount: 0 })} disabled={!config.motionBlur.enabled} />
            <Slider label="Cursor Blur" value={config.motionBlur.cursorAmount} min={0} max={100} step={5} unit="%" onChange={(v) => updateBlur({ cursorAmount: v })} defaultValue={0} onReset={() => updateBlur({ cursorAmount: 0 })} disabled={!config.motionBlur.enabled} />
          </Section>

          <Section title="Cursor Movement">
            <CheckRow label="Cursor Movement" checked={config.cursorMovement.enabled} onChange={(v) => updateCursorMov({ enabled: v })} />
            <SpeedPills speed={config.cursorMovement.speed} onChange={(speed) => updateCursorMov({ speed })} />
            {config.cursorMovement.speed === "custom" && (
              <Slider label="Duration" value={config.cursorMovement.durationMs} min={100} max={2000} step={50} unit="ms" onChange={(v) => updateCursorMov({ durationMs: v })} />
            )}
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
            <SpeedPills speed={config.zoomMovement.speed} onChange={(speed) => updateZoomMov({ speed })} />
            {config.zoomMovement.speed === "custom" && (
              <Slider label="Duration" value={config.zoomMovement.durationMs} min={100} max={3000} step={100} unit="ms" onChange={(v) => updateZoomMov({ durationMs: v })} />
            )}
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
          {selectedZoomRegion && (
            <Section title="Selected Zoom">
              <div className="selection-source-badge">{selectedZoomRegion.source === "auto" ? "Auto zoom" : "Manual zoom"}</div>
              <Slider label="Zoom" value={selectedZoomRegion.scale} min={1.1} max={4} step={0.1} unit="×" onChange={(scale) => onSelectedZoomChange({ scale })} />
              <Slider label="Transition" value={selectedZoomRegion.transitionMs} min={40} max={Math.max(80, Math.min(2000, (selectedZoomRegion.endMs - selectedZoomRegion.startMs) / 2))} step={20} unit="ms" onChange={(transitionMs) => onSelectedZoomChange({ transitionMs })} />
              <SelectRow label="Transition Curve" value={selectedZoomRegion.easing} options={["linear", "ease-in", "ease-out", "ease-in-out"]} optionLabels={{ linear: "Linear", "ease-in": "Ease In", "ease-out": "Ease Out", "ease-in-out": "Smooth" }} onChange={(easing) => onSelectedZoomChange({ easing: easing as ZoomRegionSettings["easing"] })} />
              <Slider label="Focus X" value={Math.round(selectedZoomRegion.x * 100)} min={0} max={100} step={1} unit="%" onChange={(value) => onSelectedZoomChange({ x: value / 100 })} />
              <Slider label="Focus Y" value={Math.round(selectedZoomRegion.y * 100)} min={0} max={100} step={1} unit="%" onChange={(value) => onSelectedZoomChange({ y: value / 100 })} />
              <Slider label="Start" value={selectedZoomRegion.startMs / 1000} min={config.trimStart} max={Math.max(config.trimStart, selectedZoomRegion.endMs / 1000 - 0.35)} step={0.05} unit="s" onChange={(value) => onSelectedZoomChange({ startMs: value * 1000 })} />
              <Slider label="End" value={selectedZoomRegion.endMs / 1000} min={selectedZoomRegion.startMs / 1000 + 0.35} max={config.trimEnd || duration} step={0.05} unit="s" onChange={(value) => onSelectedZoomChange({ endMs: value * 1000 })} />
              <button className="ss-drawer-action-btn danger" onClick={onDeleteSelectedZoom}><Trash2 size={14} /> Delete Zoom Region</button>
            </Section>
          )}
        </div>
      )}

      {/* ═══ AUDIO TAB ═══════════════════════════════════════════════ */}
      {activeTab === "audio" && (
        <div className="ss-drawer-content">
          <div className={`audio-load-status ${audioTracks.length > 0 ? "ready" : "warning"}`} role="status">
            <AudioWaveform size={16} />
            <span>{audioStatus}</span>
          </div>
          <Section title="System Audio">
            <CheckRow label="Mute System Audio" checked={config.audio.systemMuted} onChange={(v) => updateAudio({ systemMuted: v })} />
            <Slider label="Volume" value={config.audio.systemVolume} min={0} max={200} step={5} unit="%" onChange={(v) => updateAudio({ systemVolume: v })} disabled={config.audio.systemMuted} />
          </Section>
          <Section title="Microphone">
            <CheckRow label="Mute Microphone" checked={config.audio.micMuted} onChange={(v) => updateAudio({ micMuted: v })} />
            <Slider label="Volume" value={config.audio.micVolume} min={0} max={200} step={5} unit="%" onChange={(v) => updateAudio({ micVolume: v })} disabled={config.audio.micMuted} />
          </Section>
        </div>
      )}

      {activeTab === "captions" && (
        <div className="ss-drawer-content">
          <Section title="Automatic Captions">
            <div className={`audio-load-status ${audioTracks.length > 0 ? "ready" : "warning"}`} role="status">
              <AudioWaveform size={16} />
              <span>{audioStatus}</span>
            </div>
            <div className="caption-source-heading">Transcribe audio from</div>
            <div className="caption-source-grid" role="radiogroup" aria-label="Caption audio source">
              {([
                ["microphone", "Microphone", "Your voice only. Desktop music and videos are excluded."],
                ["system", "Desktop audio", "Browser videos, meetings, games, and other computer sound."],
                ["device", "Device audio", "Audio captured from an imported phone or capture device."],
              ] as const).map(([value, label, description]) => (
                <button key={value} type="button" role="radio" aria-checked={captionSource === value} disabled={!audioTracks.some((track) => track.kind === value)} className={`caption-source-card ${captionSource === value ? "selected" : ""}`} onClick={() => setCaptionSource(value)}>
                  <span className="caption-source-radio" />
                  <span><strong>{label}<em>{audioTracks.some((track) => track.kind === value) ? "Ready" : "Not recorded"}</em></strong><small>{description}</small></span>
                </button>
              ))}
            </div>
            <SelectRow label="Language" value={captionLanguage} options={["auto", "en", "hi"]} optionLabels={{ auto: "Auto detect", en: "English", hi: "Hindi" }} onChange={(value) => setCaptionLanguage(value as TranscriptionLanguage)} />
            <p className="panel-help-text">Snap transcribes only the selected independent track. Choose Auto detect for Hindi-English mixed speech. Captions remain editable and movable after generation.</p>
            {transcriptionEnv && <p className={`panel-help-text ${transcriptionEnv.available ? "" : "panel-warning"}`}>{transcriptionEnv.message}</p>}
            {transcriptionEnv?.available === false && <>
              <button className="ss-drawer-action-btn" disabled={installingTranscription} onClick={() => void installTranscription()}>{installingTranscription ? `${installPhase || "Installing offline captions"} — ${installProgress}%` : "Install Offline Captions"}</button>
              {installingTranscription && <div className="caption-install-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={installProgress}><span style={{ width: `${installProgress}%` }} /></div>}
            </>}
            <button className="ss-drawer-action-btn primary" disabled={transcribing || audioTracks.length === 0 || transcriptionEnv?.available === false} onClick={() => void generateCaptions()}>
              {transcribing ? "Transcribing…" : "Generate Captions"}
            </button>
            {captionStatus && <p className="panel-help-text" role="status">{captionStatus}</p>}
          </Section>
          {captionTracks.map((track) => (
            <Section key={track.id} title={track.name}>
              <CheckRow label="Show Captions" checked={track.visible} onChange={(visible) => updateCaptionTrack(track.id, (current) => ({ ...current, visible }))} />
              <CheckRow label="Burn Into Export" checked={track.burnedIn} onChange={(burnedIn) => updateCaptionTrack(track.id, (current) => ({ ...current, burnedIn }))} />
              <div className="caption-style-presets" aria-label="Caption style preset">
                <button onClick={() => updateCaptionTrack(track.id, (current) => ({ ...current, style: { ...current.style, color: "#ffffff", backgroundColor: "rgba(0,0,0,0.72)", outlineWidth: 0, fontWeight: 700 } }))}>Classic</button>
                <button onClick={() => updateCaptionTrack(track.id, (current) => ({ ...current, style: { ...current.style, color: "#ffffff", backgroundColor: "rgba(0,0,0,0)", outlineColor: "#000000", outlineWidth: 4, fontWeight: 800 } }))}>Impact</button>
                <button onClick={() => updateCaptionTrack(track.id, (current) => ({ ...current, style: { ...current.style, color: "#0b0d12", backgroundColor: "rgba(255,214,10,0.94)", outlineWidth: 0, fontWeight: 800 } }))}>Highlight</button>
              </div>
              <Slider label="Vertical Position" value={Math.round(track.style.y * 100)} min={10} max={95} step={1} unit="%" onChange={(value) => updateCaptionTrack(track.id, (current) => ({ ...current, style: { ...current.style, y: value / 100 } }))} />
              <Slider label="Font Size" value={track.style.fontSize} min={18} max={96} step={1} unit="px" onChange={(fontSize) => updateCaptionTrack(track.id, (current) => ({ ...current, style: { ...current.style, fontSize } }))} />
              <ColorInput label="Text Color" value={track.style.color} onChange={(color) => updateCaptionTrack(track.id, (current) => ({ ...current, style: { ...current.style, color } }))} />
              <div className="caption-segment-list">
                {track.segments.map((segment, segmentIndex) => (
                  <div className="caption-segment-editor" key={segment.id}>
                    <div className="caption-time-row">
                      <input aria-label="Caption start time" type="number" step="0.05" value={(segment.startMs / 1000).toFixed(2)} onChange={(event) => updateCaptionTrack(track.id, (current) => ({ ...current, segments: current.segments.map((item) => item.id === segment.id ? { ...item, startMs: Math.max(0, Number(event.target.value) * 1000), userEdited: true } : item) }))} />
                      <span>–</span>
                      <input aria-label="Caption end time" type="number" step="0.05" value={(segment.endMs / 1000).toFixed(2)} onChange={(event) => updateCaptionTrack(track.id, (current) => ({ ...current, segments: current.segments.map((item) => item.id === segment.id ? { ...item, endMs: Math.max(item.startMs + 100, Number(event.target.value) * 1000), userEdited: true } : item) }))} />
                    </div>
                    <textarea value={segment.text} aria-label="Caption text" onChange={(event) => updateCaptionTrack(track.id, (current) => ({ ...current, segments: current.segments.map((item) => item.id === segment.id ? { ...item, text: event.target.value, userEdited: true } : item) }))} />
                    <div className="caption-edit-actions">
                      <button onClick={() => updateCaptionTrack(track.id, (current) => {
                        const middle = Math.round((segment.startMs + segment.endMs) / 2);
                        const words = segment.text.trim().split(/\s+/u);
                        const pivot = Math.max(1, Math.ceil(words.length / 2));
                        const replacement = [
                          { ...segment, endMs: middle, text: words.slice(0, pivot).join(" "), userEdited: true },
                          { ...segment, id: `${segment.id}-split-${Date.now()}`, startMs: middle, text: words.slice(pivot).join(" "), userEdited: true },
                        ];
                        return { ...current, segments: current.segments.flatMap((item) => item.id === segment.id ? replacement : [item]) };
                      })}>Split</button>
                      {segmentIndex > 0 && <button onClick={() => updateCaptionTrack(track.id, (current) => {
                        const previous = current.segments[segmentIndex - 1];
                        return { ...current, segments: current.segments.filter((_, index) => index !== segmentIndex).map((item) => item.id === previous.id ? { ...item, endMs: segment.endMs, text: `${item.text} ${segment.text}`.trim(), userEdited: true } : item) };
                      })}>Merge previous</button>}
                    </div>
                  </div>
                ))}
              </div>
              <button className="ss-drawer-action-btn danger" onClick={() => onCaptionTracksChange(captionTracks.filter((item) => item.id !== track.id))}><Trash2 size={14} /> Delete Caption Track</button>
            </Section>
          ))}
        </div>
      )}

    </aside>
  );
}

/* ── Helpers ────────────────────────────────────────────────────────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="ss-section"><h4 className="ss-section-heading">{title}</h4><div className="ss-section-body">{children}</div></div>;
}

function SelectRow({ label, value, options, optionLabels, onChange }: { label: string; value: string; options: string[]; optionLabels?: Record<string, string>; onChange: (value: string) => void }) {
  return <label className="field-row select-row"><span className="field-label">{label}</span><select className="layer-select-input" value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{optionLabels?.[option] ?? option.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase())}</option>)}</select></label>;
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

function SpeedPills({ speed, onChange }: { speed: MovementSpeed; onChange: (v: MovementSpeed) => void }) {
  return (
    <div className="toggle-segmented speed-pills animated-pills" style={{ "--pill-count": 4, "--pill-index": Math.max(0, ["slow", "medium", "fast", "custom"].indexOf(speed)) } as CSSProperties}>
      {(["slow", "medium", "fast", "custom"] as MovementSpeed[]).map((s) => (
        <button key={s} className={`seg-btn ${speed === s ? "active" : ""}`} onClick={() => onChange(s)}>
          {s.charAt(0).toUpperCase() + s.slice(1)}
        </button>
      ))}
    </div>
  );
}
