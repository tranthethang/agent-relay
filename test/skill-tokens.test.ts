import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { withTempDir } from "./helper.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const scriptPath = fileURLToPath(new URL("../scripts/maint/skill-tokens.ts", import.meta.url));

function runTokens(args: string[], cwd = repoRoot) {
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", scriptPath, ...args],
    {
      cwd,
      encoding: "utf8",
      env: process.env,
    },
  );
}

test("skill-tokens outputs table for repo skills", () => {
  const result = runTokens([]);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("| stage | references | chars | tokens |");
  expect(result.stdout).toContain("| brainstorm |");
  expect(result.stdout).toContain("| plan |");
  expect(result.stdout).toContain("| implement |");
  expect(result.stdout).toContain("| self-review |");
  expect(result.stdout).toContain("| cross-review |");
  expect(result.stdout).toContain("| distill |");
  expect(result.stdout).toContain("| total |");
});

test("skill-tokens accepts --root argument", () => {
  const result = runTokens(["--root", repoRoot]);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("| stage | references | chars | tokens |");
});

test("skill-tokens rejects missing --root argument", () => {
  const result = runTokens(["--root"]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Error: --root requires a directory argument");
});

test("skill-tokens rejects unknown argument", () => {
  const result = runTokens(["--invalid"]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Error: unknown argument: --invalid");
});

test("skill-tokens errors when skills directory is missing", async () => {
  await withTempDir(async (dir) => {
    const result = runTokens(["--root", dir]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error: skills directory is missing");
  });
});

test("skill-tokens errors when a referenced file is missing", async () => {
  await withTempDir(async (dir) => {
    const skillDir = join(dir, "skills", "atry-demo");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "read references/missing.md\n");
    const result = runTokens(["--root", dir]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error: demo names missing file references/missing.md");
  });
});

test("skill-tokens rejects an empty root and a flag used as a directory", () => {
  const empty = runTokens(["--root", ""]);
  expect(empty.status).toBe(1);
  expect(empty.stderr).toContain("Error: --root requires a directory argument");

  const flag = runTokens(["--root", "--nope"]);
  expect(flag.status).toBe(1);
  expect(flag.stderr).toContain("Error: --root requires a directory argument");
});

test("skill-tokens skips other names and sorts unknown stages", async () => {
  await withTempDir(async (dir) => {
    const skills = join(dir, "skills");
    mkdirSync(join(skills, "notes"), { recursive: true });
    writeFileSync(join(skills, "readme.txt"), "skip\n");
    const extra = join(skills, "atry-extra");
    const later = join(skills, "atry-later");
    mkdirSync(extra, { recursive: true });
    mkdirSync(join(later, "references"), { recursive: true });
    writeFileSync(join(extra, "SKILL.md"), "no references\n");
    writeFileSync(
      join(later, "SKILL.md"),
      "see references/a.md and references/a.md\n",
    );
    writeFileSync(join(later, "references", "a.md"), "body\n");
    const result = runTokens(["--root", dir]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("| extra | (none) |");
    expect(result.stdout).toContain("| later | references/a.md |");
    expect(result.stdout.indexOf("| extra |")).toBeLessThan(result.stdout.indexOf("| later |"));
  });
});

test("skill-tokens errors when reference escapes directory", async () => {
  await withTempDir(async (dir) => {
    const skillDir = join(dir, "skills", "atry-demo");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "read references/../escape.md\n");
    const result = runTokens(["--root", dir]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error: reference path escapes the skill directory");
  });
});
