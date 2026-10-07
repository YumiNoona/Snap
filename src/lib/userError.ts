/** Product text must never interpolate backend diagnostics or local paths. */
export function userError(error: unknown): string {
  const text = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (text.includes("save as") || text.includes("recovery failed")) return "Use Save As to preserve your project, then try again.";
  if (text.includes("active export") || text.includes("finish or cancel")) return "Finish or cancel the current export, then try again.";
  if (text.includes("finish the current recording")) return "Stop the current recording before opening the editor.";
  if (text.includes("disk space") || text.includes("no space")) return "Free some disk space or choose another drive, then try again.";
  if (text.includes("access denied") || text.includes("permission") || text.includes("scoped")) return "Select the file again using Open or Save As to grant access.";
  if (text.includes("hardware") || text.includes("gpu-resident") || text.includes("nvenc")) return "A working hardware encoder is required. Update your graphics driver and video engine in Settings.";
  if (text.includes("ffmpeg") && (text.includes("missing") || text.includes("unavailable") || text.includes("cannot provide"))) return "Update the video engine in Settings, then try again.";
  if (text.includes("already") || text.includes("stale session") || text.includes("still finishing")) return "Wait for the current operation to finish, then try again.";
  if (text.includes("microphone") || text.includes("audio devices") || text.includes("camera")) return "Check the selected devices and Windows permissions, then try again.";
  if (text.includes("missing") || text.includes("no longer exists") || text.includes("does not exist")) return "The source file is unavailable. Select its current location using Open.";
  if (text.includes("timed out") || text.includes("stopped responding") || text.includes("stalled")) return "The operation stopped responding. Try again with a local drive and a lower resolution.";
  if (text.includes("different filename") || text.includes("overwrite")) return "Choose a different filename to preserve your source recording.";
  if (text.includes("unsupported snap project version")) return "This project needs a newer version of Snap. Update Snap before opening it.";
  return "The operation could not finish. Check your settings and try again.";
}
