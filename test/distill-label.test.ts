import { expect, test } from "vitest";
import { distillKinds, labelPath } from "../src/core/distill-label.js";

test.each([
  ["events.jsonl", { kind: "events" }],
  ["run.json", { kind: "run-cache" }],
  ["10-plan/overview.md", { kind: "plan-overview", stage: "plan" }],
  ["10-plan/tasks.input.json", { kind: "plan-tasks-input", stage: "plan" }],
  ["10-plan/index.json", { kind: "plan-index", stage: "plan" }],
  ["10-plan/T3.md", { kind: "plan-task", stage: "plan", task: "T3" }],
  ["20-implement/T2.md", { kind: "implement-report", stage: "implement", task: "T2" }],
  ["30-self-review/01.md", { kind: "review-notes", stage: "self-review" }],
  ["30-self-review/01.json", { kind: "review-result", stage: "self-review" }],
  ["30-self-review/01.test.log", { kind: "test-log", stage: "self-review" }],
  ["40-cross-review/02.md", { kind: "review-notes", stage: "cross-review" }],
  ["40-cross-review/02.json", { kind: "review-result", stage: "cross-review" }],
  ["40-cross-review/02.test.log", { kind: "test-log", stage: "cross-review" }],
  ["extra.txt", { kind: "other" }],
])("labelPath %s", (path, label) => {
  expect(labelPath(path)).toEqual(label);
});

test("labelPath handles task ids and unmatched shapes", () => {
  expect(labelPath("10-plan/T10.md")).toEqual({ kind: "plan-task", stage: "plan", task: "T10" });
  for (
    const path of [
      "10-plan/T0.md",
      "10-plan/notes.md",
      "20-implement/notes.md",
      "30-self-review/notes.md",
      "30-self-review/1.md",
      "30-self-review/sub/01.md",
      "90-distill/manifest.json",
      "50-other/T1.md",
      "T1.md",
      "",
    ]
  ) {
    expect(labelPath(path)).toEqual({ kind: "other" });
  }
});

test("every kind is listed once", () => {
  expect(new Set(distillKinds).size).toBe(distillKinds.length);
});
