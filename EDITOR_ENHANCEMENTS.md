# Editor improvements in the working tree

These changes extend the existing editor. They are not included in the published 9.0.1 release.

## Timeline and trimming

- Use the selection tool and drag footage clips to reorder them. Dragging from Source view switches to Sequence view automatically. A floating clip preview and a bright cyan insertion marker show the destination, including the beginning and end of the sequence. Ctrl-click selects several clips; dragging keeps the selection together. Locked footage cannot be moved.
- Clip settings opens a floating inspector with styled source In/Out, Duplicate, Combine, and move-to-start/end controls. The two-frame preview stays inside the inspector; during edge dragging it appears above the timeline and follows the outgoing/incoming boundary frames. Escape or clicking outside closes the inspector.
- Combine merges adjacent contiguous source ranges. Adjacent cuts from different source ranges form a group, marked by a blue border; selecting a member selects the group for moving, duplication, or deletion.
- Right-click a track name for its custom menu. Track menus offer locking and targeted clear actions; locked tracks cannot be cleared. Caption and annotation clears affect only that track. Clearing zooms switches to manual zoom so suggestions do not immediately return. Audio menus offer locking, mute and removal for imported tracks.
- Left/Right steps one source frame; Shift+Left/Right steps ten. The transport also has frame-step buttons. Source frame rate comes from FFprobe, with a 30 fps fallback.
- Selected clips have source In/Out controls. Drag either timeline edge to trim without rippling neighboring footage.
- In/Out, razor splits, edge trims, Slip and Roll use the detected source frame rate; clips can be one frame long.
- Two-frame preview shows outgoing and incoming frames. Its video elements are released when the preview closes.
- Cuts, reordered clips, and repeated clips use separate identities in playback and export. Source-based zooms, annotations, captions, and action overlays repeat with duplicated footage. Shared effects change all occurrences. Clip settings → Make independent creates separate zoom, caption and 3D tilt settings for that occurrence, including project saving, undo and export. Annotation and webcam animation remain shared.

The main footage sequence still uses one recording. Imported video remains a timed overlay, as in the existing editor; this is not a multiple-source footage-bin implementation.

## Camera movement and animation

- Regenerate produces a candidate that can be previewed against the current movement, applied, or discarded.
- Webcam Studio supports pose keys with position, scale, opacity, rotation and easing. Both preview and export use the shared animation resolver.
- Saved annotation animation and screen attachment remain supported by playback and export. The extra Objects & animation and Calmer auto-zoom panels were removed at the user's request.
- Existing Copy style/Paste style tools copy appearance without copying object grouping or animation.

- Ctrl-click animation diamonds to select several keys. Drag or Left/Right moves the selection together; Shift moves ten frames. Ctrl+C/Ctrl+V copies complete poses with relative spacing. The context menu includes copy/paste and previous/next keys. Keys snap to other keys and the playhead, obey track locks, and update as a single undoable edit.
- Shared custom dropdowns place themselves above the trigger when needed, support arrows/Home/End, and restore trigger focus on Escape. Focused controls do not trigger playback frame shortcuts.
- Recording health is available through Project health after recording: hardware encoders, encoded frame count, recoveries and observed five-second intervals without new frames. A quiet interval can represent static content, so it is not reported as dropped frames. Summaries use existing native progress checks and are written only after capture stops.
- Editor FFprobe requests time out after 15 seconds and cancel when recording starts or the editor closes. Proxy/thumbnail processes also have deadlines. Waveform cache keys include source file size and modification time.
- Automatic preview adaptation was intentionally omitted. Preview/export quality behavior is unchanged.

## Audio and captions

- Audio keeps the original quick mix, mute, volume and import controls. The added timing/automation panel was removed. Existing projects still retain their linking, fades, volume keys and ducking data.
- Playback and export continue applying ordered source segments and audio edits. Ducking uses microphone RMS in preview and FFmpeg side-chain compression in export; the responses are approximate rather than identical.
- Unused audio meter state no longer causes editor renders. Audio elements and contexts are released on unmount.
- Captions keep the original generation and per-caption editing controls. Transcript search, batch replacement and saved reusable-style panels were removed.
- Offline transcription requests measured token timestamps from Whisper's full JSON output. Changing a caption's full text clears stale word timing.

## Preview performance

- Thumbnail strips sample ten evenly spaced source times and are cached by source path, size, modification time and cache version.
- Cache derivatives are bounded to roughly 2 GiB / 32 previous files. Preparation stops when recording starts or when the editor cancels its work.
- Old project preview resolution, proxy and reduced-effects settings remain supported internally; no extra performance panel is exposed.
- Canvas export always renders from original media.

The recorder's capture and encoding paths remain unchanged. Performance on a particular laptop or GPU still needs a hardware check.

## 3D screen tilt

The dedicated 3D Tilt tab includes optional X/Y perspective tilt, rotation, scale, perspective depth, presets and source-time keyframes with easing. Screen footage, cursor effects, rounded corners and shadow tilt together. Background, captions, webcam and floating annotations stay flat. Source-anchored annotations currently also remain flat; tilt is a screen presentation effect rather than a 3D annotation editing surface.

Adding a 3D tilt or webcam animation key creates a diamond in its timeline lane immediately. Object animation keys appear on the object's existing track. Click a diamond to seek, drag to retime on source-frame boundaries, or use its right-click menu to remove it. Source-based keys appear in every retained occurrence of duplicated footage. Panels reuse the editor's existing switches, custom dropdowns and action buttons.

Preview and canvas export share the perspective renderer. WebGL draws a perspective-correct plane; a canvas mesh is the fallback when WebGL is unavailable. No buffers or GPU context are created for disabled or neutral tilt. Active buffers are reused and released with the preview/export canvas. This adds no work to native capture.

Canvas retains its original styling and background controls. Preview performance settings are no longer exposed in the panel; existing project settings remain supported internally.

Custom gradient edits apply immediately; no Apply button is required. 3D Tilt uses the same shared sections and slider controls as Canvas Styling, with grouped presets and a separate Animation section. Reset pose preserves existing animation keys, resetting only the current pose.

## Gap-preserving assembly and audio clips — 9 October 2026

Normal Delete and edge/In/Out trims preserve the occupied interval as a gap. Shift+Delete and the explicit Ripple Delete menu close it. The inspector's Placement control makes ripple trimming/speed changes an explicit choice. Faster clips leave space; slower clips consume an adjacent gap or reject an overlap. Gaps render the project background and timed floating layers, with linked footage audio silent. Unlinked audio can continue across them.

Clip settings uses the existing themed custom dropdowns and compact paired fields: In/Out, Position/Speed, Effects, Placement and Transition. The duration readout and advanced Trim tools disclosure have been removed. A clip can be placed precisely into empty space. Dragging one clip in a sequence containing gaps preserves positions; Shift-drag inserts/reorders. Sequences without gaps retain drag-to-reorder, as do multi-selections. The floating preview distinguishes empty placement from occupied space. Locked tracks reject edits.

Each audio track has independently selectable segments. Select one and use Split at playhead, the razor, trim handles, Duplicate or Delete. Audio settings provides source bounds, position after unlinking, per-segment gain/fades and pitch preservation. Same-track overlaps are rejected; mix overlapping sounds on separate audio tracks. Linked segments follow footage splits, slips, duplication and speed; unlinked segments retain their sequence position. Duplicate audio searches for free space and can extend the sequence with a trailing gap. Frame-based edits, project saving and undo use the same persisted clip model.

Clip speed spans 0.25×–4× in addition to the existing global rate. Preview, exported video frame timestamps, source audio, explicit audio segments, click sounds, captions/word timing and delivery chapters account for both rates. FFmpeg pads/trims each sped-up segment to its exact planned length so tempo-filter rounding cannot shift later audio. Independent audio uses sample-based delays.

Footage transitions offer Fade, Dissolve, Slide, Push, Wipe and Zoom at adjacent cuts. They use a deterministic held outgoing boundary frame rather than overlapping live source handles; this preserves clip timing and avoids consuming hidden source frames. Scrubbing prepares that same boundary frame, and export awaits it before resuming. Layers have separate entry/exit transitions. Masks retain their masking behavior. Transition canvases and temporary boundary decoders are released after use; disabled transitions add no per-frame copying. A boundary that cannot decode leaves incoming preview footage visible; export reports the preparation error.

Validation includes 134 frontend tests, 43 native default tests and 3 additional FFmpeg integration tests. Browser checks cover dark/light inspectors, independent audio splitting, all six transition boundary pixels, exact outgoing-frame decoding and decoder cleanup. Native PCM checks verify silent gaps and retained sped-up audio; mocked frame export checks cover leading/internal/trailing gaps and differing clip speeds. These checks do not establish gaming performance on a particular laptop. Automatic preview adaptation remains excluded.

## Cut and transition UI polish — 9 October 2026

Audio/clip dropdowns now share the caption menu's spacing, translucent surface, selected row and keyboard focus treatment. Editor tools scroll without visible scrollbars; timeline horizontal/vertical scrollbars remain available. Audio actions use 42px targets and 20px scissors/copy/delete icons. Inspectors measure their actual available viewport space, keep the heading and actions reachable, and adapt when the timeline or window resizes.

The cut tool uses a custom scissors cursor and a frame-snapped guide with a time label on footage and audio. It automatically enters Sequence view; Escape or V restores selection. Trim handles and transition badges do not intercept razor clicks. Split at playhead accounts for the selected audio track's lock independently from footage locking and allows source-frame-sized cuts.

Transition presets, duration, direction and easing replace the single effect dropdown. An affordance at adjacent cuts adds Dissolve directly; the transition's end handle changes duration with drag or frame-based keyboard steps. Settings are saved and shared by preview/export. Movement distances are pixel-aligned to avoid transparent seams. A bounded cache prepares the current/next outgoing boundary ahead of cuts, preserving the current preview while a missing frame decodes.

Preview starts at its measured size, waits for project restoration, event data and decoded video, and paints before the browser presents resized canvases. Editor loading follows the stored theme; opening tools no longer run an entrance animation. Canvas export also waits for current video data before drawing. Browser validation covers dark/light controls, short-window inspector bounds, loading gates, scissors guides, 42px audio targets and 144 transition pixel checks across six effects/four directions. The latest frontend suite has 134 passing tests.


## Independent media rows
Library drag/drop creates a separate row for every image or video, with a frame-snapped insertion guide. Imported layers use sequence time, so repeating or speeding source footage does not repeat the overlay. Videos use probed duration and retain their source offset when trimmed or split; images start with five seconds. Imports extend the sequence with empty space when necessary. Audio drops use the drop position and permit separate instances of the same file. Existing source-timed annotations remain compatible. Adjoining gaps form one placement region, allowing trimmed clips to move freely without shifting neighbors.
