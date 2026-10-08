# Code cleanup and editor review — 8 October 2026

This review covers the desktop import graph, native capture/audio/export lifecycle, shared renderers, project persistence, panel integration and the independent website. Automated checks establish build and test behaviour; they do not establish gaming performance on specific hardware.

## Completed cleanup

- Removed the unreachable AudioTools, CaptionTools and ZoomRefinements panels and unused RecorderLauncher barrel.
- Folded the remaining webcam animation functionality into CameraAnimation and removed unused annotation grouping/alignment branches. Camera locks now govern webcam animation instead of the annotation lock.
- Replaced the broad Enhancements stylesheet with Animation.css, scoped webcam styles and the active tilt controls. Removed stale transcript, annotation-list and timeline hint rules, and consolidated the duplicate insertion marker styles.
- Removed the unused native `export_video` command, its request/config models and FFmpeg zoompan helpers. The active canvas/WebCodecs export pipeline, validation, audio processing and atomic output installation remain in use. Removed an unused incomplete-output guard left behind by the older pipeline.
- Removed unused audio-meter React state and panel props. Microphone analysis still drives speech ducking; other tracks no longer incur RMS sampling for a hidden meter.
- Added `npm run check:source`: it traverses static imports, re-exports and literal dynamic imports from the application and test entry points. It checks missing relative imports and unreachable desktop modules. It does not infer unused CSS selectors, public assets or native commands from string occurrences.
- Retained saved-project fields and render support for older animation, audio and preview settings. Those fields are compatibility data, not dead code. Wallpaper originals/previews/thumbnails, cursor packs and website screenshots are active assets.

## Bugs and light theme

- PCM level detection previously processed each VecDeque slice independently. A wrap between the two bytes of a PCM16 sample dropped/misaligned bytes. Detection now joins the boundary sample without an allocation; a regression test covers the wrapped queue.
- Timeline waveforms read their colour only at mount. They now redraw using the current theme colour when the theme changes, without reloading waveform data.
- Light-theme panels use white surfaces, lighter shadows and a neutral preview area. The playhead is blue, keyframes use darker gold with blue selection, and zoom/caption bars have readable pale fills. The aspect-ratio popup now follows the light theme instead of staying black.

## Suggested next improvements

1. **Independent clip effects.** Duplicated footage currently shares source-timed zooms, captions and tilt keys. Add an explicit choice to edit one clip occurrence or every occurrence, with clip-local overrides. This resolves a practical limitation of reordering and duplication without adding another permanent panel.
2. **Automatic preview adaptation.** Keep preview settings out of the UI. Detect sustained slow rendering and reduce only preview backing resolution/effect cost; preserve original media and full-quality export. Use hysteresis to avoid quality flicker and measure frame latency before choosing thresholds.
3. **Better keyframe interaction.** Multi-select, copy/paste, previous/next-key navigation and a compact easing curve editor in the selected-key inspector. Keep these contextual to selected keys.
4. **Trim-focused preview.** Show the outgoing/incoming frames while dragging an edge and offer keyboard nudge adjustments. Existing slip/roll operations and retained-range mapping provide the foundation.
5. **Recording health diagnostics.** Use existing hardware-encoder progress and bounded diagnostics to report stalls/dropped frames after recording. Benchmark games/Unreal Engine with and without Snap before claiming a performance improvement. Avoid continuous React activity during capture.
6. **Cache resilience.** The derivative worker is cancellable, but FFprobe requests can wait without a deadline. Add bounded probe/process deadlines and refresh metadata in cache keys where waveform data might change at the same path. Test corrupt/truncated and long recordings.

## Validation

- Frontend: 100 tests pass, including theme-change waveform redraw and existing timeline/keyframe/playback regression tests.
- Desktop source graph: 99 source/style files, 27 application/test/type entry points, no orphaned files or missing relative imports.
- Native library: 40 standard tests pass. The two opt-in FFmpeg audio-rendering tests also pass when explicitly included (42 unique native tests validated). The offline model installation test remains intentionally skipped.
- Rust Clippy: passes with warnings treated as errors.
- Independent website: ESLint and production build pass.
- Desktop TypeScript/Vite and native release build: verified before delivery.
- Headless browser style check confirms white panel surfaces, a lighter preview workspace, a blue playhead, darker keyframes and pale zoom bars. This was a CSS fixture check, not live Windows capture testing.

Live capture during gaming, device-disconnect tests and older-laptop CPU/GPU measurements remain hardware validation work. This cleanup does not change the screen capture encoder or add processing to its frame loop.
