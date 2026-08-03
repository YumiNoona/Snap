# Snap — Architecture & Build Notes

A Windows desktop screen recorder that automatically adds pan/zoom effects,
cursor styling, and background/padding. Inspired by FocuSee. Built with
Tauri v2 (React + TypeScript frontend, Rust backend).

## High-Level Design

Two-part architecture: a **lightweight native recorder** and a **heavier editor UI**.

### Recorder (Rust backend — runs during recording)

Must be extremely lightweight — safe to run in the background while gaming.
All heavy processing is deferred to the editor/export phase.

| Module | Path | Purpose |
|--------|------|---------|
| capture | `src-tauri/src/capture/` | `Windows.Graphics.Capture` via `windows-rs` crate. GPU hardware encoding (NVENC / AMF / QuickSync) via Media Foundation. Region selection, cursor overlay compositing, HDR tone-mapping. |
| audio | `src-tauri/src/audio/` | WASAPI dual-track capture: (1) system loopback (speaker output), (2) microphone input. Both synchronized to video capture timestamps. |
| input_hook | `src-tauri/src/input_hook/` | Low-level Windows input hook (`SetWindowsHookEx` or raw input). Logs timestamped mouse clicks, movement, scroll, and keyboard events to a JSON sidecar file next to the recorded video. |

**Recording output**: an MP4/H.264 video file + a JSON sidecar file in the same
directory (same basename, `.json` extension).

### Editor (React frontend — runs after recording stops)

The editor UI is only loaded/used when the user wants to edit a recording.
It does NOT run in the background during capture.

| Module | Path | Purpose |
|--------|------|---------|
| autoZoom | `src/lib/autoZoom.ts` | Analyzes click/typing clusters from the JSON sidecar and auto-generates pan/zoom keyframes. |
| Preview | `src/components/Editor/Preview/` | Real-time canvas/WebGL preview with pan/zoom, cursor overlay, background/padding/shadow applied. |
| Timeline | `src/components/Editor/Timeline/` | Scrubbable timeline with trim handles, keyframe markers, and clip management. |
| Panels | `src/components/Editor/Panels/` | Side panels for adjusting background color, padding, corner radius, shadow, cursor style, and export settings. |
| RecorderLauncher | `src/components/RecorderLauncher/` | Start/stop recording controls, region picker, and audio source toggles. |

### Export (Rust backend — runs during export)

| Module | Path | Purpose |
|--------|------|---------|
| export | `src-tauri/src/export/` | FFmpeg subprocess pipeline. Reads the recorded video + JSON sidecar, applies pan/zoom keyframes and visual styling, and renders the final edited video to an output file. |

## Folder Structure

```
snap/
├── src/
│   ├── components/
│   │   ├── RecorderLauncher/
│   │   └── Editor/
│   │       ├── Timeline/
│   │       ├── Preview/
│   │       └── Panels/
│   ├── lib/
│   │   └── autoZoom.ts
│   ├── App.tsx
│   ├── App.css
│   ├── main.tsx
│   └── vite-env.d.ts
├── src-tauri/
│   ├── src/
│   │   ├── capture/mod.rs
│   │   ├── audio/mod.rs
│   │   ├── input_hook/mod.rs
│   │   ├── export/mod.rs
│   │   ├── lib.rs
│   │   └── main.rs
│   ├── capabilities/
│   ├── icons/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── build.rs
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── AGENTS.md          ← this file
```

## Build Phases (strict order)

1. **Scaffold** — project structure, AGENTS.md (DONE)
2. **Recorder core** — capture + audio + input_hook (Rust)
3. **Basic playback** — load video + sidecar in Editor, cursor overlay
4. **autoZoom** — analyze events, generate pan/zoom keyframes
5. **Editor UI** — Timeline, Preview, Panels, styling controls
6. **Export pipeline** — FFmpeg integration, render final video

## Key Constraints

- **Recorder must be lightweight.** No React rendering, no DOM, no Node.js
  runtime during capture. Only native Rust capture/encode/audio/input loops
  with minimal IPC.
- **Editor can be heavy.** Full React UI, canvas rendering, timeline, all
  acceptable during edit mode.
- **Windows only.** Uses Windows.Graphics.Capture, WASAPI, Media Foundation,
  and SetWindowsHookEx — all Windows-specific APIs.
- **GPU encoding mandatory for recording.** Software encoding would be too
  heavy for background gaming. Media Foundation with hardware codecs is the
  primary path.

## Dependencies (planned)

### Rust
- `windows-rs` — Windows.Graphics.Capture, WASAPI, Media Foundation, input hooks
- `tauri` v2 — window management, IPC
- `serde` / `serde_json` — event logging, keyframe serialization

### Frontend
- `react` / `react-dom` — Editor UI
- Canvas API (native) or a lightweight renderer — Preview overlay compositing
- No heavy UI libraries unless necessary

### External
- `FFmpeg` — export encoding (bundled or sidecar, TBD)
