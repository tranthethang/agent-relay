import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { skillNames } from "./skill-text.js";

const repo = new URL("..", import.meta.url);
const script = ["--experimental-strip-types", "scripts/maint/sync-references.ts"];

function runSync(args: string[], cwd: URL | string) {
  return spawnSync(process.execPath, [...script, ...args], {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
}

test("sync:check passes on a clean tree", () => {
  const run = runSync(["--check"], repo);
  expect(run.status, run.stderr).toBe(0);

  const writing = readFileSync(
    new URL("../specs/80-skills-integration/00-skill-bridge/writing.md", import.meta.url),
    "utf8",
  );
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
    readFileSync(
      new URL("../skills/atry-cross-review/references/review-checklist.md", import.meta.url),
      "utf8",
    ),
  ).toBe(
    readFileSync(
      new URL("../skills/atry-self-review/references/review-checklist.md", import.meta.url),
      "utf8",
    ),
  );
  expect(
    readFileSync(new URL("../scripts/maint/sync-references.ts", import.meta.url), "utf8"),
  ).not.toContain("review-walkthrough-template.md");
});

test("every bundle carries the file conventions, dev note, and implement parallel part", () => {
  const conventions = readFileSync(
    new URL("../specs/70-storage-and-git/00-directory-conventions/core.md", import.meta.url),
    "utf8",
  );
  const parallel = readFileSync(
    new URL("../specs/70-storage-and-git/00-directory-conventions/parallel.md", import.meta.url),
    "utf8",
  );
  for (const name of skillNames) {
    const skill = readFileSync(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf8");
    expect(skill, name).toContain(
      "Read `references/file-conventions.md` before you edit a run file.",
    );
    expect(skill, name).toContain("ATRY_DEV=1");
    expect(skill, name).toContain("--allow-dev");
    const bundle = readFileSync(
      new URL(`../skills/${name}/references/file-conventions.md`, import.meta.url),
      "utf8",
    );
    expect(bundle, name).toContain(conventions.trim());
  }
  const implementBundle = readFileSync(
    new URL("../skills/atry-implement/references/file-conventions.md", import.meta.url),
    "utf8",
  );
  expect(implementBundle).toContain(parallel.trim());
  expect(implementBundle).toContain("## Parallel claim");
  expect(implementBundle).toContain("Run `git status` in the task worktree");
  const brainstormBundle = readFileSync(
    new URL("../skills/atry-brainstorm/references/file-conventions.md", import.meta.url),
    "utf8",
  );
  expect(brainstormBundle).not.toContain("## Parallel claim");
});

test("sync:check fails after one edit to a bundle copy", () => {
  const root = mkdtempSync(join(tmpdir(), "sync-check-"));
  try {
    cpSync(
      new URL("../specs/70-storage-and-git/00-directory-conventions", import.meta.url),
      join(root, "specs/70-storage-and-git/00-directory-conventions"),
      { recursive: true },
    );
    cpSync(
      new URL("../specs/80-skills-integration/00-skill-bridge", import.meta.url),
      join(root, "specs/80-skills-integration/00-skill-bridge"),
      { recursive: true },
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

test("sync:check fails when the review checklist copies differ", () => {
  const root = mkdtempSync(join(tmpdir(), "sync-checklist-"));
  try {
    cpSync(
      new URL("../specs/70-storage-and-git/00-directory-conventions", import.meta.url),
      join(root, "specs/70-storage-and-git/00-directory-conventions"),
      { recursive: true },
    );
    cpSync(
      new URL("../specs/80-skills-integration/00-skill-bridge", import.meta.url),
      join(root, "specs/80-skills-integration/00-skill-bridge"),
      { recursive: true },
    );
    cpSync(new URL("../skills", import.meta.url), join(root, "skills"), { recursive: true });
    const copy = join(root, "skills/atry-cross-review/references/review-checklist.md");
    writeFileSync(copy, `${readFileSync(copy, "utf8")}drift\n`);
    const run = runSync(["--check", "--root", root], repo);
    expect(run.status, `${run.stdout}\n${run.stderr}`).not.toBe(0);
    expect(run.stderr).toContain(`Drift: ${copy}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the review checklist has seven one-line items", () => {
  const checklist = readFileSync(
    new URL("../skills/atry-self-review/references/review-checklist.md", import.meta.url),
    "utf8",
  );
  const items = checklist.split("\n").filter((line) => /^\d+\. /.test(line));
  expect(items.map((line) => line.split(".")[0])).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
  for (const line of checklist.split("\n")) {
    if (line === "" || line.startsWith("#") || /^\d+\. /.test(line)) continue;
    if (line.startsWith("Shared checklist")) continue;
    expect(line, "only a Why line may follow an item").toMatch(/^ {3}Why: /);
  }
});

test("parseArgs rejects unknown args and empty root", () => {
  const badArg = runSync(["--unknown"], repo);
  expect(badArg.status).not.toBe(0);
  expect(badArg.stderr).toContain("Error: unknown argument: --unknown");

  const missingRoot = runSync(["--root"], repo);
  expect(missingRoot.status).not.toBe(0);
  expect(missingRoot.stderr).toContain("Error: --root requires a directory argument");

  const flagAsRoot = runSync(["--root", "--check"], repo);
  expect(flagAsRoot.status).not.toBe(0);
  expect(flagAsRoot.stderr).toContain("Error: --root requires a directory argument");
});

test("sync removes orphan scripts directory and write mode syncs bundles", () => {
  const root = mkdtempSync(join(tmpdir(), "sync-write-"));
  try {
    cpSync(
      new URL("../specs/70-storage-and-git/00-directory-conventions", import.meta.url),
      join(root, "specs/70-storage-and-git/00-directory-conventions"),
      { recursive: true },
    );
    cpSync(
      new URL("../specs/80-skills-integration/00-skill-bridge", import.meta.url),
      join(root, "specs/80-skills-integration/00-skill-bridge"),
      { recursive: true },
    );
    cpSync(new URL("../skills", import.meta.url), join(root, "skills"), { recursive: true });

    const orphanDir = join(root, "skills/atry-plan/scripts");
    mkdirSync(orphanDir, { recursive: true });
    writeFileSync(join(orphanDir, "dummy.sh"), "#!/bin/sh\n");

    const checkRun = runSync(["--check", "--root", root], repo);
    expect(checkRun.status).not.toBe(0);
    expect(checkRun.stderr).toContain("Orphan:");

    const writeRun = runSync(["--root", root], repo);
    expect(writeRun.status).toBe(0);
    expect(existsSync(orphanDir)).toBe(false);

    const recheckRun = runSync(["--check", "--root", root], repo);
    expect(recheckRun.status).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sync handles AGENT_RELAY_SYNC_ROOT, unknown skill directory, and bad preflight", () => {
  const root = mkdtempSync(join(tmpdir(), "sync-edge-"));
  try {
    cpSync(
      new URL("../specs/70-storage-and-git/00-directory-conventions", import.meta.url),
      join(root, "specs/70-storage-and-git/00-directory-conventions"),
      { recursive: true },
    );
    cpSync(
      new URL("../specs/80-skills-integration/00-skill-bridge", import.meta.url),
      join(root, "specs/80-skills-integration/00-skill-bridge"),
      { recursive: true },
    );
    cpSync(new URL("../skills", import.meta.url), join(root, "skills"), { recursive: true });

    const unknownSkill = join(root, "skills/unknown-skill");
    mkdirSync(unknownSkill, { recursive: true });
    writeFileSync(join(unknownSkill, "SKILL.md"), "no markers\n");

    const runUnknown = spawnSync(process.execPath, [...script, "--check"], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, AGENT_RELAY_SYNC_ROOT: root },
    });
    expect(runUnknown.status).not.toBe(0);
    expect(runUnknown.stderr).toContain(
      "Error: no conventions manifest entry for skill 'unknown-skill'",
    );

    rmSync(unknownSkill, { recursive: true, force: true });

    const skillMd = join(root, "skills/atry-plan/SKILL.md");
    writeFileSync(skillMd, "Corrupted without markers\n");

    const runBadPreflight = runSync(["--check", "--root", root], repo);
    expect(runBadPreflight.status).not.toBe(0);
    expect(runBadPreflight.stderr).toContain("Missing <!-- BEGIN PREFLIGHT -->");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sync reports missing bundle files and a blank preflight", () => {
  const root = mkdtempSync(join(tmpdir(), "sync-gaps-"));
  try {
    cpSync(
      new URL("../specs/70-storage-and-git/00-directory-conventions", import.meta.url),
      join(root, "specs/70-storage-and-git/00-directory-conventions"),
      { recursive: true },
    );
    cpSync(
      new URL("../specs/80-skills-integration/00-skill-bridge", import.meta.url),
      join(root, "specs/80-skills-integration/00-skill-bridge"),
      { recursive: true },
    );
    cpSync(new URL("../skills", import.meta.url), join(root, "skills"), { recursive: true });
    writeFileSync(join(root, "skills", "notes.txt"), "skip\n");

    const conventions = join(root, "skills/atry-plan/references/file-conventions.md");
    writeFileSync(conventions, "drift\n");
    const drifted = runSync(["--check", "--root", root], repo);
    expect(drifted.status).not.toBe(0);
    expect(drifted.stderr).toContain("differs from generated conventions");

    rmSync(conventions);
    const missingCopy = runSync(["--check", "--root", root], repo);
    expect(missingCopy.stderr).toContain(`Missing: ${conventions}`);

    rmSync(join(root, "skills/atry-plan/SKILL.md"));
    const missingSkill = runSync(["--check", "--root", root], repo);
    expect(missingSkill.stderr).toContain("Missing:");

    const conduct = join(root, "skills/atry-cross-review/references/reviewer-conduct.md");
    rmSync(conduct);
    const missingConduct = runSync(["--check", "--root", root], repo);
    expect(missingConduct.stderr).toContain(`Missing: ${conduct}`);

    writeFileSync(
      join(root, "specs/80-skills-integration/00-skill-bridge/preflight.md"),
      "\n\n",
    );
    const blank = runSync(["--check", "--root", root], repo);
    expect(blank.status).not.toBe(0);

    writeFileSync(
      join(root, "specs/80-skills-integration/00-skill-bridge/preflight.md"),
      "one line",
    );
    const skillMd = join(root, "skills/atry-implement/SKILL.md");
    const source = readFileSync(skillMd, "utf8").replace(/\n$/, "");
    writeFileSync(skillMd, source);
    const writeRun = runSync(["--root", root], repo);
    expect(writeRun.status).toBe(0);

    rmSync(join(root, "skills"), { recursive: true, force: true });
    const noSkills = runSync(["--root", root], repo);
    expect(noSkills.stderr).toContain("Error: no skills/*/ directories");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sync errors on missing convention parts, writing, preflight, or empty skills", () => {
  const root = mkdtempSync(join(tmpdir(), "sync-missing-"));
  try {
    // Missing convDir entirely
    const runNoConv = runSync(["--root", root], repo);
    expect(runNoConv.status).not.toBe(0);
    expect(runNoConv.stderr).toContain("not found");

    // Create partial convDir
    const convDir = join(root, "specs/70-storage-and-git/00-directory-conventions");
    mkdirSync(convDir, { recursive: true });
    const runMissingPart = runSync(["--root", root], repo);
    expect(runMissingPart.status).not.toBe(0);
    expect(runMissingPart.stderr).toContain("missing convention part");

    // Copy full conventions
    cpSync(
      new URL("../specs/70-storage-and-git/00-directory-conventions", import.meta.url),
      convDir,
      { recursive: true },
    );

    // Empty skills dir
    mkdirSync(join(root, "skills"), { recursive: true });
    const runNoSkills = runSync(["--root", root], repo);
    expect(runNoSkills.status).not.toBe(0);
    expect(runNoSkills.stderr).toContain("Error: no skills/*/ directories");

    // Copy skills
    cpSync(new URL("../skills", import.meta.url), join(root, "skills"), { recursive: true });

    // Missing writing.md
    const runNoWriting = runSync(["--root", root], repo);
    expect(runNoWriting.status).not.toBe(0);
    expect(runNoWriting.stderr).toContain("writing.md not found");

    // Add writing.md
    mkdirSync(join(root, "specs/80-skills-integration/00-skill-bridge"), { recursive: true });
    writeFileSync(
      join(root, "specs/80-skills-integration/00-skill-bridge/writing.md"),
      "writing source\n",
    );

    // Missing preflight.md
    const runNoPreflight = runSync(["--root", root], repo);
    expect(runNoPreflight.status).not.toBe(0);
    expect(runNoPreflight.stderr).toContain("preflight.md not found");

    // Add preflight.md
    writeFileSync(
      join(root, "specs/80-skills-integration/00-skill-bridge/preflight.md"),
      "preflight source\n",
    );
    writeFileSync(
      join(root, "specs/80-skills-integration/00-skill-bridge/loop.md"),
      "loop source\n",
    );

    // Check review template drift
    const crossConduct = join(
      root,
      "skills/atry-cross-review/references/reviewer-conduct.md",
    );
    writeFileSync(crossConduct, "different conduct\n");
    const runConductDrift = runSync(["--check", "--root", root], repo);
    expect(runConductDrift.status).not.toBe(0);
    expect(runConductDrift.stderr).toContain("differs from");

    // Preflight out of sync in --check mode
    const runPreflightCheck = runSync(["--check", "--root", root], repo);
    expect(runPreflightCheck.status).not.toBe(0);
    expect(runPreflightCheck.stderr).toContain("preflight block differs from sync source");

    // Write mode should sync preflight and review templates
    const runWrite = runSync(["--root", root], repo);
    expect(runWrite.status).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function copyRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  cpSync(
    new URL("../specs/70-storage-and-git/00-directory-conventions", import.meta.url),
    join(root, "specs/70-storage-and-git/00-directory-conventions"),
    { recursive: true },
  );
  cpSync(
    new URL("../specs/80-skills-integration/00-skill-bridge", import.meta.url),
    join(root, "specs/80-skills-integration/00-skill-bridge"),
    { recursive: true },
  );
  cpSync(new URL("../skills", import.meta.url), join(root, "skills"), { recursive: true });
  return root;
}

test("sync writes the loop block into a skill with markers and checks drift", () => {
  const root = copyRoot("sync-loop-");
  try {
    const loop = join(root, "specs/80-skills-integration/00-skill-bridge/loop.md");
    const body = readFileSync(loop, "utf8");
    const skillMd = join(root, "skills/atry-implement/SKILL.md");
    const source = readFileSync(skillMd, "utf8");
    const withMarkers = source.includes("<!-- BEGIN LOOP -->")
      ? source.replace(/(<!-- BEGIN LOOP -->)[\s\S]*(<!-- END LOOP -->)/, "$1\nold\n$2")
      : `${source}\n<!-- BEGIN LOOP -->\nold\n<!-- END LOOP -->\n`;
    writeFileSync(skillMd, withMarkers);

    const stale = runSync(["--check", "--root", root], repo);
    expect(stale.status).not.toBe(0);
    expect(stale.stderr).toContain("loop block differs from sync source");

    const written = runSync(["--root", root], repo);
    expect(written.status, written.stderr).toBe(0);
    expect(written.stdout).toContain(`synced loop into ${skillMd}`);
    const synced = readFileSync(skillMd, "utf8");
    expect(synced).toContain(`<!-- BEGIN LOOP -->\n\n${body.trimEnd()}\n\n<!-- END LOOP -->`);
    expect(runSync(["--check", "--root", root], repo).status).toBe(0);

    writeFileSync(loop, `${body}9. Extra step.\n`);
    const drift = runSync(["--check", "--root", root], repo);
    expect(drift.status).not.toBe(0);
    expect(drift.stderr).toContain("loop block differs from sync source");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sync skips a skill without loop markers and rejects one marker", () => {
  const root = copyRoot("sync-loop-edge-");
  try {
    const loop = join(root, "specs/80-skills-integration/00-skill-bridge/loop.md");
    const skillMd = join(root, "skills/atry-self-review/SKILL.md");
    const source = readFileSync(skillMd, "utf8")
      .replace(/<!-- BEGIN LOOP -->[\s\S]*<!-- END LOOP -->/, "")
      .replace("<!-- BEGIN LOOP -->", "")
      .replace("<!-- END LOOP -->", "");
    for (const name of ["atry-implement", "atry-cross-review"]) {
      const other = join(root, `skills/${name}/SKILL.md`);
      writeFileSync(
        other,
        readFileSync(other, "utf8").replace(/<!-- BEGIN LOOP -->[\s\S]*<!-- END LOOP -->/, ""),
      );
    }
    rmSync(loop);
    writeFileSync(skillMd, source);
    const skipped = runSync(["--check", "--root", root], repo);
    expect(skipped.status, skipped.stderr).toBe(0);

    writeFileSync(skillMd, `${source}\n<!-- BEGIN LOOP -->\n`);
    const half = runSync(["--check", "--root", root], repo);
    expect(half.status).not.toBe(0);
    expect(half.stderr).toContain("Missing <!-- BEGIN LOOP --> / <!-- END LOOP -->");

    writeFileSync(skillMd, `${source}\n<!-- END LOOP -->\n`);
    expect(runSync(["--check", "--root", root], repo).stderr).toContain(
      "Missing <!-- BEGIN LOOP --> / <!-- END LOOP -->",
    );

    writeFileSync(skillMd, `${source}\n<!-- BEGIN LOOP -->\n<!-- END LOOP -->\n`);
    const noSource = runSync(["--check", "--root", root], repo);
    expect(noSource.status).not.toBe(0);
    expect(noSource.stderr).toContain("loop.md not found");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function floorRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "sync-floor-"));
  for (
    const dir of [
      "specs/70-storage-and-git/00-directory-conventions",
      "specs/80-skills-integration/00-skill-bridge",
      "skills",
      "evals",
      ".github/actions/smoke",
    ]
  ) {
    cpSync(new URL(`../${dir}`, import.meta.url), join(root, dir), { recursive: true });
  }
  mkdirSync(join(root, "scripts/maint"), { recursive: true });
  cpSync(
    new URL("../scripts/maint/next-version.ts", import.meta.url),
    join(root, "scripts/maint/next-version.ts"),
  );
  return root;
}

function setFloor(root: string, version: string): void {
  const file = join(root, "scripts/maint/next-version.ts");
  writeFileSync(
    file,
    readFileSync(file, "utf8").replace(
      /(skillMinimumVersion = ")[\d.]+(")/,
      `$1${version}$2`,
    ),
  );
}

test("sync writes a new floor into skills, the smoke action, and scenarios", () => {
  const root = floorRoot();
  try {
    setFloor(root, "9.9.9");
    const check = runSync(["--check", "--root", root], repo);
    expect(check.status, check.stderr).toBe(1);
    const targets = [
      ...skillNames.map((name) => join(root, "skills", name, "SKILL.md")),
      join(root, ".github/actions/smoke/action.yml"),
      join(root, "evals/scenarios.json"),
    ];
    for (const file of targets) expect(check.stderr).toContain(`Drift: ${file}`);

    const write = runSync(["--root", root], repo);
    expect(write.status, write.stderr).toBe(0);
    for (const name of skillNames) {
      expect(readFileSync(join(root, "skills", name, "SKILL.md"), "utf8")).toContain(
        "requires-atry: \">=9.9.9\"",
      );
    }
    expect(readFileSync(join(root, ".github/actions/smoke/action.yml"), "utf8")).toContain(
      "atry preflight --requires \">=9.9.9\"",
    );
    const scenarios = readFileSync(join(root, "evals/scenarios.json"), "utf8");
    expect(scenarios).toContain("\"installed\": \"9.9.9\"");
    expect(scenarios).not.toContain("0.10.7");
    expect(runSync(["--check", "--root", root], repo).status).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sync reports a floor source without skillMinimumVersion", () => {
  const root = floorRoot();
  try {
    writeFileSync(join(root, "scripts/maint/next-version.ts"), "export const other = 1;\n");
    const run = runSync(["--check", "--root", root], repo);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("no skillMinimumVersion in");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
