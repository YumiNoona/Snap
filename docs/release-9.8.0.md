# Snap 9.8.0

- The recording lane no longer draws trailing empty sequence padding as a Gap clip. Interior gaps remain visible and editable; added video layers keep their own timing.
- Auto Clips drops the short-source readiness banner, uses subdued switches, places trim/caption controls alongside the previews, and shows suggested moments in a horizontal tray below.
- Drag directly inside the output preview to reposition the picture, including the camera and gameplay panels separately. Arrow keys offer finer control. Each suggested moment keeps its own framing; generated projects store the same crop rectangles used by preview and export.
- Natural endings are enabled initially. Clip edges favour complete phrases, word boundaries and nearby pauses with a small lead-in/out. Footage remains continuous inside each clip. Tiny audio edge ramps reduce clicks. Suggestions still require review; local ranking does not guarantee exciting content or perfect cuts.
- Prepared speech is reused when the final trim remains within the transcribed range. Only newly exposed footage needs another caption pass.
- Auto Clips uses scissors in both navigation locations; Refine uses adjustment sliders.

## Three Windows editions

| EXE | Workspace |
| --- | --- |
| `Snap_9.8.0_x64.exe` | Recorder and editor, with the existing recorder-to-editor workflow |
| `Snap_Recorder_9.8.0_x64.exe` | Recorder, dock and media library; does not package the editor UI or open it after recording |
| `Snap_Editor_9.8.0_x64.exe` | Opens the media library directly; editing, link import, Auto Clips and export; no recorder interface or capture startup |

The editions share native media/runtime libraries. Recorder and Editor have separate application identities/settings and cannot accidentally install a full-Snap update. Their updates are downloaded manually from the release page. Keep all three standalone EXEs in the same folder to let Recorder's media library hand a recording to the separate Editor. Recordings remain in the shared Videos/Snap folder.

With the MSVC C++ workload and Windows SDK available, build all three using:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Build-Snap-Editions.ps1
```

Outputs and SHA-256 files are under `release-artifacts/v9.8.0`. The standard full-Snap installer/updater remains signed by GitHub Actions. Actions also rebuilds and uploads the three standalone editions from the release commit.

The prepared local release can be published from a terminal that has access to your GitHub CLI login:

```cmd
D:\AI\Snap\scripts\Publish-Snap-9.8.0.cmd
```

The publisher uses the GitHub CLI credential helper, pushes atomically, waits for the release workflow, and verifies all editions before reporting success.
