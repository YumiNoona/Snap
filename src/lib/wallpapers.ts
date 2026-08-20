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
  previewUrl: string;
  thumbnailUrl: string;
}

// Warm, filmic editor palette. IDs remain stable so existing projects migrate
// without missing presets, while the visual language avoids cold blue/violet UI.

export const GRADIENT_PRESETS: GradientPreset[] = [
  { id: "gradient-sunset", name: "Terracotta Sunset", type: "linear", angle: 135, colors: [
    { color: "#f0b27a", offset: 0 }, { color: "#d86f45", offset: 52 }, { color: "#7f3528", offset: 100 } ] },
  { id: "gradient-aurora", name: "Sage Morning", type: "linear", angle: 135, colors: [
    { color: "#e8ddbd", offset: 0 }, { color: "#9dad78", offset: 52 }, { color: "#465b3d", offset: 100 } ] },
  { id: "gradient-cyber", name: "Clay Blossom", type: "linear", angle: 135, colors: [
    { color: "#f2c2a2", offset: 0 }, { color: "#c86b53", offset: 50 }, { color: "#713d31", offset: 100 } ] },
  { id: "gradient-emerald", name: "Olive Grove", type: "linear", angle: 135, colors: [
    { color: "#d6d09a", offset: 0 }, { color: "#778554", offset: 50 }, { color: "#34432f", offset: 100 } ] },
  { id: "gradient-flame", name: "Golden Ember", type: "linear", angle: 135, colors: [
    { color: "#f2c05e", offset: 0 }, { color: "#d36c32", offset: 50 }, { color: "#8a2f25", offset: 100 } ] },
  { id: "gradient-twilight", name: "Cedar Night", type: "linear", angle: 135, colors: [
    { color: "#17120f", offset: 0 }, { color: "#3d2920", offset: 52 }, { color: "#82513a", offset: 100 } ] },
  { id: "gradient-ocean", name: "Deep Moss", type: "linear", angle: 180, colors: [
    { color: "#19231c", offset: 0 }, { color: "#3f5a43", offset: 50 }, { color: "#90a66c", offset: 100 } ] },
  { id: "gradient-lavender", name: "Peach Linen", type: "linear", angle: 160, colors: [
    { color: "#fff0dd", offset: 0 }, { color: "#e6b38d", offset: 50 }, { color: "#b86345", offset: 100 } ] },
  { id: "gradient-midnight", name: "Espresso Glow", type: "radial", angle: 0, colors: [
    { color: "#d9955f", offset: 0 }, { color: "#513326", offset: 55 }, { color: "#130f0d", offset: 100 } ] },
  { id: "gradient-sunrise", name: "Golden Sunrise", type: "linear", angle: 110, colors: [
    { color: "#fff2c9", offset: 0 }, { color: "#e5a43f", offset: 55 }, { color: "#ba4b33", offset: 100 } ] },
  { id: "gradient-arctic", name: "Warm Porcelain", type: "linear", angle: 145, colors: [
    { color: "#fffaf1", offset: 0 }, { color: "#d8c6ad", offset: 48 }, { color: "#887363", offset: 100 } ] },
  { id: "gradient-rose-gold", name: "Rosewood", type: "linear", angle: 125, colors: [
    { color: "#f5c7aa", offset: 0 }, { color: "#c66a5b", offset: 52 }, { color: "#6b2e2c", offset: 100 } ] },
  { id: "gradient-electric-lime", name: "Citrus Leaf", type: "linear", angle: 120, colors: [
    { color: "#e9e6a8", offset: 0 }, { color: "#a5a84f", offset: 48 }, { color: "#46582f", offset: 100 } ] },
  { id: "gradient-steel", name: "Stone & Sand", type: "radial", angle: 0, colors: [
    { color: "#f7f0e4", offset: 0 }, { color: "#b9a895", offset: 54 }, { color: "#4c433b", offset: 100 } ] },
];

// ── 10 curated solid colors ─────────────────────────────────────────────────

export const COLOR_PRESETS: ColorPreset[] = [
  { id: "color-slate", name: "Espresso", color: "#1b1714" },
  { id: "color-black", name: "Pure Black", color: "#000000" },
  { id: "color-midnight", name: "Charcoal", color: "#25211d" },
  { id: "color-white", name: "Warm White", color: "#fffaf2" },
  { id: "color-sky", name: "Terracotta", color: "#b95f3d" },
  { id: "color-violet", name: "Burnt Clay", color: "#934a36" },
  { id: "color-rose", name: "Rosewood", color: "#9b4740" },
  { id: "color-amber", name: "Amber", color: "#d69738" },
  { id: "color-emerald", name: "Sage", color: "#7f9363" },
  { id: "color-forest", name: "Forest", color: "#3e563b" },
  { id: "color-indigo", name: "Cedar", color: "#5c3b2e" },
  { id: "color-coral", name: "Soft Coral", color: "#d97863" },
  { id: "color-cyan", name: "Olive", color: "#8c8d4f" },
  { id: "color-sand", name: "Warm Sand", color: "#d6a85f" },
  { id: "color-parchment", name: "Parchment", color: "#e9dec9" },
];

export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  { id: "wallpaper-abstract", name: "Abstract", url: "/Wallpapers/Abstract.jpg", previewUrl: "/Wallpapers/previews/Abstract.jpg", thumbnailUrl: "/Wallpapers/thumbnails/Abstract.jpg" },
  { id: "wallpaper-blue-waves", name: "Blue Waves", url: "/Wallpapers/BlueWaves.jpg", previewUrl: "/Wallpapers/previews/BlueWaves.jpg", thumbnailUrl: "/Wallpapers/thumbnails/BlueWaves.jpg" },
  { id: "wallpaper-candle", name: "Candle", url: "/Wallpapers/Candle.png", previewUrl: "/Wallpapers/previews/Candle.jpg", thumbnailUrl: "/Wallpapers/thumbnails/Candle.jpg" },
  { id: "wallpaper-color-wave", name: "Color Wave", url: "/Wallpapers/ColorWave.jpg", previewUrl: "/Wallpapers/previews/ColorWave.jpg", thumbnailUrl: "/Wallpapers/thumbnails/ColorWave.jpg" },
  { id: "wallpaper-graffiti-wave", name: "Graffiti Wave", url: "/Wallpapers/GrafitiWave.jpg", previewUrl: "/Wallpapers/previews/GrafitiWave.jpg", thumbnailUrl: "/Wallpapers/thumbnails/GrafitiWave.jpg" },
  { id: "wallpaper-kawaii", name: "Kawaii", url: "/Wallpapers/Kawaii.jpg", previewUrl: "/Wallpapers/previews/Kawaii.jpg", thumbnailUrl: "/Wallpapers/thumbnails/Kawaii.jpg" },
  { id: "wallpaper-kuromi", name: "Kuromi", url: "/Wallpapers/Kuromi.png", previewUrl: "/Wallpapers/previews/Kuromi.jpg", thumbnailUrl: "/Wallpapers/thumbnails/Kuromi.jpg" },
  { id: "wallpaper-modern-blue", name: "Modern Blue", url: "/Wallpapers/ModernBlueWave.jpg", previewUrl: "/Wallpapers/previews/ModernBlueWave.jpg", thumbnailUrl: "/Wallpapers/thumbnails/ModernBlueWave.jpg" },
  { id: "wallpaper-pink-wave", name: "Pink Wave", url: "/Wallpapers/PinkWave.png", previewUrl: "/Wallpapers/previews/PinkWave.jpg", thumbnailUrl: "/Wallpapers/thumbnails/PinkWave.jpg" },
  { id: "wallpaper-somi", name: "Somi", url: "/Wallpapers/Somi.png", previewUrl: "/Wallpapers/previews/Somi.jpg", thumbnailUrl: "/Wallpapers/thumbnails/Somi.jpg" },
  { id: "wallpaper-windows-11", name: "Windows 11", url: "/Wallpapers/Win11.jpg", previewUrl: "/Wallpapers/previews/Win11.jpg", thumbnailUrl: "/Wallpapers/thumbnails/Win11.jpg" },
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
