export interface InputEvent {
  ts: number;
  type: string;
  x: number | null;
  y: number | null;
  key: string | null;
  button: string | null;
}

export interface Keyframe {
  time: number;
  duration: number;
  x: number;
  y: number;
  scale: number;
  easing: "linear" | "ease" | "ease-in" | "ease-out" | "ease-in-out";
  source?: "auto" | "manual";
  /** Stable identity shared by every keyframe that belongs to one zoom bar. */
  regionId?: string;
}

export interface ZoomRegionSelection {
  startMs: number;
  endMs: number;
  regionId?: string;
}

export interface ZoomRegionSettings extends ZoomRegionSelection {
  scale: number;
  x: number;
  y: number;
  transitionMs: number;
  exitTransitionMs: number;
  easing: Keyframe["easing"];
  source?: "auto" | "manual";
}

export interface CursorPackState {
  name: string;
  path: string;
  url: string;
}

export interface CursorPackInfo {
  name: string;
  label: string;
  pointer_path: string;
  pointer_url: string;
  states: CursorPackState[];
}

export interface CursorPackSelection {
  id: string;
  label: string;
  imageUrl: string;
}

export type ClickEffect = "none" | "default" | "ripple" | "ring" | "diffusion" | "spotlight" | "sparkle" | "firework" | "christmas";

export interface CursorStyle {
  color: string;
  size: number;
  shape: "circle" | "arrow";
  showClickRipples: boolean;
  pack: CursorPackSelection | null;
  clickEffect: ClickEffect;
  clickSound: boolean;
  hideWhenIdle: boolean;
}

export interface ShadowConfig {
  enabled: boolean;
  blur: number;
  spread: number;
  color: string;
  offsetX: number;
  offsetY: number;
}

export type LayerType = "text" | "shape" | "mask";

export interface BaseLayer {
  id: string;
  type: LayerType;
  start: number;
  end: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
  opacity?: number;
}

export interface TextLayer extends BaseLayer {
  type: "text";
  content: string;
  style: "plain" | "boxed" | "pill" | "badge";
  color: string;
  fontSize: number;
  fontFamily?: "system" | "serif" | "mono";
  fontWeight?: 400 | 500 | 600 | 700 | 800;
  align?: "left" | "center" | "right";
  backgroundColor?: string;
  letterSpacing?: number;
}

export interface ShapeLayer extends BaseLayer {
  type: "shape";
  shape: "line" | "dashedLine" | "arrow" | "rectangle" | "roundedRect" | "circle" | "blob" | "downArrow" | "pointer";
  color: string;
  strokeWidth: number;
  fillColor?: string;
  fillOpacity?: number;
  strokeOpacity?: number;
  cornerRadius?: number;
}

export interface MaskLayer extends BaseLayer {
  type: "mask";
  mask: "spotlight" | "blur" | "magnifier";
  intensity: number;
  feather?: number;
}

export type Layer = TextLayer | ShapeLayer | MaskLayer;

export interface MotionBlurConfig {
  enabled: boolean;
  zoomAmount: number;
  panAmount: number;
  cursorAmount: number;
}

export type MovementSpeed = "slow" | "medium" | "fast" | "rapid" | "custom";

export interface MovementConfig {
  enabled: boolean;
  speed: MovementSpeed;
  durationMs: number;
}

export interface AudioMixConfig {
  systemVolume: number;
  micVolume: number;
  systemMuted: boolean;
  micMuted: boolean;
}

export type AutoZoomPreset = "gentle" | "balanced" | "dynamic" | "custom";

export interface AutoZoomConfig {
  preset: AutoZoomPreset;
  minScale: number;
  maxScale: number;
  holdMs: number;
  cooldownMs: number;
  typingSensitivity: number;
  scrollSensitivity: number;
  edgePadding: number;
}

export const AUTO_ZOOM_PRESETS: Record<Exclude<AutoZoomPreset, "custom">, Omit<AutoZoomConfig, "preset">> = {
  gentle: { minScale: 1.08, maxScale: 1.55, holdMs: 1100, cooldownMs: 850, typingSensitivity: 6, scrollSensitivity: 4, edgePadding: 0.025 },
  balanced: { minScale: 1.15, maxScale: 1.9, holdMs: 720, cooldownMs: 520, typingSensitivity: 4, scrollSensitivity: 2, edgePadding: 0.015 },
  dynamic: { minScale: 1.22, maxScale: 2.35, holdMs: 520, cooldownMs: 260, typingSensitivity: 3, scrollSensitivity: 2, edgePadding: 0.01 },
};

export type AudioTrackKind = "microphone" | "system" | "device";

export interface AudioTrack {
  id: string;
  kind: AudioTrackKind;
  path: string;
  label: string;
  muted: boolean;
  volume: number;
}

export interface CaptionWord {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface CaptionSegment {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  language: string;
  sourceTrackIds: string[];
  confidence?: number;
  words?: CaptionWord[];
  userEdited: boolean;
}

export interface CaptionSegmentSelection {
  trackId: string;
  segmentId: string;
}

export interface CaptionStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: 400 | 500 | 600 | 700 | 800;
  color: string;
  backgroundColor: string;
  outlineColor: string;
  outlineWidth: number;
  shadow: boolean;
  align: "left" | "center" | "right";
  x: number;
  y: number;
  maxWidth: number;
  fontStyle?: "normal" | "italic";
  letterSpacing?: number;
  lineHeight?: number;
  backgroundRadius?: number;
  backgroundPadding?: number;
  shadowBlur?: number;
  animation?: "none" | "fade" | "reveal" | "pop" | "rise" | "slide" | "blur" | "bounce";
  animationDurationMs?: number;
}

export interface CaptionTrack {
  id: string;
  name: string;
  language: string;
  sourceTrackIds: string[];
  visible: boolean;
  burnedIn: boolean;
  style: CaptionStyle;
  segments: CaptionSegment[];
}

export interface EditorConfig {
  backgroundColor: string;
  bgType: "wallpaper" | "gradient" | "color" | "image";
  wallpaperUrl: string;
  bgBlur: number;
  padding: number;
  borderRadius: number;
  inset: number;
  insetColor: string;
  shadow: ShadowConfig;
  cursorStyle: CursorStyle;
  cursorHotspots: Record<string, { x: number; y: number }>;
  showCursor: boolean;
  zoomEnabled: boolean;
  zoomMode: "auto" | "manual";
  zoomLevel: number;
  fixedZoomPart: boolean;
  aspectRatio: { width: number; height: number } | null;
  crop: { x: number; y: number; w: number; h: number } | null;
  trimStart: number;
  trimEnd: number;
  /** Source playback/export speed. 1 is real time. */
  playbackRate: number;
  cuts: number[];
  layers: Layer[];
  motionBlur: MotionBlurConfig;
  cursorMovement: MovementConfig;
  zoomMovement: MovementConfig;
  autoZoom: AutoZoomConfig;
  audio: AudioMixConfig;
}

export interface ExportSettings {
  format: "mp4" | "gif";
  fps: number;
  width: number;
  height: number;
  quality: "high" | "medium" | "low";
  outputPath: string;
  captions: "none" | "burned" | "srt" | "vtt" | "embedded" | "burned-srt";
  audioMode: "mixed" | "separate";
  normalizeAudio: boolean;
}

export const DEFAULT_EDITOR_CONFIG: EditorConfig = {
  backgroundColor: "#1b1714",
  bgType: "wallpaper",
  wallpaperUrl: "gradient-sunset",
  bgBlur: 0,
  padding: 48,
  borderRadius: 14,
  inset: 0,
  insetColor: "#000000",
  shadow: {
    enabled: true,
    blur: 40,
    spread: 8,
    color: "rgba(0,0,0,0.6)",
    offsetX: 0,
    offsetY: 12,
  },
  cursorStyle: {
    color: "#d58a55",
    size: 16,
    shape: "arrow",
    showClickRipples: true,
    pack: null,
    clickEffect: "default",
    clickSound: false,
    hideWhenIdle: false,
  },
  cursorHotspots: {},
  showCursor: true,
  zoomEnabled: true,
  zoomMode: "auto",
  zoomLevel: 2.0,
  fixedZoomPart: false,
  aspectRatio: null,
  crop: null,
  trimStart: 0,
  trimEnd: 0,
  playbackRate: 1,
  cuts: [],
  layers: [],
  motionBlur: {
    enabled: false,
    zoomAmount: 0,
    panAmount: 0,
    cursorAmount: 0,
  },
  cursorMovement: {
    enabled: false,
    speed: "medium",
    durationMs: 600,
  },
  zoomMovement: {
    enabled: false,
    speed: "slow",
    durationMs: 800,
  },
  autoZoom: {
    preset: "balanced",
    minScale: 1.15,
    maxScale: 1.9,
    holdMs: 720,
    cooldownMs: 520,
    typingSensitivity: 4,
    scrollSensitivity: 2,
    edgePadding: 0.015,
  },
  audio: {
    systemVolume: 100,
    micVolume: 100,
    systemMuted: false,
    micMuted: false,
  },
};

export const ASPECT_RATIOS = [
  { label: "Original", width: 0, height: 0 },
  { label: "16:9", width: 16, height: 9 },
  { label: "4:3", width: 4, height: 3 },
  { label: "1:1", width: 1, height: 1 },
  { label: "9:16", width: 9, height: 16 },
  { label: "21:9", width: 21, height: 9 },
  { label: "3:2", width: 3, height: 2 },
];

export const MOVEMENT_SPEED_MAP: Record<MovementSpeed, number> = {
  slow: 900,
  medium: 600,
  fast: 350,
  rapid: 180,
  custom: 600,
};

export function getMovementDuration(config: MovementConfig): number {
  if (config.speed === "custom") return config.durationMs;
  return MOVEMENT_SPEED_MAP[config.speed];
}
