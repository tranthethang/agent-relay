import { existsSync } from "node:fs";
import { expect, test } from "vitest";
import { assertNoShellSnippet, preflightBody, requiredVersion, skillText } from "./skill-text.js";

const text = skillText("atry-distill");

test("distill exports the manifest and does not close the run", () => {
  expect(text).toContain(`requires-atry: ">=${requiredVersion()}"`);
  expect(text).toContain(preflightBody());
  expect(text).toContain("atry distill <run>");
  expect(text).toContain("90-distill/manifest.json");
  expect(text).toContain("Do not run `atry close`");
  expect(assertNoShellSnippet(text)).toBeUndefined();
});

test("v1 templates that no skill uses are gone", () => {
  const gone = [
    "../skills/atry-plan/references/plan-template.md",
    "../skills/atry-plan/references/meta-template.md",
    "../skills/atry-plan/references/history-log-template.md",
    "../skills/atry-implement/references/implement-plan-template.md",
    "../skills/atry-implement/references/implement-report-template.md",
    "../skills/atry-implement/references/task-status-template.md",
    "../skills/atry-self-review/references/review-report-template.md",
    "../skills/atry-self-review/references/review-walkthrough-template.md",
    "../skills/atry-cross-review/references/review-report-template.md",
    "../skills/atry-cross-review/references/review-walkthrough-template.md",
  ];
  for (const path of gone) {
    expect(existsSync(new URL(path, import.meta.url)), path).toBe(false);
  }
});
