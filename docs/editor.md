# Editor tools and Refine

Snap opens the heavier editor after recording. Recording itself remains native;
the preview, media processing and export do not run during capture.

## Color & Film

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

All tool drawers use consistent outer spacing and scroll without visible
scrollbar chrome. Removing helper text does not remove processing controls or
important error/status feedback.
