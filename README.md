<div align="center">
  <img src="src-tauri/icons/snap.png" width="96" height="96" alt="Snap logo" />
  <h1>Snap</h1>
  <p><strong>Record clearly. Edit beautifully. Move with purpose.</strong></p>
  <p>A local-first Windows screen recorder and motion editor inspired by Screen Studio and FocuSee.</p>

  <p>
    <img src="https://img.shields.io/badge/version-9.0.1-10b981?style=flat-square" alt="Version 9.0.1" />
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

## What Snap includes

- Full-screen, custom-region, window, Android USB, and iPhone/iPad UVC capture
- Hardware-oriented native recording with a lightweight floating control dock
- Independent microphone, desktop, camera, and supported mobile-device tracks
- Offline English, Hindi, and multilingual transcription with editable captions
- Burned-in captions plus SRT, VTT, and embedded MP4 subtitle export
- Editable Auto Zoom plus manual zoom regions with focus points and easing
- Auto Zoom 2.0 focus modes, dead zones, intent-aware typing/scroll shots, idle
  resets, minimum shot length, and independent click/typing zoom levels
- Timeline clips for zoom, text, shapes, masks, video, and separate audio
- Cursor themes, click effects, cursor smoothing, and motion blur
- Privacy-safe keyboard shortcuts, mouse clicks, and scroll callouts with
  configurable placement, styling, timing, and preview/export parity
- Webcam Studio framing with six placements, circle/rounded/square crops,
  subject reframe, mirror, opacity, border, and shadow controls
- Canvas backgrounds, crop, aspect ratio, padding, corners, inset, and shadow
- Freeze frames, PNG thumbnails, cursor-following masks, snap-to-click layers,
  copied layer styles, original/edited comparison, and a command palette
- MP4, WebM, and looping GIF export plus optional transcript, chapter, and
  thumbnail delivery packages and pre-export project health checks
- Editing for ordinary videos not recorded with Snap, including manual zoom and CC
- Versioned projects, autosave, backup recovery, and missing-sidecar handling
- Disconnect-safe mobile recording recovery and automatic mobile zoom analysis
- Signed in-app updates delivered through GitHub Releases

## System requirements

### To use Snap

- Windows 10 or Windows 11, 64-bit
- Microsoft WebView2 Runtime
- Internet access on first use if FFmpeg or offline caption dependencies need installation
- A current Windows display driver is recommended. Snap tries NVENC, AMD AMF,
  Intel Quick Sync, and Windows Media Foundation, then can use a low-priority
  CPU compatibility encoder when no GPU encoder is available.

Snap can install FFmpeg and the offline whisper.cpp caption engine when they
are missing. Verified caption binaries and the multilingual speech model are
stored per user and reused instead of being downloaded for every project.

Automatic performance mode is the default. It verifies a working hardware
encoder and records at up to 1080p/30 and 10 Mbps, without upscaling smaller
targets. Manual mode provides
24/30/60 FPS, 2–50 Mbps bitrate, native/1080p/720p limits, and an explicit CPU
compatibility option. Camera capture is opt-in and defaults off.

Before recording, Snap saves and unmounts the editor preview to release its
video decoders, audio contexts, cached images, and frame callbacks. Capture
startup, pause/resume, and stop are serialized on a lifecycle lock outside the
media loops. Device initialization and other blocking work run off the UI and
async runtime threads. The live screen path keeps frames on the GPU and runs
its encoder below normal CPU priority with bounded frame buffering where
supported by FFmpeg; it does not silently switch to CPU frame readback.

For older laptops, manual 720p/30 lowers the capture workload; selecting a
smaller recording region can retain readable text without capturing a large
desktop. Actual impact while gaming depends on available GPU headroom and
drivers and should be measured on the recording PC.

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
├── web/                    Isolated Next.js product and download website
│   └── vercel.json         Website deployment configuration
├── .github/workflows/      Signed release automation
├── RELEASING.md            Maintainer release instructions
└── package.json
```

Generated folders such as `node_modules`, `dist`, `web/.next`, and
`src-tauri/target` are intentionally excluded from Git. The desktop and website
keep separate manifests and dependency trees, so building either one does not
compile or package the other.

## Development

Install dependencies and start the native application:

```powershell
npm ci
npm run tauri dev
```

Run the product website independently:

```powershell
npm --prefix web ci
npm run web:dev
```

For Vercel, set the project **Root Directory** to `web`. Vercel then reads
`web/vercel.json`, detects Next.js from `web/package.json`, and deploys
only the landing page. The Tauri application continues to use the repository-root
`npm run build` command and `dist/` output.

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
        ├── camera.mp4
        ├── camera.json
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

Recording remains native and lightweight. The heavier React editor loads after
capture, where timeline editing and rich visual rendering are appropriate.

## Maintenance

Run `npm run check:source` to check the desktop import graph for orphaned source files and missing relative imports. Tests, native commands and dynamically loaded editor modules remain separate from the website.

The latest cleanup, validation and suggested improvements are documented in [docs/CODE_REVIEW.md](docs/CODE_REVIEW.md).

## Updates and releases

Snap checks `YumiNoona/Snap` for signed updates and can install them without
opening a web browser. Release versions must match in:

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

See [RELEASING.md](RELEASING.md) for signing, tagging, and publishing details.

## License

[MIT](LICENSE)

<p align="center">
  Built With 💙 Made By <a href="https://venusapp.in">Veil(venusapp.in)</a>
</p>
