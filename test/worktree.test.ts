import { execFile } from "node:child_process";
import { mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { RelayError } from "../src/core/error.js";
import { parseRunJson } from "../src/core/run.js";
import {
  addWorktree,
  cleanupWorktree,
  excludeRelay,
  gitCwd,
  linkRelay,
  listWorktrees,
  mainRoot,
  removeMergedWorktree,
  rollbackWorktree,
  runGitCwd,
  validateRunWorktree,
  worktreeCleanupText,
  worktreeSettings,
} from "../src/core/worktree.js";
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
      const runName = basename(runPath);
      const path = join(outside, "wt");
      await execFileAsync("git", ["worktree", "add", "-b", runName, path, "HEAD"], { cwd: dir });
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

test("validateRunWorktree validates existence, registration, detached status, and branch", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const runName = "20261017-1792208725-test-run";
    const runDir = join(dir, ".agent-relay", runName);
    await mkdir(runDir, { recursive: true });

    // 1. Missing path
    await expect(validateRunWorktree(runDir, { path: join(dir, "nonexistent"), branch: runName }))
      .rejects.toThrow("worktree not found");

    // 2. Unregistered path
    await withTempDir(async (outside) => {
      await expect(validateRunWorktree(runDir, { path: outside, branch: runName }))
        .rejects.toThrow("worktree is not registered with the repository");

      // 3. Detached HEAD worktree
      const detachedPath = join(outside, "detached");
      await execFileAsync("git", ["worktree", "add", "--detach", detachedPath, "HEAD"], {
        cwd: dir,
      });
      try {
        await expect(validateRunWorktree(runDir, { path: detachedPath, branch: runName }))
          .rejects.toThrow("worktree HEAD is detached");
      } finally {
        await execFileAsync("git", ["worktree", "remove", "--force", detachedPath], { cwd: dir });
      }

      // 4. Branch mismatch
      const wrongBranchPath = join(outside, "wrong-branch");
      await execFileAsync(
        "git",
        ["worktree", "add", "-b", "other-branch", wrongBranchPath, "HEAD"],
        {
          cwd: dir,
        },
      );
      try {
        await expect(validateRunWorktree(runDir, { path: wrongBranchPath, branch: runName }))
          .rejects.toThrow(`worktree branch is other-branch, expected ${runName}`);
      } finally {
        await execFileAsync("git", ["worktree", "remove", "--force", wrongBranchPath], {
          cwd: dir,
        });
        await execFileAsync("git", ["branch", "-D", "other-branch"], { cwd: dir });
      }

      // 5. Valid worktree matching run name
      const validPath = join(outside, "valid");
      await execFileAsync("git", ["worktree", "add", "-b", runName, validPath, "HEAD"], {
        cwd: dir,
      });
      try {
        await expect(validateRunWorktree(runDir, { path: validPath, branch: runName }))
          .resolves.toBeUndefined();
      } finally {
        await execFileAsync("git", ["worktree", "remove", "--force", validPath], { cwd: dir });
        await execFileAsync("git", ["branch", "-D", runName], { cwd: dir });
      }
    });
  });
});

test("linkRelay and excludeRelay handle link creation and excludes", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    await withTempDir(async (outside) => {
      const relayDir = join(dir, ".agent-relay");
      await mkdir(relayDir, { recursive: true });

      // Successful link
      await linkRelay(outside, relayDir);

      // Duplicate link throws
      await expect(linkRelay(outside, relayDir)).rejects.toThrow(".agent-relay already exists");

      // Exclude relay
      await excludeRelay(dir);
      const excludeText = await readFile(join(dir, ".git", "info", "exclude"), "utf8");
      expect(excludeText).toContain(".agent-relay\n");

      // Second call is idempotent
      await excludeRelay(dir);
      const excludeText2 = await readFile(join(dir, ".git", "info", "exclude"), "utf8");
      expect(excludeText2).toBe(excludeText);
    });
  });
});

test("worktreeSettings handles disabled policy and detached HEAD", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const head = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: dir })).stdout.trim();

    // Disabled policy
    expect(await worktreeSettings(dir, head)).toBeNull();

    // Enabled policy
    await writeFile(
      join(dir, ".agent-relay.json"),
      JSON.stringify({
        schema: 1,
        requireReviews: ["self"],
        smallChange: 20,
        worktree: { enabled: true, dir: "../wt" },
      }),
    );
    await execFileAsync("git", ["add", ".agent-relay.json"], { cwd: dir });
    await gitCommit(dir, "policy");
    const policyHead = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: dir })).stdout
      .trim();
    const settings = await worktreeSettings(dir, policyHead);
    expect(settings).toMatchObject({ dir: "../wt" });

    // Detached HEAD error
    await execFileAsync("git", ["checkout", "--detach"], { cwd: dir });
    try {
      await expect(worktreeSettings(dir, policyHead)).rejects.toThrow(
        "worktree needs a branch at HEAD",
      );
    } finally {
      await execFileAsync("git", ["checkout", "main"], { cwd: dir }).catch(() =>
        execFileAsync("git", ["checkout", "master"], { cwd: dir })
      );
    }
  });
});

test("addWorktree and rollbackWorktree handle lifecycle and conflict errors", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const head = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: dir })).stdout.trim();
    await withTempDir(async (outside) => {
      const relayDir = join(dir, ".agent-relay");
      await mkdir(relayDir, { recursive: true });
      const settings = { dir: outside, branch: "main" };

      // Success
      const record = await addWorktree(settings, { relayDir, name: "run-1", head });
      expect(record.path).toBe(join(outside, "run-1"));

      // Path already exists
      await expect(addWorktree(settings, { relayDir, name: "run-1", head }))
        .rejects.toThrow("worktree path already exists");

      // Branch already exists
      const existingBranchPath = join(outside, "run-diff-path");
      await expect(addWorktree({ dir: outside, branch: "main" }, { relayDir, name: "run-1", head }))
        .rejects.toThrow("worktree path already exists");

      // Rollback
      await rollbackWorktree(dir, record.path, "run-1");
      expect(await readFile(join(outside, "run-1")).catch(() => null)).toBeNull();
    });
  });
});

test("worktreeCleanupText and stale lock handling", async () => {
  expect(worktreeCleanupText({ schema: 1, path: "/p", worktree: { removed: true } })).toBe(
    "worktree: removed\n",
  );
  expect(
    worktreeCleanupText({ schema: 1, path: "/p", worktree: { removed: false, reason: "dirty" } }),
  ).toBe("worktree: kept (dirty)\n");

  await withTempDir(async (dir) => {
    const runDir = join(dir, "20261020-1792208725-test");
    const lockDir = join(runDir, "locks");
    await mkdir(lockDir, { recursive: true });
    const lockPath = join(lockDir, "run.lock");
    await writeFile(lockPath, "{\"pid\":999999}\n");
    // Set mtime to 40 seconds ago to test clearing stale lock
    const past = (Date.now() - 40_000) / 1000;
    await utimes(lockPath, past, past);

    // Setup dummy closed run with worktree
    await writeFile(
      join(runDir, "run.json"),
      JSON.stringify({
        schema: 1,
        id: "1792208725",
        ymd: "20261020",
        slug: "test",
        title: "Test",
        base: "abc",
        worktree: { path: join(dir, "missing-wt"), branch: "feat" },
        state: { lifecycle: "closed", stage: "cross-review", approved: true, tasks: [] },
      }),
    );
    await writeFile(
      join(runDir, "events.jsonl"),
      JSON.stringify({
        schema: 1,
        ts: "2026-10-20T00:00:00.000Z",
        stage: "run",
        action: "closed",
      }) + "\n",
    );

    const result = await cleanupWorktree(runDir);
    expect(result.worktree.removed).toBe(true);
  });
});
