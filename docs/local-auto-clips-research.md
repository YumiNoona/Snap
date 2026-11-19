# Local Auto Clips for Snap

Research date: 19 November 2026. Status: research and proposed implementation; no clipping engine has been implemented or benchmarked in this work.

Implementation update: an initial editor workflow is now implemented. See [Auto Clips](auto-clips.md) for its current behavior, setup, validation and remaining evaluation. The sections below preserve the original research and proposed later stages.

## Recommendation

Build an editor-only Auto Clips tool that turns a supported video link or local video into reviewable short clips. Suggested initial settings: two clips, ten seconds each, 9:16, Auto CC enabled, automatic layout with manual correction. Also support 1:1, 4:5 and 16:9. Offer flexible duration separately so a setup and payoff can stay together.

Use a staged local pipeline: inexpensive audio/video measurements, offline transcript, candidate windows, a small local language model for ranking, facecam region detection, and shared preview/export composition. Evaluate an optional vision model for events that cannot be understood from speech. Do not describe the first version as universal game-event recognition or promise viral performance.

All inference can run on the user's PC with no paid API or account. Internet remains necessary to download linked media and install model packs. Processing an already downloaded file should work offline. Supported links depend on the existing downloader and source availability; an arbitrary social URL is not guaranteed to contain an accessible video.

## What comparable products publicly describe

These are vendor descriptions, not independently verified quality results or disclosures of their internal models.

| Product | Published behavior | Useful design lesson for Snap |
| --- | --- | --- |
| OpusClip ClipAnything | Combines visual, audio and sentiment cues; accepts natural language instructions; offers reframing and scene ranking [1] | Combine multiple signals and allow prompts such as "funniest reactions" or "best clutch". |
| OpusClip gaming layout | Places facecam in the top 30% and gameplay in the lower 70% of a vertical frame [2] | Offer an adjustable split template with independent source crops. |
| Powder | Describes game-specific event detection plus universal audio reaction signals, chat spikes and keyword search [3] | Separate generic highlight suggestions from game-specific understanding. Chat is an optional input when available. |

A loud sound, fast camera movement or detected face is evidence for a candidate, not proof that the moment is interesting. A relevance score should describe supporting signals and uncertainty rather than claim a probability of going viral.

## Existing Snap foundations inspected

| Existing code | Reusable behavior | Addition needed |
| --- | --- | --- |
| `src-tauri/src/editor_sources.rs`, `src/components/Editor/LinkImportDialog.tsx` | Link inspection/download, progress/cancellation, staged local sources | "Find highlights" after import, plus file selection from Uploads. |
| `src-tauri/src/transcription.rs`, `src-tauri/src/caption_install.rs` | Managed offline Whisper, multilingual models, measured word timing and audio-activity checks | Cache transcripts for analysis; job-scoped work files and cancellable analysis; optional refinement around selected clips. |
| `src/lib/editorFinishing.ts` | Format presets, caption positioning, independent layout snapshots | Clip-specific framing and derived sequences. Its existing cleanup rules identify pauses/fillers; they are not highlight detection. |
| `src/lib/types.ts` | Video layers with source offsets/speed, caption tracks, camera overlay, nested-sequence data | General rectangular source crops and multi-region composition for embedded facecam. |
| `src/lib/exportCompositor.ts`, `src/lib/canvasDraw.ts`, Preview | Shared drawing helpers and layered video rendering | One shared split-layout renderer used by preview and export. |

The current camera overlay uses a separate camera media path. A facecam already burned into a downloaded stream needs a crop of that same downloaded video. Current `VideoLayer` has cover/contain fitting but no explicit source rectangle, so this requires a composition change rather than just a new preset button.

## Suggested user flow

1. Open **Auto Clips** in the editor. Choose a link, an uploaded source or a recording. Download once through the existing link importer.
2. Choose clip count and duration: default **2 x 10 seconds**. Offer exact length and flexible length as explicit choices. Select Gaming, Talking, Reactions or Auto, with an optional instruction.
3. Choose output ratios and Auto CC style. Default to 9:16 with automatic layout. Keep each ratio's crop and caption placement independently editable.
4. Show actual progress stages: Preparing media, Transcribing, Finding moments, Framing, Ready. Include cancellation and reuse cached stages on retry.
5. Show preview cards with source timestamp, thumbnail, proposed title, duration, short selection reason and confidence. Recommend two distinct moments and keep alternatives available. If the source has weak candidates, say so rather than inventing excitement.
6. Let the user adjust clip boundaries, drag facecam/gameplay regions, move captions, select a different candidate and preview each ratio.
7. Open each result as its own editable clip sequence/project, with batch export available. Explicitly allow adding results on new layers to an existing project; preserve the source recording and parent edit.

Only create full-quality output after selection/export. Do not pre-render every alternative.

## Highlight selection

### Pass 1: prepare and measure

Probe duration, rotation, frame rate, timestamps and available audio. Normalize analysis timestamps against a source presentation-time origin. Retain audio/video offsets. For Snap recordings with separate microphone and desktop audio, use the mic for speech/reaction features and the intended mix for final export. Downloaded streams usually have mixed audio; voice isolation should be an optional later step.

Use mono 16 kHz audio for the existing transcription path. Compute short-window energy, relative peaks, pauses and changes in speech activity in native code. Compare against a rolling baseline so constant loud music does not dominate.

Use a bounded low-resolution video pass for coarse scene/motion features. Sparse approximately 1 fps samples can help find persistent faces and scene context. They are not enough for reliable frame-accurate cuts or brief game events; use a denser low-resolution pass or locally rescan candidate intervals for those tasks. FFmpeg provides relevant measurement/filter primitives [10]. PySceneDetect's adaptive content detector is a useful reference because fast motion can cause false scene changes [8]; it need not become a shipped Python dependency.

Transcribe speech using the user's installed Whisper model. Reuse valid transcript data instead of transcribing once for highlight analysis and again for Auto CC by default. Whisper's word timestamps are documented as experimental [4]; keep caption editing and timing checks available.

### Pass 2: form and rank candidates

Build candidate windows around reactions, semantic turns, pauses, and changes in visual/audio activity. Include context before a peak and the aftermath after it. Search possible ten-second windows around an event rather than starting the clip at the shout. For flexible mode, prefer complete phrases and completed events.

Use an optional Qwen3-4B quantized model through a managed llama.cpp worker to rank timestamped transcript windows and their measured features [5, 6]. Ask for candidate IDs, reasons, hook/payoff evidence and suggested titles. Use constrained JSON output and validate every result. Grammar constraints enforce structure, not factual accuracy. The worker must select valid provided IDs; it must not invent timestamps or game events it cannot observe.

Normalize and combine features by content mode. For talking videos, reward an understandable hook and a complete thought. For gaming, give more weight to event/reaction evidence and visual verification. Penalize silence, duplicate scenes, background-music peaks and incomplete endings. Apply overlap suppression and event grouping so the two results are not nearly identical slices of one reaction. Weights and thresholds require validation; there is no justified universal formula yet.

### Pass 3: optional visual verification

For weak-dialogue or silent gameplay, inspect multiple timestamped frames from shortlisted intervals using a local vision model. SmolVLM2-500M-Video-Instruct is an Apache-2.0 candidate for an inexpensive prototype; a larger model can be evaluated if it fails event comprehension [7]. llama.cpp documents multimodal support and model-specific projector files [6]. Pin a tested model/runtime pair.

A small model's availability does not establish that it can identify a clutch, kill, joke or sports play accurately. Validate temporal reasoning on representative footage. If it fails, present generic activity-based suggestions with lower confidence; add game-specific OCR/event detectors as separate later work. Optional chat spikes can be used only when actual timestamped chat is available, not assumed from a video URL.

## Facecam and layout

Use a lightweight face detector such as YuNet to propose faces in sampled frames. The OpenCV Zoo model directory is MIT licensed [9]. Evaluate a CPU ONNX worker first; GPU acceleration is optional and model/backend compatibility must be tested. Face detection alone cannot identify the streamer or recover a webcam panel boundary.

Cluster detections over time. A persistent face in a stable corner region, plus consistent surrounding panel boundaries, supports an embedded facecam proposal. Restrict temporal tracking to that region and reset at layout/scene changes. Gameplay characters and faces inside the main video must not automatically become facecams. Let the user confirm or draw the rectangle whenever confidence is low. Keep tracking positional; identity recognition is unnecessary.

When Snap has an original separate camera track, prefer that higher-quality source. For embedded facecam, render two independently cropped views from the same source frame: the camera panel and the gameplay/content region. Decode once per source/time where feasible. The camera crop must be muted; mix the original audio exactly once.

Offer these templates:

| Template | Behavior |
| --- | --- |
| Facecam + gameplay | Adjustable split, initially 30% camera above 70% content; independent crop/contain settings. |
| Full-frame subject | Smooth subject framing, with dead zones to prevent constant jitter. |
| Full gameplay with background fill | Contain the important gameplay area over a blurred/background fill when a vertical crop would remove action or HUD. |
| Manual | User-selected regions and positions; no automatic recentering. |

At 1080 x 1920, a 30/70 split gives a 1080 x 576 camera panel and a 1080 x 1344 content panel. Fitting an entire 16:9 gameplay image into that lower region creates unused space; filling it crops substantial width. Expose both choices and show the actual preview. Do not stretch the image. A tiny embedded facecam will remain soft when enlarged; automatic cropping cannot restore absent detail.

Keep caption safe margins adjustable per ratio. Avoid covering the face, the split boundary, essential HUD or expected platform controls. Platform overlays vary, so safe-area previews are guides rather than permanent exact guarantees.

## Captions, timing and edit model

Represent candidates in source milliseconds and retain provenance. Store source ID, source ranges, evidence, optional transcript references, crop keyframes, layout and output ratios. Keep derived clips editable rather than baking crops into source files.

For an uncut range at speed `r`, map source time `s` to clip time `(s - sourceStart) / r`. For multiple ranges, add preceding output durations. Clamp word timings at boundaries, preserve real pauses, and avoid speeding the audio twice. Handle imported-media offsets separately from global sequence time. When a cut crosses speech, regenerate grouping and optionally refine ASR using a small surrounding context window.

Render the same composition in Preview and export, including source rectangles, captions and crop smoothing. Facecam and gameplay branches must share the same source timestamp. Extend existing format snapshots so changing square framing does not overwrite vertical framing. Use H.264/AAC MP4 export presets with explicit dimensions and test the resulting file; an MP4 extension alone is insufficient validation.

## Keeping recording light and installation simple

- Load analysis UI and engines only in editor mode. Pause/cancel and release workers before recording starts. No frame analysis, local LLM or proxy creation during capture.
- Use an owned native child process for inference, with bounded CPU/GPU use, job IDs, cancellation and process-tree cleanup. Avoid requiring Python, Docker, an external Ollama installation or a constantly running service.
- Start with one heavy analysis stage at a time. Unload Whisper before loading a language/vision model on limited-memory PCs. Keep the editor responsive while analysis runs.
- Install packs in-app with pinned versions, verified downloads, visible sizes, retry/cancel and remove controls, following Snap's existing managed dependency installers.
- Offer a fast measurement-based mode, a local transcript-ranking pack, and an optional vision pack. Qwen3-4B Q4_K_M is about 2.5 GB of weights [5]; runtime memory is larger and depends on context/backend. Existing CC model downloads remain separate.
- Cache media measurements, transcript, candidate ranking and crop proposals independently using source fingerprint, model/runtime versions and parameters. Use unique per-job temp directories and a clear cache-size limit. Current adjacent transcription temp-file naming should be addressed before concurrent jobs.
- CPU execution should remain possible. A GPU improves some workloads but no processing-time claim is established here. Benchmark on real target PCs before displaying estimates.

## Delivery order and validation

1. **Local Auto Clips beta:** source selection, measured candidates plus transcript ranking, editable two-clip review, exact/flexible duration, captions, ratios, and a manual facecam rectangle with split composition. Managed language-model installation and cancellation are part of this milestone.
2. **Automatic framing:** persistent facecam proposals, scene-aware tracking, smooth crops, manual overrides and consistent preview/export.
3. **Visual highlights:** benchmark a vision pack for silent/gameplay footage, then add only verified game-specific detectors. Recorded VODs first; ongoing live streams need a separate bounded ingestion/buffering design.

Before release, test a representative set of at least 30 sources: commentary gaming, quiet gameplay, reaction videos, podcasts/tutorials, mixed Hindi/English, music, multiple faces, no facecam, moving facecam, and variable-frame-rate footage. Include sources with no strong highlight.

Evaluate reviewer acceptance of the top two suggestions, completeness of the setup/payoff, duplicate-event rate, caption word/timing accuracy, false facecam proposals, crop/HUD loss, preview/export agreement, audio sync, peak RAM/VRAM, total processing time, cancellation and offline operation. Compare measurement-only, transcript-ranking and vision-assisted modes on the same sources before making quality claims. Verify that all analysis workers release resources before capture begins. This research did not execute these benchmarks.

## Primary sources

1. [OpusClip ClipAnything](https://www.opus.pro/clipanything) — vendor's multimodal clipping and prompt descriptions.
2. [OpusClip gaming video editor](https://www.opus.pro/tools/gaming-video-editor) — published 30/70 facecam/gameplay layout.
3. [Powder game models](https://www.powder.gg/highlighting/game-models) — game-specific detection and universal reaction/chat/keyword options.
4. [whisper.cpp](https://github.com/ggml-org/whisper.cpp) — local transcription, memory table, quantization and experimental word timing.
5. [Qwen3-4B-GGUF official model card](https://huggingface.co/Qwen/Qwen3-4B-GGUF) — Apache-2.0 metadata, local runtime usage and quantized sizes.
6. [llama.cpp](https://github.com/ggml-org/llama.cpp), [grammar documentation](https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md), [multimodal documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/mtmd/README.md) — native local inference, constrained output and projector requirements.
7. [SmolVLM2-500M-Video-Instruct official model card](https://huggingface.co/HuggingFaceTB/SmolVLM2-500M-Video-Instruct) — image/video model, limitations and Apache-2.0 metadata.
8. [PySceneDetect detector documentation](https://www.scenedetect.com/docs/latest/api/detectors.html) — content and adaptive scene detectors.
9. [OpenCV Zoo YuNet](https://github.com/opencv/opencv_zoo/blob/main/models/face_detection_yunet/README.md), [model license](https://github.com/opencv/opencv_zoo/blob/main/models/face_detection_yunet/LICENSE) — face detector and MIT license.
10. [FFmpeg filters](https://ffmpeg.org/ffmpeg-filters.html) — media analysis and composition primitives.

Model and runtime choices above are implementation candidates, not a claim that integration is already complete. Pin and test concrete artifacts, keep required notices with redistributed components, and record each chosen artifact's license and hash in the installer manifest.
