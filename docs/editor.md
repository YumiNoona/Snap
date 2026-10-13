# Editor tools and Refine

Snap opens the heavier editor after recording. Recording itself remains native;
the preview, media processing and export do not run during capture.

## Opening the editor

The editor opens maximized for new recordings, imported media, existing projects
and tray reopening. Users can still restore the window while editing.

## Custom cursors

Choose **Add custom cursor**, select a static PNG, enter a name and save. Snap
copies it into `%LOCALAPPDATA%/com.ringale.snap/cursors/<name-id>/`, alongside a
small `cursor.json` containing the display name. Cursor images survive moving
or deleting the original download. PNGs are decoded before import and limited
to 512 × 512 pixels and 2 MB. Imported names must be unique within the custom
library. Horizontal/vertical tip controls align the image with recorded clicks.

## Masks and preview player

In addition to Spotlight, Blur and Magnifier, masks include **Mosaic** for block
pixelation, **Redaction** for an opaque rectangular cover, and **Color focus** to
desaturate the surrounding picture while retaining the selected area's color.
They use the shared preview/export renderer and retain timeline positioning.
Mask rendering, cursor following, selection handles and hit testing share the
same source-space pose. New masks pin to footage through crop and pan/zoom;
Rotation, including animated poses, transforms the real mask matte as well as
its selection outline. Rotated lenses sample the complete frame so corners do
not go blank; rotated redaction covers expand one pixel for safe edge coverage.
turn off **Pin to footage** for a fixed frame-space area. Camera focus is an
explicit choice, not an automatic relocation of the mask. The lens affects
only its own area. Feather, expansion and applicable inversion use real alpha
mattes; masks are restricted to the video frame rather than the background.
Each mask has its own timeline row. Splitting suppresses fades at the cut,
start trimming preserves animation poses, and stacked effects sample the prior
result. Sequence-timed masks can cover imported media in timeline gaps.
These are rectangle/ellipse effects with manual pose animation and cursor
following, not arbitrary Bezier paths or image-based object tracking.
Redaction intentionally ignores opacity and does not fade or feather. Review
its timing and coverage before sharing; Mosaic is not guaranteed anonymization.

The maximized preview uses a transparent glass player with elapsed/remaining time,
icon-only five-second skip controls and volume. CC toggles preview captions only
and is disabled without visible caption segments; it never changes export
caption settings. Drag the dock background/handle to reposition it, or focus
the handle and use arrow keys (Shift for bigger steps, Home to reset). It stays
inside the preview after resizing. Expansion/restoration animates where the
webview supports view transitions; reduced motion skips the animation.
Controls stay visible while paused or
focused, and hide only during inactive playback. Color & Film sits above Audio
in the tool rail.

## Media previews and input levels

Video library cards use bounded, cached FFmpeg posters, including containers
the webview cannot decode. Failed/missing files show a neutral retry state
instead of a broken image. Unsupported imported-video codecs are converted
on demand into full-resolution H.264 compatibility media shared by preview
and export; the original file and project reference are retained. This is a
CRF-18 derivative, not a lossless copy. Preparation is editor-only and cancellable.
Drag cards with a visual ghost to the timeline,
or onto the preview to insert at the playhead. The guide and committed drop
share clock conversion and frame snapping. Escape, pointer cancellation and
loss of focus cancel the drag.

Recorder setup's mic square responds to measured native microphone amplitude.
The meter saves no audio, has a two-second lease, and stops while recording or
while the launcher is hidden/unfocused. Muted, unavailable or disabled inputs
remain still. Reduced motion keeps the level response but removes ripples.

## Color & Film controls

All sections remain expanded. The panel starts with Film looks and intensity,
then exposure, contrast, saturation, warmth and vignette. Apply to, original
comparison, adjustment layers and Enable look follow the tone controls.
Custom LUTs and RGB curves remain available below them.

Grades can apply to the project, a selected clip or timed adjustment layers.
Layers support opacity, ordering and feathered rectangle/ellipse masks.
Original/graded comparison is preview-only; it is not burned into exports.
Imported 1D/3D `.cube` LUT tables and curve points are saved in the project.

## Refine

- **Voice:** per-track noise reduction strength, hum filtering, room-tail gating
  and loudness leveling. Original/Polished comparison uses cached processed
  audio; export uses enabled processing. Room-tail reduction is not neural
  dereverberation.
- **Layouts:** landscape, portrait and square framing, crop edges, safe-area
  guides and click-aware reframing. Safe guides are preview-only.
- **Presets:** save and apply local appearance, cursor/motion, layout/camera,
  caption style and audio settings selectively. Custom media must remain
  available; presets are not synchronized to other devices.

## Timeline and export

Video thumbnails, independent audio tracks, captions, zoom regions, layers and
animation keyframes share an editable timeline. Media can be dragged onto it;
linked video audio follows edits unless unlinked. Nested sequences support
reusable compositions, with recursive nesting rejected.

The graph editor supports animation timing and easing. Export composes exact
timestamps and offers optional optical-flow frame interpolation. This can help
slow motion or low-FPS footage, but takes longer and can distort moving text;
Original frames is the default.

After a video is successfully saved, Snap shows an optional donation screen
using the existing UPI QR code. Close it with **Not now**, the close icon,
Escape or the backdrop to return to the saved file's actions. Failed/cancelled
exports and cancelled save dialogs do not show it; each successful repeat export
does. A missing optional delivery package does not invalidate the saved video,
and its warning remains available after dismissing the donation screen.

All tool drawers use consistent outer spacing and scroll without visible
scrollbar chrome. Removing helper text does not remove processing controls or
important error/status feedback.
