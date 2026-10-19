import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { RelayError } from "../src/core/error.js";
import { parseRunJson } from "../src/core/run.js";
import { gitCwd } from "../src/core/worktree.js";
import { gitCommit, reachReview, runCli, withTempDir, withTempGitRepo } from "./helper.js";

const execFileAsync = promisify(execFile);

const run = {
  schema: 1,
  id: "1792208725",
  ymd: "20261017",
  slug: "worktree-cwd",
  title: "Worktree",
  base: "abc",
  state: { lifecycle: "planned", stage: "plan", approved: false, tasks: [] },
};

async function seed(dir: string, value: unknown): Promise<string> {
  const runDir = join(dir, "20261017-1792208725-worktree-cwd");
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "run.json"), `${JSON.stringify(value)}\n`);
  return runDir;
}

test("gitCwd returns the run folder without a worktree record", async () => {
  await withTempDir(async (dir) => {
    const runDir = await seed(dir, run);
    expect(await gitCwd(runDir)).toBe(runDir);
  });
});

test("gitCwd returns the worktree path when the record exists", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "wt");
    await mkdir(path);
    const runDir = await seed(dir, { ...run, worktree: { path, branch: "main" } });
    expect(await gitCwd(runDir)).toBe(path);
  });
});

test("gitCwd reports not_found when the worktree path is gone", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "gone");
    const runDir = await seed(dir, { ...run, worktree: { path, branch: "main" } });
    const error = await gitCwd(runDir).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RelayError);
    expect(error).toMatchObject({ code: "not_found", fieldPath: "run.json:worktree.path" });
  });
});

test("run.json rejects an unknown key in worktree", () => {
  expect(() => parseRunJson({ ...run, worktree: { path: "/x", branch: "main", extra: 1 } }))
    .toThrow();
});

test("stage done implement measures the tree in the worktree", async () => {
  await withTempGitRepo(async (dir) => {
    await withTempDir(async (outside) => {
      await gitCommit(dir);
      const created = await runCli([
        "run",
        "new",
        "--slug",
        "worktree-measure",
        "--title",
        "Measure",
        "--json",
      ], dir);
      const runPath = (JSON.parse(created.stdout) as { path: string }).path;
      const path = join(outside, "wt");
      await execFileAsync("git", ["worktree", "add", "-b", "wt", path, "HEAD"], { cwd: dir });
      try {
        const runJson = join(runPath, "run.json");
        const value = JSON.parse(await readFile(runJson, "utf8")) as Record<string, unknown>;
        await writeFile(
          runJson,
          `${JSON.stringify({ ...value, worktree: { path, branch: "main" } })}\n`,
        );
        await writeFile(join(dir, "main-only.txt"), "main\n");
        await reachReview(runPath, dir);
        const events = (await readFile(join(runPath, "events.jsonl"), "utf8"))
          .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
        const done = events.find((event) =>
          event.stage === "implement" && event.action === "completed"
        );
        expect(done?.size).toEqual({ files: 0, added: 0, deleted: 0 });
        expect(done?.extra).toBeUndefined();
        const kept = JSON.parse(await readFile(runJson, "utf8")) as Record<string, unknown>;
        expect(kept.worktree).toEqual({ path, branch: "main" });
      } finally {
        await execFileAsync("git", ["worktree", "remove", "--force", path], { cwd: dir });
        await rm(path, { recursive: true, force: true });
      }
    });
  });
});
