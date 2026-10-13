/** Actual Snap screenshots supplied for the October 2026 product showcase. */
export const productShots = [
  { id: "editor", label: "Editor", file: "editor-dark.webp", alt: "Snap's dark editor with a code recording, cursor controls and editable video, audio and zoom tracks" },
  { id: "motion", label: "Camera", file: "motion.webp", alt: "Snap zoom and pan controls next to a focused code recording and zoom regions on the timeline" },
  { id: "layers", label: "Layers", file: "layers.webp", alt: "Snap text, shape and mask tools with a recording and multi-track timeline" },
  { id: "looks", label: "Looks", file: "film-looks.webp", alt: "Film looks and color adjustments in the Snap editor" },
  { id: "audio", label: "Audio", file: "audio.webp", alt: "Independent system audio and microphone controls with audio waveforms" },
  { id: "captions", label: "Captions", file: "captions.webp", alt: "Snap automatic captions with audio source, language and local model selection" },
  { id: "tilt", label: "3D tilt", file: "tilt.webp", alt: "Snap screen perspective and 3D tilt controls" },
  { id: "light", label: "Light mode", file: "editor-light.webp", alt: "The same Snap editing workspace in its light theme" },
  { id: "voice", label: "Voice polish", file: "voice.webp", alt: "Snap's local voice polish, hum filter, room-tail reduction and leveling controls" },
  { id: "player", label: "Fullscreen preview", file: "player.webp", alt: "The latest full-screen Snap preview with a floating transparent playback dock" },
] as const;

export const screenshotSrc = (file: string) => `/screenshots/${file}`;
