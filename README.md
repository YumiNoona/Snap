<p align="center">
  <h1 align="center">Snap Screen Recorder</h1>
</p>

<p align="center">
  <a href="#"><img alt="Tauri" src="https://img.shields.io/badge/Tauri-2.0-24C8D8?logo=tauri&logoColor=white"></a>
  <a href="#"><img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black"></a>
  <a href="#"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white"></a>
  <a href="#"><img alt="Rust" src="https://img.shields.io/badge/Rust-1.0-DEA584?logo=rust&logoColor=black"></a>
  <a href="#"><img alt="Windows" src="https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows&logoColor=white"></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg"></a>
</p>

<p align="center">
  A Windows desktop screen recorder inspired by Screen Studio & FocuSee. Features automatic & manual pan/zoom, custom wallpaper mesh gradients, background blur, uniform 4-side padding, multi-track timeline editing, standalone teleprompter, and export presets.
</p>

Built with **Tauri v2** — React + TypeScript frontend, Rust backend. **Windows only.**

---

## Features

- **Sleek Recording Launcher**:
  - **Full Screen Mode** — 1-click primary monitor capture.
  - **Custom Region Selector** — Interactive visual crop box overlay to select exact recording area.
  - **Window Picker** — Pick specific application or browser windows to capture.
  - **Device View** — Step-by-step connection guide for iOS (Lightning/USB-C) and Android (USB Debugging / scrcpy) screen recording.
  - **3-2-1 Countdown** — Smooth non-glitchy pre-recording countdown overlay.

- **Standalone Teleprompter Module**:
  - Free-floating draggable window (`z-index: 9999`) accessible over any application during recording.
  - Karaoke-style word-by-word reveal & smooth auto-scrolling with reading center line marker.
  - Adjustable Speed (60–320 WPM), Font Size (18–48px), Window Opacity, and Flip/Mirror mode for glass hardware setups.

- **Screen Studio-Style Editor**:
  - **Top Bar Header** — Prominent purple/blue **[Export]** button on top right, file title, and presets menu.
  - **Left Vertical Tool Palette** — Iconic quick-switching sidebar (Background, Zoom, Cursor, Shadow, Export).
  - **Background Engine** — Raycast-style wallpaper mesh gradients, soft gradients, solid colors, background blur slider (0–100px), corner radius, and uniform 4-side padding calculation.
  - **Zoom & Motion Engine** — Auto mode (activity cluster detection) and Manual mode (add custom zoom keyframes at playhead position with 1.2x–3.0x zoom level).
  - **Cursor Styling** — Customizable arrow/circle shapes, size, color, and click ripple animations.

- **Multi-Track Timeline**:
  - **Timeline Toolbar** — Aspect ratio dropdown (`Wide 16:9`, `Square 1:1`, `Vertical 9:16`, `4:3`, `Original`), Crop tool, playhead timecodes, transport controls (`|<<`, `Play/Pause`, `>>|`), Scissor cut tool (`✂️`), and timeline zoom scale slider.
  - **Amber Clip Track** — Displays clip duration and playback speed (`Clip 10s • 1x`), cut markers, and trim handles.
  - **Purple Zoom Track** — Displays zoom level, auto/manual tags, and keyframe counts.

- **Export Presets & Render Engine**:
  - Resolution presets (4K Ultra HD, 2K Quad HD, 1080p Full HD, 720p HD, Vertical Reels/Shorts 9:16, Animated GIF).
  - Live estimated file size calculation (`~14.8 MB`).
  - MP4 (H.264) and GIF output formats with High/Medium/Low quality selector.

---

## Architecture

Two-part architecture: a **lightweight native recorder** running during capture, and a **Screen Studio editor UI** loaded after recording stops.

| Module | Path | Purpose |
|--------|------|---------|
| Capture | `src-tauri/src/capture/` | `Windows.Graphics.Capture` via `windows-rs`, mandatory GPU H.264 encoding (NVENC / AMF / Quick Sync), 60 FPS |
| Audio | `src-tauri/src/audio/` | WASAPI dual-track capture (system loopback + microphone), streaming WAV to disk |
| Input Hook | `src-tauri/src/input_hook/` | Low-level Windows input hook via `rdev`, timestamped JSONL sidecar |
| AutoZoom | `src/lib/autoZoom.ts` | Cluster detection & keyframe interpolation |
| Teleprompter | `src/components/Teleprompter/` | Standalone floating teleprompter overlay with karaoke auto-scroll |
| Preview | `src/components/Editor/Preview/` | Canvas renderer with wallpaper gradients, blur, 4-side padding, cursor overlay |
| Timeline | `src/components/Editor/Timeline/` | Multi-track timeline (Clip track, Zoom track, scissor cut, aspect ratio) |
| Panels | `src/components/Editor/Panels/` | Drawer panels for Backgrounds, Zoom, Cursor, Shadow, and Export settings |
| Launcher | `src/components/RecorderLauncher/` | Mode cards (Full Screen/Window/Custom/Device), 3-2-1 countdown overlay |
| Export | `src-tauri/src/export/` | FFmpeg subprocess pipeline for final rendering |

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 7, `@tauri-apps/api` v2, `@tauri-apps/plugin-opener`
- **Backend**: Rust (Tauri v2), `windows-rs` 0.61, `wasapi`, `rdev`, `tokio`, `serde`/`serde_json`
- **External**: FFmpeg (must be available on system `PATH`)

---

## Prerequisites

- Windows 10/11
- [Rust](https://rustup.rs/) (stable toolchain)
- [Node.js](https://nodejs.org/) 18+ and npm
- [FFmpeg](https://ffmpeg.org/) on system `PATH`

---

## Getting Started

```bash
npm install
npm run tauri dev
```

---

## Building

```bash
npm run tauri build
```

The installer/bundle is generated in `src-tauri/target/release/bundle/`.

---

## Project Structure

```
snap/
├── src/                        # React frontend
│   ├── components/
│   │   ├── RecorderLauncher/   # Launcher modes, device picker, floating dock
│   │   ├── Teleprompter/       # Floating Teleprompter window module
│   │   └── Editor/             # Screen Studio Editor (Preview, Timeline, Panels)
│   └── lib/                    # autoZoom, wallpapers, shared types
├── src-tauri/                  # Rust backend
│   ├── src/
│   │   ├── capture/            # Screen capture + H.264 encoding
│   │   ├── audio/              # WASAPI dual-track audio capture
│   │   ├── input_hook/         # Input event logging
│   │   └── export/             # FFmpeg export pipeline
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
└── vite.config.ts
```

---

## License

See [LICENSE](LICENSE).
