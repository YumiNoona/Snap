import { expect, it } from "vitest";
import { userError } from "./userError";

it("never shows diagnostic paths or arbitrary backend text in product errors", () => {
  const error = new Error("Access denied: C:\\Users\\private\\video.mp4; secret backend details");
  expect(userError(error)).toMatch(/Select the file again/);
  expect(userError(error)).not.toMatch(/private|secret|\.mp4/);
  expect(userError("Unexpected opaque IPC failure")).not.toContain("IPC");
  expect(userError("Use Save As to preserve the original project")).toMatch(/Save As/);
});
