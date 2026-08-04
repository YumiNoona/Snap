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

export interface CursorStyle {
  color: string;
  size: number;
  shape: "circle" | "arrow";
  showClickRipples: boolean;
  pack: CursorPackSelection | null;
}

export interface ShadowConfig {
  enabled: boolean;
  blur: number;
  spread: number;
  color: string;
  offsetX: number;
  offsetY: number;
}

export interface EditorConfig {
  backgroundColor: string;
  bgType: "wallpaper" | "gradient" | "color" | "image";
  wallpaperUrl: string;
  bgBlur: number;
  padding: number;
  borderRadius: number;
  shadow: ShadowConfig;
  cursorStyle: CursorStyle;
  cursorHotspots: Record<string, { x: number; y: number }>;
  showCursor: boolean;
  zoomEnabled: boolean;
  zoomMode: "auto" | "manual";
  zoomLevel: number;
  aspectRatio: { width: number; height: number } | null;
  crop: { x: number; y: number; w: number; h: number } | null;
  trimStart: number;
  trimEnd: number;
  cuts: number[];
}

export interface ClipSegment {
  start: number;
  end: number;
}

export interface ExportSettings {
  format: "mp4" | "gif";
  fps: number;
  width: number;
  height: number;
  quality: "high" | "medium" | "low";
  outputPath: string;
}

export const DEFAULT_EDITOR_CONFIG: EditorConfig = {
  backgroundColor: "#0f172a",
  bgType: "wallpaper",
  wallpaperUrl: "gradient-sunset",
  bgBlur: 0,
  padding: 48,
  borderRadius: 14,
  shadow: {
    enabled: true,
    blur: 40,
    spread: 8,
    color: "rgba(0,0,0,0.6)",
    offsetX: 0,
    offsetY: 12,
  },
  cursorStyle: {
    color: "#3b82f6",
    size: 16,
    shape: "arrow",
    showClickRipples: true,
    pack: null,
  },
  cursorHotspots: {},
  showCursor: true,
  zoomEnabled: true,
  zoomMode: "auto",
  zoomLevel: 2.0,
  aspectRatio: null,
  crop: null,
  trimStart: 0,
  trimEnd: 0,
  cuts: [],
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
