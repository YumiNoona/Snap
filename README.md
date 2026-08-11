# Snap 1.0.0

Snap is a Windows screen recorder and motion editor built with Tauri 2, Rust,
React, and TypeScript. It records the screen, microphone, desktop audio, cursor,
and input events, then turns those inputs into an editable video project with
automatic or manual pan and zoom.

## Highlights

- Full-screen, region, window, and connected-device recording modes
- Separate microphone and desktop-audio tracks
- Lightweight floating recording dock and standalone teleprompter
- Automatic zoom generation from clicks and interaction clusters
- Editable zoom, text, shape, and mask clips on a multi-track timeline
- Cursor themes, click effects, motion smoothing, and motion blur
- Canvas backgrounds, padding, crop, aspect ratios, rounded corners, and shadow
- Presets, undo/redo, trim/cut controls, and FFmpeg-based MP4 export
- Signed in-app updates from GitHub Releases

## Requirements

- Windows 10 or Windows 11
- WebView2 Runtime (normally included with supported Windows versions)
- Node.js 20 or newer and npm for development
- Stable Rust toolchain with the MSVC target
- FFmpeg and FFprobe available on `PATH` for export and media inspection

## Development

```powershell
npm ci
npm run tauri dev
```

Useful validation commands:

```powershell
npm run build
npx tsc --noEmit --noUnusedLocals --noUnusedParameters
cd src-tauri
cargo clippy --all-targets --all-features -- -D warnings
```

## Build a Windows installer

```powershell
npm run tauri build -- --bundles nsis
```

The installer is written to:

```text
src-tauri/target/release/bundle/nsis/
```

Updater artifacts require `TAURI_SIGNING_PRIVATE_KEY`. Release automation and
signing setup are documented in [RELEASING.md](RELEASING.md).

## Recording data layout

Snap keeps the output folder clean by placing support files inside the matching
recording folder:

```text
Videos/
├── snap_123456789.mp4
└── snap_123456789/
    ├── input.json
    ├── system_audio.wav
    └── mic_audio.wav
```

The editor resolves both this layout and older sidecar layouts. The setting
**Show audio and project files** only changes Windows visibility; it never
disables audio, cursor data, auto zoom, editing, or export.

## Architecture

| Area | Location | Responsibility |
| --- | --- | --- |
| Recorder | `src-tauri/src/capture/` | Windows capture and H.264 recording |
| Audio | `src-tauri/src/audio/` | WASAPI microphone and loopback capture |
| Input log | `src-tauri/src/input_hook/` | Timestamped pointer and keyboard events |
| Application commands | `src-tauri/src/lib.rs` | Tauri IPC, windows, settings, and project paths |
| Editor shell | `src/components/Editor/` | Preview, panels, timeline, presets, and transport |
| Auto zoom | `src/lib/autoZoom.ts` | Interaction clustering and camera keyframes |
| Canvas renderer | `src/lib/canvasDraw.ts` | Preview/export drawing primitives |
| Export | `src/lib/canvasExport.ts` | Frame compositing and FFmpeg encoding |

Recording stays native and lightweight. The React editor is used after capture,
where richer rendering and timeline interactions are appropriate.

## Release updates

The app checks the latest release at `YumiNoona/Snap`, validates signed update
artifacts, and can download and install an update without opening a browser.
Version numbers must match in `package.json`, `src-tauri/Cargo.toml`, and
`src-tauri/tauri.conf.json`.

## License

[MIT](LICENSE)
