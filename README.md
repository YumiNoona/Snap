# Snap 2.0.0

Snap is a local-first Windows screen recorder and motion editor built with
Tauri 2, Rust, React, and TypeScript. It captures video, cursor input,
microphone audio, and desktop audio as synchronized sources, then turns the
recording into an editable project with automatic camera movement.

## What Snap includes

- Full-screen, custom-region, window, Android USB, and iPhone/iPad UVC capture
- Hardware-oriented native recording with a lightweight floating control dock
- Independent microphone, desktop, and supported mobile-device audio tracks
- Editable Auto Zoom plus manual zoom regions with focus points and easing
- Timeline clips for zoom, text, shapes, masks, video, and separate audio
- Cursor themes, click effects, cursor smoothing, and motion blur
- Canvas backgrounds, crop, aspect ratio, padding, corners, inset, and shadow
- Presets, undo/redo, keyboard transport controls, trimming, and layer actions
- FFmpeg-based MP4 export with progress, size, and time estimates
- Disconnect-safe mobile recording recovery and automatic mobile zoom analysis
- Signed in-app updates delivered through GitHub Releases

## System requirements

### To use Snap

- Windows 10 or Windows 11, 64-bit
- Microsoft WebView2 Runtime
- FFmpeg and FFprobe available on `PATH` for export and media inspection
- A supported GPU/driver for hardware-accelerated capture where available

### To develop Snap

- Node.js 20 or newer and npm
- Stable Rust with the MSVC Windows target
- Visual Studio Build Tools with the Desktop development with C++ workload

## Project structure

```text
Snap/
├── public/                 App images, cursor themes, and wallpapers
├── src/
│   ├── components/
│   │   ├── Editor/         Preview, timeline, panels, and export UI
│   │   ├── RecorderLauncher/
│   │   ├── Settings/
│   │   ├── Teleprompter/
│   │   └── shared/
│   └── lib/                Auto Zoom, rendering, paths, and project models
├── src-tauri/
│   ├── icons/              Snap application icons
│   └── src/                Native capture, audio, input, export, and mobile
├── .github/workflows/      Signed release automation
├── RELEASING.md            Maintainer release instructions
└── package.json
```

Generated folders such as `node_modules`, `dist`, and `src-tauri/target` are
intentionally excluded from Git.

## Development

Install dependencies and start the native application:

```powershell
npm ci
npm run tauri dev
```

Run the frontend by itself when working only on editor UI:

```powershell
npm run dev
```

## Validation

```powershell
npm run build
npx tsc --noEmit --noUnusedLocals --noUnusedParameters
cd src-tauri
cargo check --locked
```

For a stricter Rust review:

```powershell
cargo clippy --all-targets --all-features -- -D warnings
```

## Build the Windows installer

```powershell
npm run tauri build -- --bundles nsis
```

The NSIS installer is created under:

```text
src-tauri/target/release/bundle/nsis/
```

Updater signatures require `TAURI_SIGNING_PRIVATE_KEY`. Never place the private
key in this repository. See [RELEASING.md](RELEASING.md) for the signed GitHub
release workflow.

## Recording library

Snap stores recordings in a dedicated `Videos\Snap` library. The main folder
stays friendly for everyday use while technical project data lives beside each
recording in its matching project folder:

```text
Videos/
└── Snap/
    ├── snap_123456789.mp4
    └── snap_123456789/
        ├── events.json
        ├── system_audio.wav
        ├── mic_audio.wav
        └── device_audio.wav
```

The **Show audio and project files** setting changes only their Windows
visibility. Hiding them does not disable separate audio, cursor data, Auto Zoom,
editing, recovery, or export. Snap also continues to resolve older sidecar
layouts when opening previous recordings.

## Architecture

| Area | Location | Responsibility |
| --- | --- | --- |
| Capture | `src-tauri/src/capture/` | Native Windows screen and window capture |
| Audio | `src-tauri/src/audio/` | WASAPI microphone and desktop loopback capture |
| Input | `src-tauri/src/input_hook/` | Timestamped pointer and keyboard telemetry |
| Mobile | `src-tauri/src/mobile.rs` | Android/iOS capture, audio, telemetry, and recovery |
| Native API | `src-tauri/src/lib.rs` | Tauri commands, windows, settings, and paths |
| Editor | `src/components/Editor/` | Preview, tools, transport, timeline, and export |
| Auto Zoom | `src/lib/autoZoom.ts` | Interaction clustering and camera regions |
| Mobile zoom | `src/lib/mobileAutoZoom.ts` | Activity-based anchors without touch telemetry |
| Renderer | `src/lib/canvasDraw.ts` | Shared preview and export drawing primitives |
| Export | `src/lib/canvasExport.ts` | Frame compositing and FFmpeg encoding |

Recording remains native and lightweight. The heavier React editor is used
after capture, where timeline editing and rich visual rendering are appropriate.

## Updates and releases

Snap checks `YumiNoona/Snap` for signed updates and can install them without
opening a web browser. Release versions must match in:

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

See [RELEASING.md](RELEASING.md) for signing, tagging, and publishing details.

## License

[MIT](LICENSE)
