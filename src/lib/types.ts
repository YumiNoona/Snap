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

export interface CursorStyle {
  color: string;
  size: number;
  shape: "circle" | "arrow";
  showClickRipples: boolean;
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
  padding: number;
  borderRadius: number;
  shadow: ShadowConfig;
  cursorStyle: CursorStyle;
  showCursor: boolean;
  zoomEnabled: boolean;
  aspectRatio: { width: number; height: number } | null;
  trimStart: number;
  trimEnd: number;
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
  backgroundColor: "#1a1a2e",
  padding: 48,
  borderRadius: 12,
  shadow: {
    enabled: true,
    blur: 40,
    spread: 8,
    color: "rgba(0,0,0,0.5)",
    offsetX: 0,
    offsetY: 8,
  },
  cursorStyle: {
    color: "#ff5050",
    size: 14,
    shape: "circle",
    showClickRipples: true,
  },
  showCursor: true,
  zoomEnabled: true,
  aspectRatio: null,
  trimStart: 0,
  trimEnd: 0,
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
