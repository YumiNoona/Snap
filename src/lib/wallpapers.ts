export interface WallpaperPreset {
  id: string;
  name: string;
  category: "wallpaper" | "gradient" | "color";
  gradient: string;
}

export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  // Raycast / Screen Studio Mesh Wallpaper Gradients
  {
    id: "gradient-sunset",
    name: "Raycast Sunset",
    category: "wallpaper",
    gradient: "linear-gradient(135deg, #f97316 0%, #ec4899 50%, #8b5cf6 100%)",
  },
  {
    id: "gradient-aurora",
    name: "Northern Aurora",
    category: "wallpaper",
    gradient: "linear-gradient(135deg, #06b6d4 0%, #3b82f6 50%, #8b5cf6 100%)",
  },
  {
    id: "gradient-cyber",
    name: "Cyber Neon",
    category: "wallpaper",
    gradient: "linear-gradient(135deg, #a855f7 0%, #ec4899 50%, #f43f5e 100%)",
  },
  {
    id: "gradient-emerald",
    name: "Emerald Forest",
    category: "wallpaper",
    gradient: "linear-gradient(135deg, #10b981 0%, #06b6d4 50%, #3b82f6 100%)",
  },
  {
    id: "gradient-flame",
    name: "Cosmic Flame",
    category: "wallpaper",
    gradient: "linear-gradient(135deg, #ef4444 0%, #f97316 50%, #eab308 100%)",
  },
  {
    id: "gradient-twilight",
    name: "Deep Twilight",
    category: "wallpaper",
    gradient: "linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%)",
  },
  {
    id: "gradient-candy",
    name: "Cotton Candy",
    category: "wallpaper",
    gradient: "linear-gradient(135deg, #f472b6 0%, #38bdf8 100%)",
  },
  {
    id: "gradient-obsidian",
    name: "Dark Obsidian",
    category: "wallpaper",
    gradient: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)",
  },

  // Soft Gradients
  {
    id: "gradient-soft-blue",
    name: "Soft Blue",
    category: "gradient",
    gradient: "linear-gradient(180deg, #1e293b 0%, #0f172a 100%)",
  },
  {
    id: "gradient-soft-purple",
    name: "Soft Purple",
    category: "gradient",
    gradient: "linear-gradient(180deg, #2e1065 0%, #0f172a 100%)",
  },
  {
    id: "gradient-soft-rose",
    name: "Soft Rose",
    category: "gradient",
    gradient: "linear-gradient(180deg, #4c0519 0%, #0f172a 100%)",
  },

  // Solid Neutral Colors
  {
    id: "color-dark-gray",
    name: "Slate Dark",
    category: "color",
    gradient: "#0f172a",
  },
  {
    id: "color-pure-black",
    name: "Pure Black",
    category: "color",
    gradient: "#000000",
  },
  {
    id: "color-midnight",
    name: "Midnight Blue",
    category: "color",
    gradient: "#0a0a14",
  },
];
