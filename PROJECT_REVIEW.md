# Snap project review — 7 October 2026

## Implementation follow-up

The findings below describe the original review, before fixes. The desktop source has now been updated:

- Delivery packages use a bounded native command with exact output siblings, trim-aware transcripts/chapters, and honest partial-success reporting.
- Failed recovery preserves the original project and backup. Save generations protect newly opened projects; edits during saves stay dirty.
- Export has bounded byte backpressure, binary IPC, timeouts, and explicit frame/media cleanup. Progress and estimates account for playback speed.
- Recording lifecycle operations are serialized; slow initialization runs off the command thread. Failed starts clean up participants and encoder processes.
- Recording waits for the editor to save and unmount. Media decoders and shared caches are released before capture, and opening the editor during recording is prevented. Hardware recording defaults remain unchanged; no software fallback or silent quality reduction was added.
- Video layers have independent playback cursors and bounded inactive caches. Audio edits participate in undo/redo.
- The former split control was relabeled as a marker. The 8 October workspace update adds actual footage segments, Razor/split, edge trimming, snapping, ripple delete, joined sequence/source views, and matching preview/export timing. These newer timeline changes are not part of the published 9.0.1 release.
- User-facing errors hide raw paths/stacks; diagnostics are available through an explicit copy action. Export settings, focus handling, and GIF subtitle choices were corrected.

Verification: desktop tests pass (72 tests), TypeScript/Vite production build passes, and native library tests pass (39 passed, one intentionally ignored model-download test). npm audit reports zero vulnerabilities after a targeted dependency update. Website source was not changed; its lint/build passed during the original review.

The Windows UI check was stopped by the user's physical Escape key. Live visual checks, recording during games/Unreal Engine, device-disconnect testing, GPU/CPU profiling, and quality measurements on weak laptops remain unverified. These changes reduce known resource and lifecycle risks; they cannot guarantee zero lag on every device.

## Scope and verification

Reviewed native recording/session orchestration, input logging, audio handling, file access, project persistence/history, canvas preview/export, timeline controls, export UI, and the isolated website. No application source was changed.

- Desktop: 12 test files / 62 tests pass; TypeScript and Vite production build pass.
- Website: ESLint and Next.js production build pass.
- Native tests: could not run; Cargo is unavailable in this environment, including the usual user installation location.
- This is a source review with build verification, not a live Windows capture, GPU profiling, or visual UI audit. Findings below are code-confirmed behaviors or explicitly identified lifecycle risks. Passing builds do not verify hardware capture, microphone/device disconnect handling, or rendered layout.

## Findings, ordered by priority

### 1. High: Delivery package export always fails on the transcript writer

Evidence: `src/components/Editor/Editor.tsx:531–539`, `src-tauri/src/lib.rs:1048`, `src-tauri/src/export/mod.rs:533`.

The delivery-package option writes `<base>.transcript.txt` through `write_text_file_atomic`, but that command only permits snap/json/srt/vtt extensions. Consequently the package fails even in the default output folder. Outside the Snap library, the sibling transcript/chapter/thumbnail paths are also not granted by `open_export_sink`, which only grants staging and SRT/VTT siblings. The video has already been exported and marked Done before package generation throws; the catch then changes the result to Export failed.

Fix: add a dedicated bounded package-writing command that derives and authorizes the exact sibling paths from the selected output, supports transcript text, and reports video success separately from package failure. Commit the Done state after requested package work finishes. Restrict transcript/chapter entries to the exported trim range; current transcript construction includes captions outside that range, and chapter endpoints are not clamped to output duration.

### 2. High: Failed project recovery can overwrite the damaged project and its backup

Evidence: `src/components/Editor/hooks/useProjectPersistence.ts:136–145,152–170`, `src/lib/project.ts:108–121`.

If project loading/recovery fails, the hook creates a new project but retains the original active path. Once ready, autosave fingerprints differ and schedule a write there. This can replace the original project with a fresh state; atomic backup rotation can also replace the prior backup with the damaged primary. This is particularly harmful for unsupported newer project versions or two corrupted files.

Fix: preserve primary and backup, disable autosave to that path after recovery failure, and use a distinct recovered/new project path. Offer explicit recovery choices with diagnostics.

### 3. High: Export IPC writes have no bounded backlog

Evidence: `src/lib/canvasExport.ts:114–149,242–265`.

Encoded byte batches are captured in an arbitrarily growing chain of promises. Playback backpressure checks VideoEncoder queue size or JPEG queue depth, but never queued disk/IPC bytes. A fast encoder and slow destination can therefore keep encoding while retaining a large output in RAM. Converting each chunk into a JavaScript number array also increases allocation pressure. This is an unbounded-buffer risk, rather than proof of a permanent leak.

Fix: count outstanding write bytes and pause at a fixed budget; resume below a low watermark. Check write failures even while held for encoder backpressure, add a timeout for a queue that never drains, and use binary IPC where appropriate.

### 4. High: Recording startup and stop can overlap during device initialization

Evidence: `src-tauri/src/recording_session.rs:270–324,425–473`, `src/components/RecorderLauncher/RecorderLauncher.tsx:190–207`.

Startup publishes Recording before awaiting camera and audio initialization. The launcher reacts by enabling recording behavior, while stop accepts Recording and finalizes all current participants. No session-generation check or cancellation check guards the subsequent camera/audio startup awaits. A stop during initialization can finalize/remove the session while startup continues starting participants, or startup cleanup can race finalization.

This is a concurrency risk identified from the control flow; it needs a live test with slow devices to establish exact symptoms.

Fix: serialize lifecycle operations or use a shared cancellation token checked before/after each participant starts. Stop must cancel and await startup before finalizing. A separate video-live state can keep the clock truthful without declaring the whole session fully ready.

### 5. Medium: Deleted or inactive video layers retain media resources

Evidence: `src/lib/canvasDraw.ts:190–221`, `src/components/Editor/Preview/index.tsx:171,192–197,773–825`, `src/lib/exportCompositor.ts:436–473`.

Video layer caches have no eviction policy and are cleared only when the preview unmounts or export is destroyed. Deleting a layer does not pause/release its cached video. Only active layers reach `drawVideoLayer`, so a previously playing layer leaving its visible time range also receives no pause call and can continue decoding until its source ends. Importing/deleting many clips retains decoder/media resources for the editor session. Two layers with the same source also share one playback cursor despite potentially different start times.

Fix: track cache entries by layer identity; reconcile them with current layers, pause inactive media, and release deleted sources immediately. Use a bounded active decoder pool for large projects.

### 6. Medium: Split is only a visual marker

Evidence: `src/components/Editor/Timeline/index.tsx:627–635,887`, `src/components/Editor/Editor.tsx:1159`; repository-wide search of `cuts`.

The scissor action adds a number to `config.cuts` and draws a marker. No playback or export code consumes these cuts, and the marker does not create independently editable source clips. It should not be presented as a finished clip-splitting workflow. A split alone need not remove footage, but users need independently selectable/trimmed/deletable segments for the feature to be useful.

Fix: introduce source clips with in/out times and a composition-time mapping, shared by playback, overlays, captions, and export. Until that exists, label this action Add marker.

### 7. Medium: Audio edits are excluded from undo/redo

Evidence: `src/components/Editor/hooks/useEditorHistory.ts:4–8`, `src/components/Editor/Editor.tsx:239–270`.

History snapshots contain config, keyframes, and captions, but not the separate `audioTracks` state. Audio import/removal and track-level changes therefore cannot be restored by the same Undo command as other editor edits.

Fix: include audio track state in history, preferably through editor transactions. Group a slider drag or layer drag into one history entry; currently each committed state change may consume one of the 80 history slots.

### 8. Medium: Save completion can incorrectly report newer edits as saved

Evidence: `src/components/Editor/hooks/useProjectPersistence.ts:82–95`.

A save snapshots state, awaits disk writing, then unconditionally sets dirty=false and Saved. If an edit occurs while the write is pending, that newer state is not in the saved snapshot. Its autosave timer may still eventually save it, but the displayed status is temporarily false, and other logic consulting dirty can make the wrong decision.

Fix: compare the current fingerprint with the successfully saved fingerprint on completion and retain dirty status when they differ. Associate saves with a project generation so late operations cannot mutate another opened project's state.

### 9. Medium: Production errors expose technical details and accumulate DOM banners

Evidence: `src/main.tsx:29–51`, `src/App.tsx:44`, error interpolations in recorder/editor components.

Every uncaught error or rejected promise appends a permanent banner containing the message and stack. Repeated failures accumulate elements with no limit or dismissal. The text may include filesystem paths, IPC details, and backend diagnostics. Several ordinary error statuses also interpolate the full backend error into product UI. This is local diagnostic exposure; the review found no evidence that these banners transmit data externally.

Fix: show one friendly, dismissible error surface with retry/recovery actions. Keep bounded diagnostic details behind Copy details or a developer setting. Avoid suppressing the browser context menu for text fields unless replacement copy/paste functionality is provided.

### 10. Medium: Export progress is incorrect at non-default playback speeds

Evidence: `src/lib/canvasExport.ts:77–78,280–285`, `src/components/Editor/ExportModal.tsx:67–85`.

Total export milliseconds are divided by playbackRate, but elapsed progress milliseconds are measured in source time without that division. At 2× speed the render percentage reaches its cap halfway through; at 0.5× it stays near 50% until finalization. The export summary also reports source trim duration rather than the resulting speed-adjusted length.

Fix: derive duration, progress, estimated size, and the displayed length from one output-time calculation.

## Architecture observations

The editor is lazy-loaded and existing code deliberately bounds input queues, streams audio to disk, releases export resources, validates rendered frame counts, and uses atomic file saves. These are useful foundations.

The implementation nevertheless differs from AGENTS.md: capture uses FFmpeg-based hardware paths, CPU compatibility exists, and recording retains React/WebView dock/overlay surfaces plus a hidden editor project in memory. This is a documented architecture mismatch, not by itself a measured performance bug. Decide whether the requirement is zero WebView activity or an explicit background CPU/RAM/GPU budget, then align code and documentation. Hiding a window does not prove its resources are released.

Long-session editing also deserves measurement: native input loading allows up to five million JSON values / 512 MiB before shipping them over IPC, and frontend alignment creates another object array plus lookup arrays. Export loads the events again while the editor retains its own state. Consider indexed/chunked event access and compact arrays after profiling representative multi-hour sessions.

## Recommended overhauls and additions

1. Reliability first: fix package writing, recovery overwrite, bounded export writes, lifecycle cancellation, and decoder cleanup before adding more tools.
2. One timeline/composition model: real editable clips, ripple delete, gap removal, independent overlay timing, and a single source-to-output mapping for captions, cursor events, camera, and export.
3. One compositor: preview and export currently duplicate substantial render control flow. Share a renderScene(time, size, assets) function, with deterministic animation state and meaningful visual parity tests.
4. Recording health: display actual encoder, dropped-frame count, audio levels, selected devices, available disk space, and a clear warning when window-only audio falls back to whole-desktop audio.
5. Portable projects: consolidate used media, store relative paths, and provide a relink-missing-assets dialog so projects survive moving folders or PCs.
6. Privacy workflow: a pre-export checklist for sensitive regions, timed redaction presets, and optional notification suppression with state restored after recording.
7. Audio finishing: waveform-based silence removal, adjustable ducking under narration, track synchronization nudges, and clipping detection. Build these on transaction-based undo.
8. Export presets and queue: remember output choices, validate caption/container compatibility, offer crop/fit for vertical output, and support bounded/cancellable finalization jobs.
9. UI polish: friendly actionable errors, keyboard focus management in dialogs, accessible names on icon buttons, selectable error details, and accurate speed-aware estimates. A live layout pass at Windows 125/150/200% scaling is still needed to establish overflow/clipping findings.

## Targeted follow-up verification

- Stop immediately after the first video frame with a slow USB/Bluetooth device; verify no participant survives and the next recording starts cleanly.
- Export a delivery package inside and outside Snap's folder; verify all siblings and partial-failure reporting.
- Export to a throttled destination while monitoring memory; verify a fixed write-backlog ceiling.
- Import/play/delete many video layers; verify decoder activity and retained resources return to baseline.
- Load corrupt primary+backup and an unsupported future project version; verify neither is overwritten.
- Edit while a save is deliberately delayed; verify dirty status and project identity remain correct.
- Compare preview/output at 0.5×/1×/2×, including captions, cursor, video layers, and camera.
- Live Windows capture soak tests, GPU encoder coverage, unplug/replug tests, and a DPI/theme visual audit remain outstanding.
