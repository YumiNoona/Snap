# Editor improvements in the working tree

These changes extend the existing editor. They are not included in the published 9.0.1 release.

## Timeline and trimming

- Use the selection tool and drag footage clips to reorder them. Dragging from Source view switches to Sequence view automatically. A floating clip preview and a bright cyan insertion marker show the destination, including the beginning and end of the sequence. Ctrl-click selects several clips; dragging keeps the selection together. Locked footage cannot be moved.
- Clip settings opens a floating inspector with styled source In/Out, Slip, Roll, Duplicate, Combine, and move-to-start/end controls. The two-frame preview stays inside the inspector instead of consuming timeline track space. Escape or clicking outside closes the inspector.
- Combine merges adjacent contiguous source ranges. Adjacent cuts from different source ranges form a group, marked by a blue border; selecting a member selects the group for moving, duplication, or deletion.
- Right-click a track name for its custom menu. Track menus offer locking and targeted clear actions; locked tracks cannot be cleared. Caption and annotation clears affect only that track. Clearing zooms switches to manual zoom so suggestions do not immediately return. Audio menus offer locking, mute and removal for imported tracks.
- Left/Right steps one source frame; Shift+Left/Right steps ten. The transport also has frame-step buttons. Source frame rate comes from FFprobe, with a 30 fps fallback.
- Selected clips have source In/Out controls, Slip source, and Roll next cut controls. Rolling changes the outgoing and incoming source boundaries while preserving total sequence duration.
- Two-frame preview shows outgoing and incoming frames. Its video elements are released when the preview closes.
- Cuts, reordered clips, and repeated clips use separate identities in playback and export. Source-based zooms, annotations, captions, and action overlays repeat with duplicated footage. Editing a source-based overlay changes all occurrences of that source range.

The main footage sequence still uses one recording. Imported video remains a timed overlay, as in the existing editor; this is not a multiple-source footage-bin implementation.

## Camera movement and animation

- Regenerate produces a candidate that can be previewed against the current movement, applied, or discarded.
- Webcam Studio supports pose keys with position, scale, opacity, rotation and easing. Both preview and export use the shared animation resolver.
- Saved annotation animation and screen attachment remain supported by playback and export. The extra Objects & animation and Calmer auto-zoom panels were removed at the user's request.
- Existing Copy style/Paste style tools copy appearance without copying object grouping or animation.

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
