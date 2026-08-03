<p align="center">
  <h1 align="center">Snap</h1>
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
  A Windows desktop screen recorder with automatic pan/zoom, cursor effects, background styling, and export presets. Inspired by FocuSee.
</p>

Built with **Tauri v2** — React + TypeScript frontend, Rust backend. **Windows only.**

## Features

- **Recording modes** — Full screen, specific window, or drag-to-select region
- **GPU-accelerated encoding** — NVENC hardware at 60 FPS, 12 Mbps, with automatic libx264 fallback
- **Dual-track audio** — WASAPI system loopback + microphone, captured to separate WAV files alongside the video
- **Input logging** — timestamped mouse clicks, movement, scroll, and keystrokes written to a JSONL sidecar
- **Auto pan/zoom** — detects click/typing activity clusters and generates smooth ease-in-out keyframes automatically
- **Editor** — canvas preview with real-time zoom/pan transforms, customizable cursor overlay (circle/arrow), click ripple animations, and zoom percentage badge
- **Timeline** — scrubbable timeline with time ruler, trim handles, zoom layer segments, keyframe dot markers, and audio track indicator
- **Styling** — background color, padding, corner radius, shadow (blur/offset/color), cursor style (color/size/shape), aspect ratio presets (16:9, 4:3, 1:1, 21:9)
- **Export presets** — Premiere Pro-style resolution presets (HD 720p, Full HD 1080p, 2K 1440p, 4K 2160p, Custom), FPS presets (24/30/60/120/240/540 + Custom 1–540), MP4/GIF format, quality levels
- **Trim tools** — Set In / Set Out at playhead position, Reset trim, with duration display

## Architecture

Two-part design: a **lightweight native recorder** that runs in the background (safe while gaming), and a **heavier editor UI** that only loads after recording stops.

| Layer | Path | Purpose |
|-------|------|---------|
| Capture | `src-tauri/src/capture/` | `Windows.Graphics.Capture` via `windows-rs`, GPU hardware encoding via FFmpeg subprocess (NVENC → libx264 fallback), 60 FPS |
| Audio | `src-tauri/src/audio/` | WASAPI dual-track capture (system loopback + microphone), streaming WAV to disk |
| Input hook | `src-tauri/src/input_hook/` | Low-level Windows input hook via `rdev`, timestamped JSONL sidecar |
| AutoZoom | `src/lib/autoZoom.ts` | Activity cluster detection, smooth ease-in-out keyframe generation |
| Preview | `src/components/Editor/Preview/` | Canvas renderer with zoom/pan, background/shadow, cursor overlay, aspect ratio |
| Timeline | `src/components/Editor/Timeline/` | Scrubbable timeline with ruler, trim handles, zoom layer, keyframe markers, audio track |
| Panels | `src/components/Editor/Panels/` | Editing tools (trim, layout, cursor, zoom, shadow) and export presets |
| Launcher | `src/components/RecorderLauncher/` | Mode cards (Full Screen/Window/Custom), device picker, debug tools |
| Export | `src-tauri/src/export/` | FFmpeg subprocess pipeline with zoompan filter for final rendering |

**Recording output**: an MP4/H.264 video (60 FPS) + a JSONL input log + WAV audio tracks (system + mic) in your Videos folder.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 7, `@tauri-apps/api` v2, `@tauri-apps/plugin-opener`
- **Backend**: Rust (Tauri v2), `windows-rs` 0.61, `wasapi`, `rdev`, `tokio`, `serde`/`serde_json`
- **External**: FFmpeg (must be on `PATH`)

## Prerequisites

- Windows 10/11 (Windows.Graphics.Capture is required)
- [Rust](https://rustup.rs/) (stable toolchain)
- [Node.js](https://nodejs.org/) 18+ and npm
- [FFmpeg](https://ffmpeg.org/) available on `PATH`
- WebView2 runtime (usually preinstalled on Windows 11)

## Getting Started

```bash
npm install
npm run tauri dev
```

## Building

```bash
npm run tauri build
```

The installer/bundle is written to `src-tauri/target/release/bundle/`.

## Project Structure

```
snap/
├── src/                        # React frontend (editor UI)
│   ├── components/
│   │   ├── RecorderLauncher/   # Mode cards, device picker, region selector
│   │   └── Editor/             # Preview, Timeline, Panels
│   └── lib/                    # autoZoom, shared types
├── src-tauri/                  # Rust backend
│   ├── src/
│   │   ├── capture/            # Screen capture + H.264 encoding
│   │   ├── audio/              # WASAPI dual-track audio capture
│   │   ├── input_hook/         # Low-level input event logging
│   │   └── export/             # FFmpeg export pipeline
│   ├── capabilities/
│   ├── icons/
│   ├── Cargo.toml
│   └── tauri.conf.json
├── AGENTS.md                   # Architecture & build notes
├── package.json
└── vite.config.ts
```

## Roadmap

- [x] Scaffold & project structure
- [x] Recorder core — capture, audio, input hook
- [x] Editor UI — preview, timeline, panels, styling controls
- [x] Auto zoom — cluster detection & keyframe generation
- [x] Recording modes — full screen, window, region select
- [x] Export presets — resolutions, FPS, format, quality
- [x] 60 FPS recording
- [ ] Captions / text overlay
- [ ] Webcam overlay (picture-in-picture)
- [ ] Advanced export with cursor/keyframe rendering

## License

See [LICENSE](LICENSE).
