# Auto Clips

Open **Auto Clips** on the editor's left toolbar. Choose the current recording, an imported video layer, a local file, or a video link.

The three steps are **Source**, **Highlights**, and **Layout**. Long sources initially select only the first ten minutes. Set Range in and Range out, or move the shared sliders, to choose another section. Fields accept timecodes such as `4:39.3`, or a number of seconds. For a 30–40 minute source, start with a 5–10 minute section; longer selections take longer depending on the PC, codec and model. The full video remains available and unchanged.

Auto Clips uses the editor's shared controls and glass surface in both themes. Headings scroll normally; the action footer stays available.

The defaults suggest two ten-second clips. Fast mode scans audio activity and video keyframes inside the selected range, then transcribes only a short list of likely moments. It does not transcribe the entire source. Detailed visual scanning and local AI ranking are optional slower steps under **Analysis & local tools**. Selection avoids overlapping copies of the same moment. A short or quiet source may have fewer useful suggestions.

## Local setup

- **Auto CC** uses Snap's managed offline Whisper installation. The dialog includes setup when needed.
- **Local AI ranking** is an optional verified download: Qwen3-4B Q4_K_M (about 2.5 GB) and a 25 MB CPU inference runtime. It ranks timestamped speech candidates locally. It requires Auto CC for transcript preparation. No paid API, account or inference service is used.
- Without the AI pack, candidates use measured audio reactions, screen changes and any available transcript. Silent gameplay uses activity suggestions; this version does not identify specific game events using a vision model.
- Facecam proposals use Windows' local face detector. A persistent face near an edge can produce a proposed crop. Check it carefully; it is not identity recognition. Draw a replacement rectangle on the source preview when necessary.

Downloading sources and installing dependencies uses the internet. Analysis and inference on downloaded sources run locally. The optional AI pack is not included in Snap's base installer.

## Review and create clips

Select a suggestion to preview it. Adjust its start and end, select alternatives, and choose 9:16, 1:1, 4:5 or 16:9. The preview can show one ratio while several ratios are selected for creation.

Landscape and output previews sit side by side. **Camera + gameplay** fills a stacked portrait frame. **Edit layout** lets you draw, move or resize the camera and gameplay regions on the source; the camera panel height is adjustable. Both panels crop uniformly without stretching. **Full portrait** fills a single view; **Fit whole video** preserves the entire picture with background space.

Auto CC uses short phrases, a transparent background, optional spoken-word highlights and an automatic position near the camera split. Captions use source timestamps and are clamped to each cut. Creating clips refreshes speech for the final edited ranges, reusing cached results where possible. Overlapping refreshed transcripts replace old versions rather than producing duplicate words. Clip transcription prefers the installed base model, then tiny/small, before heavier models. Multiple uncached ranges share one Whisper model load.

**Create editable clips** saves a separate Snap project for every selected moment and ratio under the source's data directory in `auto-clips/<batch>/`. The original recording and original project remain available. Open a saved clip to edit captions and export through Snap's normal export controls. Export defaults use MP4, 30 fps and burned captions when present. Creation itself does not batch-render MP4 files.

Framing can also be adjusted after opening a clip through **Refine > Formats**, including its split crops. Source frames remain unmodified.

Opening a generated clip saves the current project first. **Original timeline** returns to that project, and **Open timeline** switches between it and the generated clips without repeating analysis. Changes save before switching; if saving fails, the editor stays on the current project. Each timeline's playhead is retained during this editor session. Opening an unrelated project starts a new workspace.

## Ratio changes

The timeline ratio menu now includes:

- **Fit whole video:** keeps the source/crop proportions and displays unused canvas space using the selected background.
- **Fill and crop:** crops the source to the output shape using uniform scaling.

Neither mode stretches video. Preview and export share the framing helper. Equal padding also preserves proportions at the original aspect ratio. Captions are placed relative to the output canvas so they can use vertical safe space without being compressed into a letterboxed video.

Padding scales with the canvas from a 1920-pixel design width. Switching preview quality or export resolution therefore keeps the same visible spacing instead of squeezing footage into a fixed pixel margin.

## Resource behavior

The clipping interface loads with the editor. Analysis workers have cancellation, process ownership and output/time limits. Recording startup cancels local clipping work and waits for it to release its resources; startup will return a retry message if a worker cannot stop promptly. Analysis never continues intentionally through capture.

Activity results are cached by source/audio metadata, selected range and scan mode. Speech results additionally include language and model metadata. Temporary PCM audio is removed when the worker exits. Rendering only occurs during preview or normal export. Optional language-model ranking is CPU-based in this version and may still take significant time on slower PCs.

## Validation

Covered checks include exact-length candidate bounds, duplicate suppression, quiet-source handling, caption timing after trimming, independent format projects, embedded-audio duplication, cancellation with late native responses, uniform fit/crop scaling, original-ratio padding, shared split rendering, and format snapshots. Native media smoke checks exercise FFmpeg audio/motion measurements, WAV preparation and Windows face analysis on generated footage. Runtime download hash and CLI options were checked against the pinned official release.

Large-model ranking quality and game-specific highlight accuracy still require representative real-video evaluation. This is an editable suggestion workflow, not a guarantee that every source contains two compelling highlights.
