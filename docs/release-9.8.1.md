# Snap 9.8.1

- Snap Editor opens an empty editor workspace with a preview area, timeline, project panel, video import, project opening and link import. It no longer starts in the recordings library. Imported videos use native handoff so cursor/audio sidecars and project saving receive the same access as recordings.
- AVC MP4/MOV exports decode sequentially with bounded file reads and frame queues. Unsupported containers, transformed footage and unsupported decoders retain precise media seeking. Cuts, repeats, gaps, speed changes and cancellation keep their timing.
- Hardware H.264 staging uses a direct MP4 mux when its output timestamps preserve presentation order. Reordered encoder output retains the conversion path. Encoder backpressure drains the queue instead of repeatedly flushing it; WebM and conversion fallbacks use faster encoding settings.
- The editions build script initializes the Microsoft x64 compiler and Windows SDK, including restoring cached Microsoft toolchain packages when Visual Studio registration is unavailable. It checks product identity, version, x64 Windows GUI format, frontend separation and distinct hashes for all three executables.

| Executable | Startup |
| --- | --- |
| `Snap_9.8.1_x64.exe` | Full Snap recorder and editor |
| `Snap_Recorder_9.8.1_x64.exe` | Lightweight recording interface |
| `Snap_Editor_9.8.1_x64.exe` | Editor workspace, ready to import media or open a project |

Keep Recorder and Editor in the same folder for recording handoff. Their application identities and settings remain separate from full Snap.

```powershell
npm run build:editions
```

Executables, individual SHA-256 checksums and `build-info.json` are written to `release-artifacts/v9.8.1`.
