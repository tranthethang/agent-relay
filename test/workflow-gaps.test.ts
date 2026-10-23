import { execFile } from "node:child_process";
import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { rebuildRun } from "../src/core/cache.js";
import {
  assertClaimOwner,
  claimTask,
  listText,
  releaseClaimLock,
  releaseText,
  stealTask,
} from "../src/core/claim.js";
import {
  changedPaths,
  diffSize,
  gitHead,
  gitRoot,
  treeDiffSize,
  workTree,
} from "../src/core/git.js";
import { guardPath, guardText } from "../src/core/guard.js";
import { approvePreview } from "../src/core/lifecycle.js";
import {
  acquireLock,
  createStealGuard,
  isStale,
  readOwner,
  releaseLock,
} from "../src/core/lock.js";
import { withRunLock } from "../src/core/mutate.js";
import { indexFromTasks } from "../src/core/plan.js";
import { brainstormNewText, createBrainstorm, resolveBrainstorm } from "../src/core/scaffold.js";
import { ensurePlanReady, gitCommit, runCli, withTempDir, withTempGitRepo } from "./helper.js";
import { createRun, writeTasks } from "./plan-helper.js";

const execFileAsync = promisify(execFile);

const task = { title: "One", deps: [] as string[], files: ["src/one.ts"] };

test("indexFromTasks rejects too many tasks, a bad id, and a duplicate id", () => {
  const nine = Array.from({ length: 9 }, (_, index) => ({
    title: `Task ${index}`,
    deps: [],
    files: [],
  }));
  expect(() => indexFromTasks(nine)).toThrow(/more than 8 tasks/);
  expect(() => indexFromTasks([task], ["nope"])).toThrow(/invalid task id/);
  expect(() => indexFromTasks([task, { ...task, title: "Two" }], ["T1", "T1"])).toThrow(
    /duplicate task id/,
  );
});

test("release and list text include the optional fields", () => {
  expect(releaseText({
    schema: 1,
    path: "/run",
    task: "T1",
    session: "ada",
    action: "released",
    forced: false,
    reason: "pause",
  })).toContain("reason: pause");
  expect(listText({ schema: 1, path: "/run", tasks: [] })).toBe("tasks: none\n");
  expect(guardText({ schema: 1, allowed: false, task: null })).toBe("allowed: no\n");
  expect(brainstormNewText({
    schema: 1,
    path: "/notes",
    notes: "/notes/notes.md",
    open: "/notes/open.json",
  })).toBe("/notes\n");
});

test("cache rebuild names a missing file, invalid JSON, a bad schema, and a mismatched id", async () => {
  await withTempDir(async (root) => {
    const runDir = join(root, "20261017-1792208725-cache-gap");
    await mkdir(runDir, { recursive: true });
    await expect(rebuildRun(runDir)).rejects.toMatchObject({ fieldPath: "events.jsonl" });
    await writeFile(join(runDir, "events.jsonl"), "null\n");
    await expect(rebuildRun(runDir)).rejects.toMatchObject({
      fieldPath: "events.jsonl:lines[0]",
    });
    await writeFile(
      join(runDir, "events.jsonl"),
      `${
        JSON.stringify({
          schema: 1,
          ts: "2026-10-17T00:00:00.000Z",
          stage: "run",
          action: "created",
        })
      }\n`,
    );
    await expect(rebuildRun(runDir)).rejects.toMatchObject({ fieldPath: "run.json" });
    await writeFile(join(runDir, "run.json"), "{", "utf8");
    await expect(rebuildRun(runDir)).rejects.toMatchObject({ message: "invalid JSON" });
    await writeFile(join(runDir, "run.json"), "{}\n", "utf8");
    await expect(rebuildRun(runDir)).rejects.toMatchObject({
      fieldPath: expect.stringContaining("run.json"),
    });
    await mkdir(join(runDir, "nested"), { recursive: true });
    await writeFile(join(runDir, "events.jsonl"), "");
    await expect(rebuildRun(join(runDir, "nested"))).rejects.toThrow();
  });
});

test("lock helpers reject a bad id, a missing file, invalid JSON, and a second steal guard", async () => {
  await withTempDir(async (root) => {
    const run = join(root, "run");
    await mkdir(join(run, "locks"), { recursive: true });
    expect(() =>
      isStale({
        schema: 1,
        session: "ada",
        pid: 1,
        host: "local",
        ts: "2026-10-17T00:00:00.000Z",
      }, Number.NaN)
    ).toThrow(/ttl must be a non-negative number/);
    await expect(readOwner(run, "nope")).rejects.toThrow();
    await expect(readOwner(run, "T1")).rejects.toMatchObject({ message: "lock not found" });
    await writeFile(join(run, "locks", "T1.lock"), "{", "utf8");
    await expect(readOwner(run, "T1")).rejects.toMatchObject({ message: "invalid JSON" });
    await writeFile(join(run, "locks", "T1.lock"), "{}\n", "utf8");
    await expect(readOwner(run, "T1")).rejects.toThrow();
    await expect(acquireLock(run, "T2", "")).rejects.toMatchObject({ fieldPath: "session" });
    await acquireLock(run, "T2", "ada");
    await expect(releaseLock(run, "T2", "bob")).rejects.toMatchObject({
      message: "lock held by ada",
    });
    await createStealGuard(run, "T2", "ada");
    await expect(createStealGuard(run, "T2", "ada")).rejects.toMatchObject({
      message: expect.stringContaining("steal guard exists"),
    });
  });
});

test("a stale run lock is removed and the write proceeds", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "stale-lock");
    const lock = join(run, "locks", "run.lock");
    await mkdir(join(run, "locks"), { recursive: true });
    await writeFile(lock, "{}\n");
    const old = new Date(Date.now() - 31_000);
    await utimes(lock, old, old);
    await expect(withRunLock(run, async (loaded) => loaded.run.slug)).resolves.toBe("stale-lock");
  });
});

test("git measurement rejects a missing repo and counts binary and empty files", async () => {
  await withTempDir(async (dir) => {
    await expect(gitRoot(dir)).rejects.toMatchObject({ message: "git root not found" });
    await expect(gitHead(dir)).rejects.toThrow();
    await expect(workTree(dir)).rejects.toMatchObject({ message: "git index not found" });
  });
  await withTempGitRepo(async (dir) => {
    await expect(gitHead(dir)).rejects.toMatchObject({ message: "git HEAD not found" });
    await gitCommit(dir);
    const head = await gitHead(dir);
    await expect(changedPaths(dir, head, "not-a-tree")).rejects.toMatchObject({
      message: "git diff failed",
    });
    await expect(treeDiffSize(dir, head, "not-a-tree")).rejects.toMatchObject({
      message: "git diff failed",
    });
    await writeFile(join(dir, "empty.txt"), "");
    await writeFile(join(dir, "binary.bin"), Buffer.from([0, 1]));
    await writeFile(join(dir, "note.txt"), "abc");
    const size = await diffSize(dir, head);
    expect(size.files).toBeGreaterThanOrEqual(3);
    expect(size.added).toBeGreaterThan(0);
    await expect(diffSize(dir, "not-a-commit")).rejects.toMatchObject({
      message: "git diff failed",
    });
    await writeFile(join(dir, "blob.bin"), Buffer.from([0, 1, 2]));
    await execFileAsync("git", ["add", "blob.bin"], { cwd: dir });
    await gitCommit(dir, "add blob");
    const blobBase = await gitHead(dir);
    await writeFile(join(dir, "blob.bin"), Buffer.from([0, 1, 2, 3]));
    const binary = await diffSize(dir, blobBase);
    expect(binary.files).toBeGreaterThanOrEqual(1);
    await rm(join(dir, ".git", "index"));
    await expect(workTree(dir)).resolves.toMatch(/^[0-9a-f]{40}$/);
  });
});

test("guard refuses a path outside the repo and a session that does not own the task", async () => {
  expect(guardText({ schema: 1, allowed: true, task: "T1" })).toContain("task: T1");
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "guard-gap");
    await writeTasks(run, [{ title: "Kept", files: ["src/kept.ts"] }]);
    expect((await runCli(["plan", "done", run], dir)).code).toBe(0);
    await ensurePlanReady(run);
    expect((await runCli(["approve", run, "--via", "arg"], dir)).code).toBe(0);
    expect((await runCli(["stage", "start", run, "implement", "--tool", "cursor"], dir)).code)
      .toBe(0);
    expect((await runCli(["claim", run, "T1", "--session", "ada"], dir)).code).toBe(0);
    const outside = await guardPath(run, join(dir, "..", "outside.ts"));
    expect(outside.allowed).toBe(false);
    const runFile = await guardPath(run, join(run, "events.jsonl"));
    expect(runFile).toMatchObject({ allowed: true, task: null });
    const other = await guardPath(run, join(dir, "src", "kept.ts"), "bob");
    expect(other.allowed).toBe(false);
    const owner = await guardPath(run, join(dir, "src", "kept.ts"), "ada");
    expect(owner).toMatchObject({ allowed: true, task: "T1" });
  });
});

test("plan and close verbs report invalid files, cycles, and empty reasons", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "plan-gap");
    await writeTasks(run, [{ title: "Outside", files: ["../outside.ts"] }]);
    const outside = await runCli(["plan", "done", run], dir);
    expect(outside.code).toBe(2);
    expect(outside.stderr).toContain("tasks[0].files[0]");
    await writeTasks(run, [
      { title: "First", deps: ["T2"], files: ["src/first.ts"] },
      { title: "Second", deps: ["T1"], files: ["src/second.ts"] },
    ]);
    const cycle = await runCli(["plan", "done", run], dir);
    expect(cycle.code).toBe(2);
    expect(cycle.stderr).toContain("cycle");
    const fresh = await createRun(dir, "plan-new-gap");
    expect((await runCli(["plan", "new", fresh], dir)).code).toBe(0);
    const again = await runCli(["plan", "new", fresh], dir);
    expect(again.code).toBe(2);
    expect(again.stderr).toContain("already exists");
    const abandon = await runCli(["close", run, "--abandon", " "], dir);
    expect(abandon.code).toBe(2);
    expect(abandon.stderr).toContain("reason is empty");
    const waive = await runCli(["close", run, "--waive-review", " "], dir);
    expect(waive.code).toBe(2);
    expect(waive.stderr).toContain("reason is empty");
  });
});

test("approve preview treats a missing overview and a broken index as no tasks", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "preview-gap");
    const missing = await approvePreview(run);
    expect(missing.tasks).toBe(0);
    expect(missing.goal).toBe("");
    await mkdir(join(run, "10-plan"), { recursive: true });
    await writeFile(join(run, "10-plan", "index.json"), "{", "utf8");
    await expect(approvePreview(run)).rejects.toThrow();
    await writeFile(join(run, "10-plan", "index.json"), "{}\n", "utf8");
    const invalid = await approvePreview(run);
    expect(invalid.tasks).toBe(0);
  });
});

test("claim and steal reject an empty session, a bad ttl, and a foreign lock", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "claim-gap");
    await writeTasks(run, [{ title: "Kept", files: ["src/kept.ts"] }]);
    expect((await runCli(["plan", "done", run], dir)).code).toBe(0);
    await ensurePlanReady(run);
    expect((await runCli(["approve", run, "--via", "arg"], dir)).code).toBe(0);
    await expect(claimTask(run, "T1", "ada")).rejects.toMatchObject({
      message: expect.stringContaining("run is approved"),
    });
    expect((await runCli(["stage", "start", run, "implement", "--tool", "cursor"], dir)).code)
      .toBe(0);
    await expect(claimTask(run, "T1", " ")).rejects.toMatchObject({ fieldPath: "session" });
    await expect(claimTask(run, "nope", "ada")).rejects.toMatchObject({ fieldPath: "task" });
    await expect(stealTask(run, "T1", "ada", Number.NaN)).rejects.toMatchObject({
      fieldPath: "ttl",
    });
    await expect(assertClaimOwner(run, "T1", "ada")).resolves.toBeUndefined();
    expect((await runCli(["claim", run, "T1", "--session", "ada"], dir)).code).toBe(0);
    await expect(assertClaimOwner(run, "T1", "bob")).rejects.toMatchObject({
      message: "lock held by ada",
    });
    await expect(releaseClaimLock(run, "T1", undefined)).resolves.toBeUndefined();
    await expect(releaseClaimLock(run, "T9", "ada")).resolves.toBeUndefined();
    await expect(claimTask(run, "T9", "ada")).rejects.toMatchObject({ message: "task not found" });
    const forced = await runCli(["release", run, "T1", "--session", "bob", "--force"], dir);
    expect(forced.code).toBe(2);
    expect(forced.stderr).toContain("reason is empty");
    const reasoned = await runCli(
      ["release", run, "T1", "--session", "ada", "--reason", "pause"],
      dir,
    );
    expect(reasoned.code).not.toBe(0);
    expect(reasoned.stderr.length).toBeGreaterThan(0);
  });
});

test("a fresh run lock times out", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "lock-timeout");
    const lock = join(run, "locks", "run.lock");
    await mkdir(join(run, "locks"), { recursive: true });
    await writeFile(lock, "{}\n");
    await expect(withRunLock(run, async () => "ok")).rejects.toMatchObject({
      message: "run lock timed out",
    });
  });
});

test("brainstorm creation rejects a duplicate and a missing directory", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const created = await createBrainstorm({ cwd: dir, slug: "coverage-notes" });
    await expect(createBrainstorm({ cwd: dir, slug: "coverage-notes" })).rejects.toMatchObject({
      message: "brainstorm already exists",
    });
    await expect(resolveBrainstorm(join(dir, ".agent-relay"), "missing-name")).rejects
      .toMatchObject({ message: "invalid brainstorm name" });
    await writeFile(join(dir, ".agent-relay", "brainstorms", "20261019-file-note"), "x");
    await expect(resolveBrainstorm(join(dir, ".agent-relay"), "20261019-file-note")).rejects
      .toMatchObject({ message: "brainstorm not found" });
    expect(created.path).toContain("coverage-notes");
    await expect(createBrainstorm({ cwd: dir, slug: "Bad Slug" })).rejects.toThrow();
  });
});
