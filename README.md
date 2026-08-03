# Snap

A Windows desktop screen recorder that automatically adds pan/zoom effects, cursor styling, and background/padding to your recordings. Inspired by FocuSee.

Built with **Tauri v2** — React + TypeScript frontend, Rust backend. **Windows only.**

## Features

- **Screen & window capture** — record any monitor or visible window via Windows.Graphics.Capture
- **GPU-accelerated recording** — NVENC hardware encoding with automatic libx264 fallback (Media Foundation pipeline, 30 FPS raw frames streamed to FFmpeg)
- **Audio capture** — WASAPI dual-track capture (system loopback + microphone)
- **Input logging** — timestamped mouse/keyboard events written to a JSON sidecar
- **Auto pan/zoom** — analyzes click/typing clusters from the input log and generates pan/zoom keyframes automatically
- **Editor** — scrubbable timeline, trim handles, keyframe markers, cursor overlay
- **Styling** — background color, padding, corner radius, shadow, and cursor style controls
- **Export** — FFmpeg pipeline renders the final edited video

## Architecture

Two-part design: a **lightweight native recorder** that runs in the background (safe while gaming), and a **heavier editor UI** that only loads after recording stops.

| Layer | Path | Purpose |
|-------|------|---------|
| Recorder | `src-tauri/src/capture/` | `Windows.Graphics.Capture` via `windows-rs`, GPU hardware encoding via FFmpeg subprocess (NVENC → libx264 fallback) |
| Audio | `src-tauri/src/audio/` | WASAPI dual-track capture, synchronized to video timestamps |
| Input hook | `src-tauri/src/input_hook/` | Low-level Windows input hook, logs events to a JSON sidecar |
| AutoZoom | `src/lib/autoZoom.ts` | Analyzes the event log and generates pan/zoom keyframes |
| Editor | `src/components/Editor/` | Preview, Timeline, and Panels (styling/export controls) |
| Launcher | `src/components/RecorderLauncher/` | Start/stop recording, target picker, audio source toggles |
| Export | `src-tauri/src/export/` | FFmpeg subprocess pipeline for final rendering |

**Recording output**: an MP4/H.264 video file plus a JSON sidecar (same basename) in your Videos folder.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 7, `@tauri-apps/api` v2
- **Backend**: Rust (Tauri v2), `windows-rs` 0.61, `wasapi`, `rdev`, `tokio`
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
│   │   ├── RecorderLauncher/   # Start/stop recording, target picker
│   │   └── Editor/             # Timeline, Preview, Panels
│   └── lib/autoZoom.ts         # Pan/zoom keyframe generation
├── src-tauri/                  # Rust backend
│   ├── src/
│   │   ├── capture/            # Screen capture + encoding
│   │   ├── audio/              # WASAPI audio capture
│   │   ├── input_hook/         # Input event logging
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

- [x] Scaffold
- [x] Recorder core (capture, audio, input hook)
- [x] Basic playback with cursor overlay
- [ ] autoZoom keyframe generation
- [ ] Editor UI (timeline, styling panels)
- [ ] Export pipeline

## License

See [LICENSE](LICENSE).
