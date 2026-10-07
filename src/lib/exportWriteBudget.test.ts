import { expect, it } from "vitest";
import { ExportWriteBudget } from "./exportWriteBudget";

it("bounds a slow destination and resumes only after queued writes drain", () => {
  const budget = new ExportWriteBudget(8, 2, 32);
  for (let i = 0; i < 32; i++) expect(budget.reserve(1)).toBe(true);
  expect(budget.reserve(1)).toBe(false);
  expect(budget.bytes).toBe(32);
  expect(budget.shouldPause).toBe(true);
  budget.release(29);
  expect(budget.canResume).toBe(false);
  budget.release(1);
  expect(budget.canResume).toBe(true);
  expect(budget.reserve(NaN)).toBe(false);
  expect(budget.reserve(-1)).toBe(false);
});
