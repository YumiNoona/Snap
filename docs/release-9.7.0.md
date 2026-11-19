# Snap 9.7.0

- Rebuilt Auto Clips as a spaced, scrollable three-step workflow with one progress view, elapsed time and cancellation.
- Long videos start with a ten-minute selection. Range controls and guidance recommend processing a 5–10 minute section of a 30–40 minute source.
- Fast scanning decodes keyframes, keeps analysis within the chosen range, and captions only shortlisted moments. Detailed scanning and local language-model ranking are optional.
- Offline captions prefer lighter installed models, batch multiple ranges in one model load, and cache each range. Final cuts refresh captions without duplicate transcript versions.
- Short caption phrases support timed word highlights and split-aware placement. Typography and outlines scale consistently between preview and export.
- Landscape and portrait previews share framing with normal exports. Streaming layouts fill camera and gameplay panels; drag, resize or keyboard-adjust source crop boxes. Fit mode preserves the full picture.
- Link imports retain the managed downloader setup, live progress, independent timeline layers and cached filmstrip previews from 9.6.

Validation: TypeScript, source graph, frontend and native unit suites; generated-media scan checks; real multilingual base-model Whisper processing of two speech files in one invocation; browser review using a clearly labeled development fixture. These checks do not establish game-specific highlight accuracy or guarantee a fixed processing time.

On the generated 720p fixture, scanning a selected 20 seconds took 0.67 seconds in fast mode and 0.88 seconds in detailed mode. Two 11-second spoken samples were transcribed in 2.54 seconds with one model load on this PC. Real source results vary by codec, hardware and model. These are component measurements, not whole-video speed promises.

The local standalone executable is unsigned. GitHub Actions builds the Windows installers and updater signatures after the release tag is pushed. Updater signatures are separate from Windows Authenticode signing.
