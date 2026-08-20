<div align="center">
  <img src="src-tauri/icons/snap.png" width="96" height="96" alt="Snap logo" />
  <h1>Snap</h1>
  <p><strong>Record clearly. Edit beautifully. Move with purpose.</strong></p>
  <p>A local-first Windows screen recorder and motion editor inspired by Screen Studio and FocuSee.</p>

  <p>
    <img src="https://img.shields.io/badge/version-3.0.0-3b82f6?style=flat-square" alt="Version 3.0.0" />
    <img src="https://img.shields.io/badge/platform-Windows-0078D4?style=flat-square&logo=windows11&logoColor=white" alt="Windows" />
    <img src="https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri&logoColor=white" alt="Tauri 2" />
    <img src="https://img.shields.io/badge/Rust-native-orange?style=flat-square&logo=rust" alt="Rust" />
    <img src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square" alt="MIT license" />
  </p>

  <p>
    <a href="https://github.com/YumiNoona/Snap/releases/latest"><strong>Download Snap for Windows</strong></a>
  </p>
</div>

Snap captures video, cursor input, microphone audio, and Windows desktop audio
as synchronized editable sources. Its editor adds automatic or manual camera
movement, captions, cursor styling, backgrounds, annotations, and polished
exports without uploading recordings to a cloud service.

## Snap 3.0.0

This release concentrates on capture reliability and a more deliberate editing
workflow:

- A recording-clock-based audio/video pipeline keeps microphone and desktop
  audio aligned with the first encoded video frame.
- Full-screen capture follows the desktop instead of freezing on the window
  that was active when recording began.
- Preview transport, seeking, replay, and end-of-media recovery use one playback
  controller so the timeline and video frame cannot drift into conflicting states.
- Clip speed can be adjusted from 0.5x to 2x while preview, captions, separate
  audio, and export remain synchronized.
- Zoom regions and caption clips open focused inspectors with richer motion,
  typography, layout, color, and animation controls.
- Warm light and dark editor themes replace the old blue-violet interface while
  keeping tool, timeline, and inspector contrast accessible.
- Preview and export share the same caption renderer, so the delivered MP4
  matches the editor more closely.

## What Snap includes

- Full-screen, custom-region, window, Android USB, and iPhone/iPad UVC capture
- Hardware-oriented native recording with a lightweight floating control dock
- Independent microphone, desktop, and supported mobile-device audio tracks
- Offline English, Hindi, and multilingual transcription with editable captions
- Burned-in captions plus SRT, VTT, and embedded MP4 subtitle export
- Editable Auto Zoom plus manual zoom regions with focus points and easing
- Timeline clips for zoom, text, shapes, masks, video, and separate audio
- Cursor themes, click effects, cursor smoothing, and motion blur
- Canvas backgrounds, crop, aspect ratio, padding, corners, inset, and shadow
- Presets, undo/redo, keyboard transport controls, trimming, and layer actions
- FFmpeg-based MP4 export with progress, size, and time estimates
- Editing for ordinary videos not recorded with Snap, including manual zoom and CC
- Versioned projects, autosave, backup recovery, and missing-sidecar handling
- Disconnect-safe mobile recording recovery and automatic mobile zoom analysis
- Signed in-app updates delivered through GitHub Releases

## System requirements

### To use Snap

- Windows 10 or Windows 11, 64-bit
- Microsoft WebView2 Runtime
- Internet access on first use if FFmpeg or offline caption dependencies need installation
- A supported GPU/driver for hardware-accelerated capture where available

Snap can install FFmpeg and the offline whisper.cpp caption engine when they
are missing. The multilingual speech model is stored per user rather than
embedded in every installer.

### To develop Snap

- Node.js 20.19 or newer (or 22.12 or newer) and npm
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
npm test
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features --locked -- -D warnings
```

## Build the Windows installer

```powershell
npm run tauri -- build --bundles nsis
```

The NSIS installer is created under:

```text
src-tauri/target/release/bundle/nsis/
```

Updater signatures require `TAURI_SIGNING_PRIVATE_KEY`. Never place the private
key in this repository. See [RELEASING.md](RELEASING.md) for the signed GitHub
release workflow.

Official installers, checksums, updater signatures, and release notes are
published on the [GitHub Releases page](https://github.com/YumiNoona/Snap/releases).

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
| Captions | `src-tauri/src/transcription.rs` | Offline whisper.cpp installation and transcription |
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
