import { describe, expect, it } from "vitest";
import { defaultExportPath, recordingExportDirectory } from "./exportPaths";

describe("export paths", () => {
  it("places Windows recording exports in a dedicated folder", () => {
    const source = String.raw`C:\Users\me\Videos\Snap\snap_123.mp4`;
    const directory = recordingExportDirectory(source);
    expect(directory).toBe(String.raw`C:\Users\me\Videos\Snap\Exports`);
    expect(defaultExportPath(source, directory, "1080p", "mp4")).toBe(String.raw`C:\Users\me\Videos\Snap\Exports\snap_123_1080p.mp4`);
  });

  it("keeps imported POSIX paths portable", () => {
    const source = "/videos/demo.webm";
    expect(defaultExportPath(source, "/videos/Exports", "edited", "gif")).toBe("/videos/Exports/demo_edited.gif");
  });
});
