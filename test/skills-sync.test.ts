import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

const repo = new URL("..", import.meta.url);
const script = ["--experimental-strip-types", "scripts/maint/sync-references.ts"];

function runSync(args: string[], cwd: URL | string) {
  return spawnSync(process.execPath, [...script, ...args], {
    cwd,
    encoding: "utf8",
  });
}

test("sync:check passes on a clean tree", () => {
  const run = runSync(["--check"], repo);
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
  expect(
    readFileSync(new URL("../scripts/maint/sync-references.ts", import.meta.url), "utf8"),
  ).not.toContain("review-walkthrough-template.md");
});

test("sync:check fails after one edit to a bundle copy", () => {
  const root = mkdtempSync(join(tmpdir(), "sync-check-"));
  try {
    cpSync(new URL("../docs/conventions", import.meta.url), join(root, "docs/conventions"), {
      recursive: true,
    });
    cpSync(new URL("../docs/partials", import.meta.url), join(root, "docs/partials"), {
      recursive: true,
    });
    cpSync(
      new URL("../docs/file-conventions.md", import.meta.url),
      join(root, "docs/file-conventions.md"),
    );
    cpSync(new URL("../skills", import.meta.url), join(root, "skills"), { recursive: true });
    const copy = join(root, "skills/atry-plan/references/writing.md");
    writeFileSync(copy, `${readFileSync(copy, "utf8")}drift\n`);
    const run = runSync(["--check", "--root", root], repo);
    expect(run.status, `${run.stdout}\n${run.stderr}`).not.toBe(0);
    expect(run.stderr).toContain("Drift:");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
