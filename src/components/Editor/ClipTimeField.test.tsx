import { expect, it } from "vitest";
import { parseClipTime } from "./ClipTimeField";
it("accepts source timecodes and raw seconds without ambiguous invalid values", () => {
  expect(parseClipTime("4:39.3")).toBeCloseTo(279.3);
  expect(parseClipTime("1:02:03.5")).toBe(3723.5);
  expect(parseClipTime("279.3")).toBe(279.3);
  for (const invalid of ["", "1:75", "-1", "1::3", "text", "1:2:3:4"])
    expect(parseClipTime(invalid)).toBeNull();
});
