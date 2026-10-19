import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { gitCommit, runCli, withTempDir, withTempGitRepo } from "./helper.js";
import { createRun, writeTasks } from "./plan-helper.js";

const execFileAsync = promisify(execFile);

type Event = { stage: string; action: string; ref?: string; size?: unknown; extra?: unknown };

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execFileAsync("git", args, { cwd })).stdout.trim();
}

async function events(run: string): Promise<Event[]> {
  return (await readFile(join(run, "events.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line) as Event);
}

async function approved(dir: string, slug: string): Promise<string> {
  const run = await createRun(dir, slug);
  await writeTasks(run, [{ title: "Own", files: ["src/own.ts"] }]);
  expect((await runCli(["plan", "done", run], dir)).code).toBe(0);
  expect((await runCli(["approve", run, "--via", "arg"], dir)).code).toBe(0);
  return run;
}

function start(run: string, dir: string) {
  return runCli(["stage", "start", run, "implement", "--tool", "cursor"], dir);
}

async function committed(dir: string, name: string): Promise<void> {
  await writeFile(join(dir, name), `${name}\n`);
  await git(dir, ["add", name]);
  await gitCommit(dir, name);
}

test("a dirty tracked file blocks implement start and adds no event", async () => {
  await withTempGitRepo(async (dir) => {
    await committed(dir, "a.txt");
    const run = await approved(dir, "dirty-tracked");
    const before = await events(run);
    await writeFile(join(dir, "a.txt"), "changed\n");
    const result = await start(run, dir);
    expect(result.code).toBe(4);
    expect(result.stderr).toContain("working tree has changes");
    expect(await events(run)).toEqual(before);
  });
});

test("an untracked file outside .agent-relay blocks implement start", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await approved(dir, "dirty-untracked");
    await writeFile(join(dir, "new.txt"), "new\n");
    expect((await start(run, dir)).code).toBe(4);
  });
});

test("a change only under .agent-relay does not block implement start", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await approved(dir, "relay-only");
    await writeFile(join(run, "notes.txt"), "note\n");
    expect((await start(run, dir)).code).toBe(0);
  });
});

test("a clean start moves base to HEAD and records rebased before started", async () => {
  await withTempGitRepo(async (dir) => {
    await committed(dir, "a.txt");
    const run = await approved(dir, "rebase-base");
    await committed(dir, "b.txt");
    const head = await git(dir, ["rev-parse", "HEAD"]);
    expect((await start(run, dir)).code).toBe(0);
    const saved = JSON.parse(await readFile(join(run, "run.json"), "utf8")) as { base: string };
    expect(saved.base).toBe(head);
    const actions = (await events(run)).map((event) => `${event.stage}:${event.action}`);
    expect(actions.slice(-2)).toEqual(["run:rebased", "implement:started"]);
    expect((await events(run)).find((event) => event.action === "rebased")?.ref).toBe(head);
    await mkdir(join(dir, "src"), { recursive: true });
    expect((await runCli(["task", "start", run, "T1"], dir)).code).toBe(0);
    await writeFile(join(dir, "src/own.ts"), "export {};\n");
    expect((await runCli(["task", "done", run, "T1"], dir)).code).toBe(0);
    const done = await runCli(["stage", "done", run, "implement", "--tool", "cursor"], dir);
    expect(done.code).toBe(0);
    const completed = (await events(run)).find((event) =>
      event.stage === "implement" && event.action === "completed"
    );
    expect(completed?.size).toEqual({ files: 1, added: 1, deleted: 0 });
    expect(completed?.extra).toBeUndefined();
  });
});

test("a run with a worktree record skips the clean-tree check", async () => {
  await withTempGitRepo(async (dir) => {
    await withTempDir(async (outside) => {
      await gitCommit(dir);
      const run = await approved(dir, "worktree-skip");
      const path = join(outside, "wt");
      await git(dir, ["worktree", "add", "-b", "wt", path, "HEAD"]);
      try {
        const runJson = join(run, "run.json");
        const value = JSON.parse(await readFile(runJson, "utf8")) as { base: string };
        await writeFile(
          runJson,
          `${JSON.stringify({ ...value, worktree: { path, branch: "x" } })}\n`,
        );
        await writeFile(join(dir, "dirty.txt"), "dirty\n");
        expect((await start(run, dir)).code).toBe(0);
        expect((await events(run)).some((event) => event.action === "rebased")).toBe(false);
        const saved = JSON.parse(await readFile(runJson, "utf8")) as { base: string };
        expect(saved.base).toBe(value.base);
      } finally {
        await git(dir, ["worktree", "remove", "--force", path]);
      }
    });
  });
});
