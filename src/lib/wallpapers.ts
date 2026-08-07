export interface GradientStop {
  color: string;
  offset: number; // 0-100
}

export interface GradientPreset {
  id: string;
  name: string;
  type: "linear" | "radial";
  angle: number; // degrees (linear only)
  colors: GradientStop[];
}

export interface ColorPreset {
  id: string;
  name: string;
  color: string;
}

export interface WallpaperPreset {
  id: string;
  name: string;
  url: string;
}

// ── 10 curated gradients (warm / cool / vivid) ────────────────────────────────

export const GRADIENT_PRESETS: GradientPreset[] = [
  { id: "gradient-sunset", name: "Raycast Sunset", type: "linear", angle: 135, colors: [
    { color: "#f97316", offset: 0 }, { color: "#ec4899", offset: 50 }, { color: "#8b5cf6", offset: 100 } ] },
  { id: "gradient-aurora", name: "Northern Aurora", type: "linear", angle: 135, colors: [
    { color: "#06b6d4", offset: 0 }, { color: "#3b82f6", offset: 50 }, { color: "#8b5cf6", offset: 100 } ] },
  { id: "gradient-cyber", name: "Cyber Neon", type: "linear", angle: 135, colors: [
    { color: "#a855f7", offset: 0 }, { color: "#ec4899", offset: 50 }, { color: "#f43f5e", offset: 100 } ] },
  { id: "gradient-emerald", name: "Emerald Forest", type: "linear", angle: 135, colors: [
    { color: "#10b981", offset: 0 }, { color: "#06b6d4", offset: 50 }, { color: "#3b82f6", offset: 100 } ] },
  { id: "gradient-flame", name: "Cosmic Flame", type: "linear", angle: 135, colors: [
    { color: "#ef4444", offset: 0 }, { color: "#f97316", offset: 50 }, { color: "#eab308", offset: 100 } ] },
  { id: "gradient-twilight", name: "Deep Twilight", type: "linear", angle: 135, colors: [
    { color: "#1e1b4b", offset: 0 }, { color: "#312e81", offset: 50 }, { color: "#4338ca", offset: 100 } ] },
  { id: "gradient-ocean", name: "Deep Ocean", type: "linear", angle: 180, colors: [
    { color: "#0c4a6e", offset: 0 }, { color: "#0369a1", offset: 50 }, { color: "#22d3ee", offset: 100 } ] },
  { id: "gradient-lavender", name: "Lavender Haze", type: "linear", angle: 160, colors: [
    { color: "#c4b5fd", offset: 0 }, { color: "#a78bfa", offset: 50 }, { color: "#7c3aed", offset: 100 } ] },
  { id: "gradient-midnight", name: "Midnight Galaxy", type: "radial", angle: 0, colors: [
    { color: "#020617", offset: 0 }, { color: "#1e1b4b", offset: 55 }, { color: "#6d28d9", offset: 100 } ] },
  { id: "gradient-sunrise", name: "Golden Sunrise", type: "linear", angle: 110, colors: [
    { color: "#fef3c7", offset: 0 }, { color: "#f59e0b", offset: 55 }, { color: "#ef4444", offset: 100 } ] },
];

// ── 10 curated solid colors ─────────────────────────────────────────────────

export const COLOR_PRESETS: ColorPreset[] = [
  { id: "color-slate", name: "Slate Dark", color: "#0f172a" },
  { id: "color-black", name: "Pure Black", color: "#000000" },
  { id: "color-midnight", name: "Midnight Blue", color: "#0a0a14" },
  { id: "color-white", name: "Soft White", color: "#f8fafc" },
  { id: "color-sky", name: "Sky Blue", color: "#0ea5e9" },
  { id: "color-violet", name: "Violet", color: "#8b5cf6" },
  { id: "color-rose", name: "Rose", color: "#f43f5e" },
  { id: "color-amber", name: "Amber", color: "#f59e0b" },
  { id: "color-emerald", name: "Emerald", color: "#10b981" },
  { id: "color-forest", name: "Forest Green", color: "#14532d" },
];

export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  { id: "wallpaper-abstract", name: "Abstract", url: "/Wallpapers/Abstract.jpg" },
  { id: "wallpaper-blue-waves", name: "Blue Waves", url: "/Wallpapers/BlueWaves.jpg" },
  { id: "wallpaper-candle", name: "Candle", url: "/Wallpapers/Candle.png" },
  { id: "wallpaper-color-wave", name: "Color Wave", url: "/Wallpapers/ColorWave.jpg" },
  { id: "wallpaper-graffiti-wave", name: "Graffiti Wave", url: "/Wallpapers/GrafitiWave.jpg" },
  { id: "wallpaper-kawaii", name: "Kawaii", url: "/Wallpapers/Kawaii.jpg" },
  { id: "wallpaper-kuromi", name: "Kuromi", url: "/Wallpapers/Kuromi.png" },
  { id: "wallpaper-modern-blue", name: "Modern Blue", url: "/Wallpapers/ModernBlueWave.jpg" },
  { id: "wallpaper-pink-wave", name: "Pink Wave", url: "/Wallpapers/PinkWave.png" },
  { id: "wallpaper-somi", name: "Somi", url: "/Wallpapers/Somi.png" },
  { id: "wallpaper-windows-11", name: "Windows 11", url: "/Wallpapers/Win11.jpg" },
];

export function getWallpaperPreset(idOrUrl: string): WallpaperPreset | undefined {
  return WALLPAPER_PRESETS.find((p) => p.id === idOrUrl || p.url === idOrUrl);
}

export function getGradientPreset(id: string): GradientPreset | undefined {
  return GRADIENT_PRESETS.find((p) => p.id === id);
}

/** Build a CSS gradient string for panel swatches / previews. */
export function gradientToCss(preset: GradientPreset): string {
  const stops = preset.colors
    .map((c) => `${c.color} ${c.offset}%`)
    .join(", ");
  if (preset.type === "radial") {
    return `radial-gradient(circle at 30% 30%, ${stops})`;
  }
  return `linear-gradient(${preset.angle}deg, ${stops})`;
}
