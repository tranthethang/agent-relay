import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("sync-references matches the partials and the conduct file", () => {
  const run = spawnSync("bash", ["scripts/maint/sync-references.sh", "--check"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  expect(run.status, run.stderr).toBe(0);

  const writing = readFileSync(new URL("../docs/partials/writing.md", import.meta.url), "utf8");
  const conduct = readFileSync(
    new URL("../skills/atry-self-review/references/reviewer-conduct.md", import.meta.url),
    "utf8",
  );
  const skills = [
    "atry-brainstorm",
    "atry-plan",
    "atry-implement",
    "atry-self-review",
    "atry-cross-review",
  ];
  for (const skill of skills) {
    expect(
      readFileSync(new URL(`../skills/${skill}/references/writing.md`, import.meta.url), "utf8"),
    ).toBe(writing);
  }
  expect(
    readFileSync(
      new URL("../skills/atry-cross-review/references/reviewer-conduct.md", import.meta.url),
      "utf8",
    ),
  ).toBe(conduct);
  expect(readFileSync(new URL("../scripts/maint/sync-references.sh", import.meta.url), "utf8")).not
    .toContain(
      "review-walkthrough-template.md",
    );
});
