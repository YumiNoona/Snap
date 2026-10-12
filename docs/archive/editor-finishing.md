# Editor finishing — historical implementation notes

Archived v9.2-era design and validation notes. Some tools described below are
no longer exposed in Refine. See [the current editor guide](../editor.md).

Open a recording, then choose **Finish** in the editor toolbar. These tools run
only in editor mode. The original recording and input sidecar remain unchanged.
Project edits are undoable and persisted with the existing project format.

## Implemented tools

- **Smart cleanup:** select word-timed transcript ranges, review filler words,
  transcript pauses and exact repeated takes, or analyze quiet intervals in a
  selected audio track. Ripple-cut reviewed ranges while retaining source-linked
  effects and audio and rebasing independent sequence media. Long typing bursts
  are offered for 2× speed-up, never automatic deletion.
- **Voice polish:** local cached noise reduction, hum filtering, de-essing,
  compression, optional room-tail gate and loudness leveling. Preview A/B uses
  the same processed media that export uses; the source audio stays unchanged.
- **Format variants:** independent master, portrait, square and landscape
  snapshots of framing, camera placement, zooms, captions and clip effects.
  Optional safe-area guides are preview-only. Re-aim zooms at nearby repaired
  cursor clicks. Export initially follows the active aspect ratio.
- **Cursor repair:** source-timed hide ranges, replacement/hold paths, removed
  or inserted clicks, and first/last cursor alignment for loop seams. The same
  repairs feed preview, export and click sounds without rewriting event data.
- **Brand recipes:** reusable local appearance/framing, caption style,
  microphone polish, audio mix and export defaults. Apply categories selectively;
  source recordings, transcript words, timeline cuts and camera animation are not
  copied into a recipe.

## Deliberate limits

- Cleanup requires word timestamps for transcript proposals. Filler detection
  is conservative English matching; repeated takes are exact-text suggestions,
  not semantic or quality-ranked AI decisions. Transcript gaps are not evidence
  of silence. Always listen before cutting.
- Silence analysis uses a fixed -35 dB / 0.8 s threshold with breathing margins
  on one selected original audio track. Other tracks may still contain content.
- 2× speed-up is blocked when independent sequence media would need retiming.
- Room-tail reduction is a gate, not neural dereverberation. Test with actual
  speech before choosing settings; a synthetic filter test does not prove voice
  quality. FFmpeg is required for voice polish and quiet-audio analysis.
- Cursor repair affects the metadata overlay, not a cursor already baked into
  the video. It does not rewrite recorded keyboard/action overlay events. Hide
  ranges stay hidden until removed; later paths override earlier paths.
- Variant snapshots share footage edits. They are not separate timelines or a
  batch export queue. Safe areas are generic composition guides, not guarantees
  against every platform's changing interface overlays.
- Recipes live in this installation's local browser storage. They are not
  synchronized between devices; custom assets must remain available locally.

## Why these features

The selection prioritizes recurring editing work rather than more decorative
effects. Current primary product sources checked on 2026-10-11:

- [Tella Auto Cut](https://www.tella.com/auto-cut) offers reviewable silence,
  filler and repeated-phrase cleanup. Snap's review-first workflow avoids
  treating every pause as a mistake.
- [Descript features](https://www.descript.com/features) includes text-based
  editing, retake cleanup and voice enhancement. Snap implements useful local
  cleanup and audio processing without claiming semantic AI editing or voice
  reconstruction parity.
- [Screen Studio](https://screen.studio/) emphasizes cursor presentation,
  horizontal/vertical output and audio enhancement. Independent format styling
  and non-destructive cursor corrections address those finishing tasks.
- [FFmpeg filter documentation](https://ffmpeg.org/ffmpeg-filters.html) supports
  the local audio processing chain; no cloud upload or model download is added.

## Validation and remaining manual checks

Automated verification: 157 frontend tests, 45 Rust unit tests, two real-FFmpeg
finishing checks, three real-FFmpeg edited-audio/export checks, production build,
source graph and strict Rust Clippy. Regression tests cover project persistence,
ripple edits, source-coordinate cursor repairs, format sizes and loop seams.

Browser UI inspection covered the finishing dialog and format panel. Full native
end-to-end interaction remains unverified: automation stopped when user input
was detected. Before release, check actual speech A/B, cleanup/undo with mixed
audio and sequence overlays, save/reopen each format variant, and export a
portrait clip with repaired cursor metadata. Recording performance must also be
measured on representative gaming hardware; editor tests cannot establish it.
