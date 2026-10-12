# Editor improvements and next tools

Reviewed on 12 October 2026. These recommendations build on Snap's existing
zoom, tilt, captions, voice polish, layouts, presets and timeline editing.
Tools 2, 4, 5, 6 and 9 below are implemented in this update. The remaining tools are proposals.

## Implemented in this update

- Clear timeline marker lines, without bookmark icons; the white zoom badge
  behind the preview maximize control is removed.
- Clip settings, aspect ratio, tool drawers and nested menus use the same
  90% surface tint, 18px blur and 12px outer radius as export and Refine.
- The saved export status reads **Export Saved**. Opening a saved file is a
  separate action, so Windows player failures do not mark export as failed.
- Automatic capture keeps native screen pixels at 60 FPS with hardware
  encoding. Bitrate scales with resolution, within 12â€“50 Mbps. Explicit
  manual settings remain available for lower load and smaller recordings.
- Export decodes each output timestamp before composition, removing the
  dependence on real-time playback keeping up with rendering.
- Optional optical flow creates intermediate source frames before screen
  composition. Cursor graphics, captions and backgrounds stay sharp.
- Eight original color recipes, including Fuji inspired and Midnight,
  support project-wide grades and individual clip overrides, with intensity,
  exposure, contrast, saturation, warmth and vignette controls.

- The color tab owns all grades, embedded 1D/3D `.cube` LUTs and master/RGB curves. Clip settings remain focused on timing and transitions; FX badges identify affected footage.
- The original/graded wipe can be dragged in preview and reversed. It never appears in exports.
- Timed adjustment layers have stacking, opacity, bypass, rectangle/ellipse masks, inversion and feathering. Their timeline bars can be moved and trimmed.
- The graph editor covers zoom, tilt, camera and object animation, with frame snapping, custom Bezier handles, hold interpolation and grouped key editing.
- Image, video and music cards support selection and direct timeline dragging. Imported video sound follows moving and trimming its picture; splitting and duplicating retain the associated audio. Editing audio separately unlinks it.
- Adjacent footage can be nested, edited through breadcrumbs, reused from the media library or expanded back into clips. Linked instances propagate internal edits; loop checks prevent recursive definitions.
- Project schema 4 embeds LUT tables and saves reusable sequences, custom curves and adjustment layers. Versions 1–3 remain readable.

## Research and design choices

Adobe distinguishes frame sampling, blending and optical flow. Optical flow
estimates motion to synthesize intermediate frames; it is useful for slow
motion and frame-rate conversion. It cannot restore unreadable source text
or fix a playback device that cannot decode the chosen resolution.
[Adobe time interpolation](https://helpx.adobe.com/premiere/desktop/edit-projects/change-clip-speed/apply-time-interpolation-methods-to-adjust-clip-speed.html).

Snap uses FFmpeg motion-compensated interpolation with bidirectional motion
estimation, adaptive overlapping blocks and scene-change detection. Applying
this to source footage before composition avoids interpolating unrelated
timeline cuts or freshly rendered captions. It is optional because moving
text and complex game scenes can produce distortion, and processing takes
longer. The default remains original frames for screen tutorials.
[FFmpeg minterpolate](https://ffmpeg.org/ffmpeg-filters.html#minterpolate).

Premiere's creative looks combine a chosen look with an intensity control and
further corrections. Snap follows that interaction with its own lightweight
recipes; these are not Adobe LUTs or calibrated Fujifilm camera simulations.
[Adobe Lumetri looks](https://helpx.adobe.com/ca/premiere/desktop/correct-color/add-color-effects/apply-lumetri-looks.html).

## Ten useful additions, in recommended order

| Priority | Tool | Practical benefit |
|---|---|---|
| 1 | Batch export queue | Render saved layouts and delivery formats in one queue, with per-item progress, cancellation and retry. |
| 2 | Keyframe graph editor | Edit motion curves and velocity visually, beyond the existing easing presets. |
| 3 | Audio meters and peak limiter | Show track and master peaks, flag clipping and cap peaks without replacing voice polish. |
| 4 | LUT import and RGB curves | Load `.cube` looks and adjust shadows, midtones and highlights with finer control than preset filters. |
| 5 | A/B color comparison wipe | Compare original and graded footage side by side while tuning a look. |
| 6 | Adjustment layers | Apply one shared grade to a chosen range of clips, with masks and bypass. |
| 7 | Visual motion tracking | Attach callouts or blur masks to objects that move independently of cursor events. |
| 8 | Music beat detection | Generate editable beat markers and suggest cuts or zoom timing from a music track. |
| 9 | Nested sequences | Reuse a finished tutorial section or intro as one editable item while preserving its internal edits. |
| 10 | Named project checkpoints | Save named editing milestones and compare or restore one without losing subsequent work. |

The remaining priorities are export queues and audio meters: they shorten common workflows without making the recorder heavier.

## Improve existing features next

- **Automatic recording:** calibrate with real capture throughput and report
  frame drops. Encoder availability alone cannot predict GPU headroom during
  a demanding game. Preserve native resolution when text matters; offer a
  clearly labelled lower-load profile when sustained 60 FPS is not possible.
- **Export:** measure a short sample for more realistic estimates, show
  interpolation progress, process only retained source ranges and expose
  simple player-compatibility presets. Current optical flow prepares the
  whole source, so short edits of long recordings can take unnecessary time.
- **Color:** add scopes and color-management metadata before
  growing the preset list. Keep footage grades separate from captions and
  interface overlays so readability remains predictable.
- **Timeline:** improve keyboard navigation and discoverability of existing
  selection, locks and context menus; make frame snapping explicit at every
  zoom level. Prefer fewer clear actions over duplicate controls.
- **UI:** keep one glass material and spacing scale, and verify small screens,
  both themes, focus visibility and scrollable inspectors for every new tool.

## Validation

The update was checked with frontend and native unit suites, browser tests in
both themes, actual WebCodecs export decoded by FFmpeg, a real hardware
capture startup test and an actual 24-to-60 FPS optical-flow render. A moving
60 FPS fixture retained 120 distinct frames in a two-second export. These
checks do not replace testing demanding full-screen games on each GPU family.
