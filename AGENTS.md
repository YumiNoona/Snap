# Snap — Architecture & Build Notes

A Windows desktop screen recorder that automatically adds pan/zoom effects,
cursor styling, and background/padding. Inspired by FocuSee. Built with
Tauri v2 (React + TypeScript frontend, Rust backend).

## High-Level Design

Two-part architecture: a **lightweight native recorder** and a **heavier editor UI**.
The product website is an isolated Next.js project under `web/`; it has its
own manifest and is never included in the recorder or editor build.

### Recorder (Rust backend — runs during recording)

Must be extremely lightweight — safe to run in the background while gaming.
All heavy processing is deferred to the editor/export phase.

| Module | Path | Purpose |
|--------|------|---------|
| capture | `src-tauri/src/capture/` | Native Rust lifecycle around FFmpeg's GPU capture inputs: adapter-bound Desktop Duplication for full-screen games/displays, Windows Graphics Capture for windows/regions. D3D11 scaling and hardware H.264 via NVENC / AMF / QuickSync / Media Foundation; software encoding is an explicit opt-in fallback, never automatic. Region/window selection and recovery segments. |
| audio | `src-tauri/src/audio/` | WASAPI dual-track capture: (1) system loopback (speaker output), (2) microphone input. Both synchronized to video capture timestamps. |
| input_hook | `src-tauri/src/input_hook/` | Low-level Windows input hook (`SetWindowsHookEx` or raw input). Logs timestamped mouse clicks, movement, scroll, and keyboard events to a JSON sidecar file next to the recorded video. |

**Recording output**: an MP4/H.264 video file plus a same-stem data directory
containing `events.json` (JSON-lines), audio WAV sidecars and optional camera
media. Legacy adjacent `.json` sidecars remain readable.

### Editor (React frontend — runs after recording stops)

The editor UI is only loaded/used when the user wants to edit a recording.
It does NOT run in the background during capture.

| Module | Path | Purpose |
|--------|------|---------|
| autoZoom | `src/lib/autoZoom.ts` | Analyzes click/typing clusters from the JSON sidecar and auto-generates pan/zoom keyframes. |
| Preview | `src/components/Editor/Preview/` | Real-time canvas/WebGL preview with pan/zoom, cursor overlay, background/padding/shadow applied. |
| Timeline | `src/components/Editor/Timeline/` | Scrubbable timeline with trim handles, keyframe markers, and clip management. |
| Panels | `src/components/Editor/Panels/` | Side panels for adjusting background color, padding, corner radius, shadow, cursor style, and export settings. |
| Finishing | `src/components/Editor/FinishingStudio.tsx`, `src/lib/editorFinishing.ts` | Reviewable transcript/quiet-audio cleanup, voice polish, independent format snapshots, non-destructive cursor repairs, and local style recipes. All heavy preparation runs only in editor mode. |
| RecorderLauncher | `src/components/RecorderLauncher/` | Start/stop recording controls, region picker, and audio source toggles. |

### Export (Rust backend — runs during export)

| Module | Path | Purpose |
|--------|------|---------|
| export | `src/lib/canvasExport.ts`, `src/lib/exportCompositor.ts`, `src-tauri/src/export/` | Shared canvas composition with WebCodecs staging (fallback supported), then FFmpeg encoding/muxing of edited audio and captions. Cached voice-polished WAV media is shared by preview and export. |

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
├── web/                   # Independent Next.js landing and download site
│   └── vercel.json        # Read with Vercel Root Directory set to web/
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

- **Recorder must be lightweight.** Release the heavy editor during capture.
  Capture/encode/audio/input processing is native; only small recorder dock
  and overlay controls retain a webview. Do not run finishing analysis,
  voice polish, proxies, or export during recording.
- **Editor can be heavy.** Full React UI, canvas rendering, timeline, all
  acceptable during edit mode.
- **Windows only.** Uses Windows.Graphics.Capture, WASAPI, Media Foundation,
  and SetWindowsHookEx — all Windows-specific APIs.
- **GPU encoding is the default recording requirement.** Select a supported
  hardware encoder; the user must explicitly opt into software fallback.
- **Website isolation.** Desktop commands use the root Vite/Tauri project.
  Website commands run through `npm --prefix web`; the Vercel project Root
  Directory is `web`, so it cannot package the Windows application or deploy
  the desktop Vite frontend.

## Dependencies

### Rust
- `windows-rs` — Windows.Graphics.Capture, WASAPI, Media Foundation, input hooks
- `tauri` v2 — window management, IPC
- `serde` / `serde_json` — event logging, keyframe serialization

### Frontend
- `react` / `react-dom` — Editor UI
- Canvas API (native) or a lightweight renderer — Preview overlay compositing
- No heavy UI libraries unless necessary

### External
- `FFmpeg` / `FFprobe` — Windows capture, preview preparation, editor voice
  and silence processing, and export encoding/muxing. Managed by app settings.
