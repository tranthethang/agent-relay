import { execFile } from "node:child_process";
import { lstat, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { expect, test, vi } from "vitest";
import { claimTask, integrateTask, listTasks, releaseTask, stealTask } from "../src/core/claim.js";
import { readOwner } from "../src/core/lock.js";
import { taskWorktreeBase } from "../src/core/worktree.js";
import { gitCommit, runCli, withTempDir, withTempGitRepo } from "./helper.js";
import { createRun, startImplement, writeTasks } from "./plan-helper.js";

const execFileAsync = promisify(execFile);
const treeFail = vi.hoisted(() => ({ on: false }));

vi.mock("../src/core/git.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core/git.js")>();
  return {
    ...actual,
    workTree: (cwd: string) => {
      if (treeFail.on) return Promise.reject(new Error("tree failed"));
      return actual.workTree(cwd);
    },
  };
});

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execFileAsync("git", args, { cwd })).stdout.trim();
}

test("claim release and steal record events and honor the lock", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "claim-verbs");
    await writeTasks(run, [
      { title: "First", files: ["src/core/claim.ts"] },
      { title: "Second", deps: ["T1"], files: ["src/cli/claim.ts"] },
    ]);
    expect((await runCli(["plan", "done", run], dir)).code).toBe(0);
    const early = await runCli(["claim", run, "T1", "--session", "alice"], dir);
    expect(early.code).toBe(4);
    expect(early.stderr).toContain("claim refused: run is planned");
    await startImplement(dir, run);
    const blocked = await runCli(["claim", run, "T2", "--session", "alice"], dir);
    expect(blocked.code).toBe(4);
    expect(blocked.stderr).toContain("T2.deps: claim refused: T1 is pending");
    const claimed = await runCli(["claim", run, "T1", "--session", "alice", "--json"], dir);
    expect(claimed.code).toBe(0);
    expect(JSON.parse(claimed.stdout)).toMatchObject({
      task: "T1",
      status: "in-progress",
      session: "alice",
      action: "claimed",
    });
    expect((await readOwner(run, "T1")).session).toBe("alice");
    expect((await readOwner(run, "T1")).path).toBeUndefined();
    const other = await runCli(["release", run, "T1", "--session", "bob"], dir);
    expect(other.code).toBe(5);
    expect(other.stderr).toContain("locks/T1.lock: lock held by alice");
    const released = await runCli(["release", run, "T1", "--session", "alice", "--json"], dir);
    expect(released.code).toBe(0);
    expect(JSON.parse(released.stdout)).toMatchObject({
      task: "T1",
      session: "alice",
      action: "released",
    });
    await expect(readOwner(run, "T1")).rejects.toMatchObject({ code: "not_found" });
    expect((await runCli(["claim", run, "T1", "--session", "alice"], dir)).code).toBe(0);
    const fresh = await runCli(["steal", run, "T1", "--session", "bob", "--ttl", "60"], dir);
    expect(fresh.code).toBe(5);
    const stolen = await runCli(
      ["steal", run, "T1", "--session", "bob", "--ttl", "0", "--json"],
      dir,
    );
    expect(stolen.code).toBe(0);
    expect(JSON.parse(stolen.stdout)).toMatchObject({
      task: "T1",
      session: "bob",
      action: "stolen",
    });
    expect((await readOwner(run, "T1")).session).toBe("bob");
    const forced = await runCli([
      "release",
      run,
      "T1",
      "--session",
      "alice",
      "--force",
      "--reason",
      "stale owner",
      "--json",
    ], dir);
    expect(forced.code).toBe(0);
    expect(JSON.parse(forced.stdout)).toMatchObject({
      action: "released",
      session: "alice",
      reason: "stale owner",
    });
    const noReason = await runCli(["release", run, "T1", "--session", "alice", "--force"], dir);
    expect(noReason.code).toBe(2);
    const events = await readFile(join(run, "events.jsonl"), "utf8");
    const lines = events.trim().split("\n").map((line) =>
      JSON.parse(line) as {
        action: string;
        tree?: string;
      }
    );
    const started = lines.filter((event) => event.action === "task-started");
    const stolenEvents = lines.filter((event) => event.action === "stolen");
    expect(started.length).toBeGreaterThan(0);
    expect(stolenEvents.length).toBeGreaterThan(0);
    for (const event of [...started, ...stolenEvents]) {
      expect(event.tree).toMatch(/^[0-9a-f]{40}$/);
    }
    expect(events).toContain("\"action\":\"claimed\"");
    expect(events).toContain("\"action\":\"task-started\"");
    expect(events).toContain("\"action\":\"stolen\"");
    expect(events).toContain("\"action\":\"released\"");
    expect(events).toContain("\"reason\":\"stale owner\"");
  });
});

test("direct claim lifecycle reports ownership, release, and stale lock theft", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "direct-claim");
    await writeTasks(run, [
      { title: "First", files: ["src/first.ts"] },
      { title: "Second", deps: ["T1"], files: ["src/second.ts"] },
    ]);
    expect((await runCli(["plan", "done", run], dir)).code).toBe(0);
    await startImplement(dir, run);

    await expect(claimTask(run, "T2", "alice")).rejects.toThrow("T1 is pending");
    const claimed = await claimTask(run, "T1", "alice");
    expect(claimed).toMatchObject({ action: "claimed", session: "alice" });
    expect((await listTasks(run)).tasks[0]).toMatchObject({
      owner: "alice",
      status: "in-progress",
    });
    await expect(releaseTask(run, "T1", "alice", false, "unforced"))
      .rejects.toThrow("reason requires --force");
    const released = await releaseTask(run, "T1", "alice", false);
    expect(released).toMatchObject({ action: "released", forced: false });
    expect((await listTasks(run)).tasks[0].owner).toBeUndefined();

    await claimTask(run, "T1", "alice");
    await expect(stealTask(run, "T1", "bob", -1)).rejects.toThrow("ttl must be");
    await expect(stealTask(run, "T1", "bob", 60)).rejects.toThrow();
    const stolen = await stealTask(run, "T1", "bob", 0);
    expect(stolen).toMatchObject({ action: "stolen", session: "bob" });
    await expect(releaseTask(run, "T1", "bob", true)).rejects.toThrow("reason is empty");
    const forced = await releaseTask(run, "T1", "bob", true, "stale claim");
    expect(forced).toMatchObject({ forced: true, reason: "stale claim" });
  });
});

test("claim creates a task worktree and release removes a clean one", async () => {
  await withTempGitRepo(async (repo) => {
    await withTempDir(async (dir) => {
      const policy = {
        schema: 1,
        requireReviews: ["self"],
        smallChange: 20,
        worktree: { enabled: true, dir },
      };
      await writeFile(join(repo, ".agent-relay.json"), `${JSON.stringify(policy)}\n`);
      await git(repo, ["add", ".agent-relay.json"]);
      await gitCommit(repo, "policy");
      const run = await createRun(repo, "claim-tree");
      const name = basename(run);
      await writeTasks(run, [{ title: "First", files: ["src/core/claim.ts"] }]);
      expect((await runCli(["plan", "done", run], repo)).code).toBe(0);
      await startImplement(repo, run);
      const claimed = await runCli(["claim", run, "T1", "--session", "alice", "--json"], repo);
      expect(claimed.code).toBe(0);
      const taskPath = join(dir, name, "T1");
      const branch = `${name}-T1`;
      expect(JSON.parse(claimed.stdout)).toMatchObject({
        worktree: { path: taskPath, branch },
      });
      const owner = await readOwner(run, "T1");
      expect(owner.path).toBe(taskPath);
      expect(owner.branch).toBe(branch);
      expect((await lstat(taskPath)).isDirectory()).toBe(true);
      expect(await git(repo, ["branch", "--list", branch])).toContain(branch);

      await writeFile(join(taskPath, "note.txt"), "dirty\n");
      const dirty = await runCli(["release", run, "T1", "--session", "alice"], repo);
      expect(dirty.code).toBe(0);
      expect(dirty.stdout).toContain("worktree: kept (worktree has changes)");
      expect((await lstat(taskPath)).isDirectory()).toBe(true);

      expect((await runCli(["claim", run, "T1", "--session", "alice"], repo)).code).not.toBe(0);
      await git(repo, ["worktree", "remove", "--force", taskPath]);
      await git(repo, ["branch", "-D", branch]);

      const again = await runCli(["claim", run, "T1", "--session", "alice"], repo);
      expect(again.code).toBe(0);
      const clean = await runCli(["release", run, "T1", "--session", "alice"], repo);
      expect(clean.code).toBe(0);
      expect(clean.stdout).toContain("worktree: removed");
      await expect(lstat(taskPath)).rejects.toThrow();
      expect(await git(repo, ["branch", "--list", branch])).toBe("");
    });
  });
});

test("a failed claim removes the task worktree and the branch", async () => {
  await withTempGitRepo(async (repo) => {
    await withTempDir(async (dir) => {
      const policy = {
        schema: 1,
        requireReviews: ["self"],
        smallChange: 20,
        worktree: { enabled: true, dir },
      };
      await writeFile(join(repo, ".agent-relay.json"), `${JSON.stringify(policy)}\n`);
      await git(repo, ["add", ".agent-relay.json"]);
      await gitCommit(repo, "policy");
      const run = await createRun(repo, "claim-rollback");
      const name = basename(run);
      await writeTasks(run, [{ title: "First", files: ["src/core/claim.ts"] }]);
      expect((await runCli(["plan", "done", run], repo)).code).toBe(0);
      await startImplement(repo, run);
      const taskPath = join(dir, name, "T1");
      const branch = `${name}-T1`;
      treeFail.on = true;
      try {
        await expect(claimTask(run, "T1", "alice")).rejects.toThrow("tree failed");
      } finally {
        treeFail.on = false;
      }
      await expect(lstat(taskPath)).rejects.toThrow();
      await expect(readOwner(run, "T1")).rejects.toMatchObject({ code: "not_found" });
      expect(await git(repo, ["branch", "--list", branch])).toBe("");
    });
  });
});

async function enableWorktree(repo: string, dir: string): Promise<void> {
  const policy = {
    schema: 1,
    requireReviews: ["self"],
    smallChange: 20,
    worktree: { enabled: true, dir },
  };
  await writeFile(join(repo, ".agent-relay.json"), `${JSON.stringify(policy)}\n`);
  await git(repo, ["add", ".agent-relay.json"]);
  await gitCommit(repo, "policy");
}

async function commitFile(cwd: string, name: string, body: string): Promise<void> {
  await writeFile(join(cwd, name), body);
  await execFileAsync("git", ["add", name], { cwd });
  await execFileAsync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-m", name],
    { cwd },
  );
}

async function runCheckout(run: string): Promise<string> {
  const record = JSON.parse(await readFile(join(run, "run.json"), "utf8")) as {
    worktree?: { path: string };
  };
  if (record.worktree === undefined) throw new Error("run worktree missing");
  return record.worktree.path;
}

test("integrate refuses while a dependency is open", async () => {
  await withTempGitRepo(async (repo) => {
    await gitCommit(repo);
    const run = await createRun(repo, "integrate-dep");
    await writeTasks(run, [
      { title: "First", files: ["src/core/claim.ts"] },
      { title: "Second", deps: ["T1"], files: ["src/cli/claim.ts"] },
    ]);
    expect((await runCli(["plan", "done", run], repo)).code).toBe(0);
    await startImplement(repo, run);
    const result = await runCli(["integrate", run, "T2"], repo);
    expect(result.code).toBe(4);
    expect(result.stderr).toContain("integrate refused: T1 is pending");
  });
});

test("integrate merges a clean task branch and records cleaned", async () => {
  await withTempGitRepo(async (repo) => {
    await withTempDir(async (dir) => {
      await enableWorktree(repo, dir);
      const run = await createRun(repo, "integrate-clean");
      const name = basename(run);
      await writeTasks(run, [{ title: "First", files: ["src/core/claim.ts"] }]);
      expect((await runCli(["plan", "done", run], repo)).code).toBe(0);
      await startImplement(repo, run);
      const claimed = await runCli(["claim", run, "T1", "--session", "alice", "--json"], repo);
      expect(claimed.code, claimed.stderr).toBe(0);
      const taskPath = join(dir, name, "T1");
      const branch = `${name}-T1`;
      await commitFile(taskPath, "note.txt", "task\n");
      const done = await runCli(["task", "done", run, "T1", "--session", "alice"], repo);
      expect(done.code, done.stderr).toBe(0);
      const merged = await runCli(["integrate", run, "T1"], repo);
      expect(merged.code, merged.stderr).toBe(0);
      expect(merged.stdout).toContain("merged: yes");
      await expect(lstat(taskPath)).rejects.toThrow();
      expect(await git(repo, ["branch", "--list", branch])).toBe("");
      const events = await readFile(join(run, "events.jsonl"), "utf8");
      expect(events).toContain("\"action\":\"cleaned\"");
      expect(events).toContain(`"ref":"${branch}"`);
      expect(events).toContain("\"task\":\"T1\"");
      const checkout = await runCheckout(run);
      expect(await readFile(join(checkout, "note.txt"), "utf8")).toBe("task\n");
    });
  });
});

test("integrate keeps the worktree when the merge conflicts", async () => {
  await withTempGitRepo(async (repo) => {
    await withTempDir(async (dir) => {
      await enableWorktree(repo, dir);
      const run = await createRun(repo, "integrate-conflict");
      const name = basename(run);
      await writeTasks(run, [{ title: "First", files: ["src/core/claim.ts"] }]);
      expect((await runCli(["plan", "done", run], repo)).code).toBe(0);
      await startImplement(repo, run);
      expect((await runCli(["claim", run, "T1", "--session", "alice"], repo)).code).toBe(0);
      const taskPath = join(dir, name, "T1");
      await commitFile(taskPath, "note.txt", "task\n");
      const done = await runCli(["task", "done", run, "T1", "--session", "alice"], repo);
      expect(done.code, done.stderr).toBe(0);
      const checkout = await runCheckout(run);
      await commitFile(checkout, "note.txt", "run\n");
      const merged = await runCli(["integrate", run, "T1"], repo);
      expect(merged.code, merged.stderr).toBe(4);
      expect(merged.stdout).toContain("conflict: note.txt");
      expect(merged.stdout).toContain("worktree: kept");
      expect((await lstat(taskPath)).isDirectory()).toBe(true);
      await expect(
        execFileAsync("git", ["rev-parse", "--verify", "MERGE_HEAD"], { cwd: checkout }),
      ).rejects.toThrow();
    });
  });
});

test("task done sees an outside edit in the task worktree", async () => {
  await withTempGitRepo(async (repo) => {
    await withTempDir(async (dir) => {
      const policy = {
        schema: 1,
        requireReviews: ["self"],
        smallChange: 20,
        strict: { scope: true },
        worktree: { enabled: true, dir },
      };
      await writeFile(join(repo, ".agent-relay.json"), `${JSON.stringify(policy)}\n`);
      await git(repo, ["add", ".agent-relay.json"]);
      await gitCommit(repo, "policy");
      const run = await createRun(repo, "task-scope");
      const name = basename(run);
      await writeTasks(run, [{ title: "First", files: ["src/core/claim.ts"] }]);
      expect((await runCli(["plan", "done", run], repo)).code).toBe(0);
      await startImplement(repo, run);
      expect((await runCli(["claim", run, "T1", "--session", "alice"], repo)).code).toBe(0);
      await commitFile(join(dir, name, "T1"), "note.txt", "outside\n");
      const refused = await runCli(["task", "done", run, "T1", "--session", "alice"], repo);
      expect(refused.code).toBe(4);
      expect(refused.stderr).toContain("edits outside its files: note.txt");
    });
  });
});

test("task done and integrate refuse an uncommitted task worktree", async () => {
  await withTempGitRepo(async (repo) => {
    await withTempDir(async (dir) => {
      await enableWorktree(repo, dir);
      const run = await createRun(repo, "integrate-dirty");
      const name = basename(run);
      await writeTasks(run, [{ title: "First", files: ["src/core/claim.ts"] }]);
      expect((await runCli(["plan", "done", run], repo)).code).toBe(0);
      await startImplement(repo, run);
      expect((await runCli(["claim", run, "T1", "--session", "alice"], repo)).code).toBe(0);
      const taskPath = join(dir, name, "T1");
      await writeFile(join(taskPath, "note.txt"), "task\n");

      const refusedDone = await runCli(["task", "done", run, "T1", "--session", "alice"], repo);
      expect(refusedDone.code).toBe(4);
      expect(refusedDone.stderr).toContain("commit in the task worktree before atry task done");
      expect((await lstat(taskPath)).isDirectory()).toBe(true);
      expect(await readFile(join(run, "events.jsonl"), "utf8")).not.toContain("task-done");

      await commitFile(taskPath, "note.txt", "task\n");
      const done = await runCli(["task", "done", run, "T1", "--session", "alice"], repo);
      expect(done.code, done.stderr).toBe(0);

      await writeFile(join(taskPath, "later.txt"), "dirty\n");
      const kept = await runCli(["integrate", run, "T1"], repo);
      expect(kept.code, kept.stderr).toBe(4);
      expect(kept.stdout).toContain("merged: no");
      expect(kept.stdout).toContain(
        "worktree: kept (worktree has uncommitted changes; commit before integrate)",
      );
      expect((await lstat(taskPath)).isDirectory()).toBe(true);
      expect(await readFile(join(run, "events.jsonl"), "utf8")).not.toContain(
        "\"action\":\"cleaned\"",
      );
      const next = await runCli(["next", run, "--json"], repo);
      expect(JSON.parse(next.stdout).command).toContain("integrate");
      const checkout = await runCheckout(run);
      await expect(readFile(join(checkout, "note.txt"), "utf8")).rejects.toThrow();

      await rm(join(taskPath, "later.txt"));
      const merged = await runCli(["integrate", run, "T1"], repo);
      expect(merged.code, merged.stderr).toBe(0);
      expect(merged.stdout).toContain("merged: yes");
      await expect(lstat(taskPath)).rejects.toThrow();
      expect(await readFile(join(checkout, "note.txt"), "utf8")).toBe("task\n");
      const after = await readFile(join(run, "events.jsonl"), "utf8");
      expect(after).toContain("\"action\":\"cleaned\"");
    });
  });
});

test("steal keeps the task worktree on the new lock", async () => {
  await withTempGitRepo(async (repo) => {
    await withTempDir(async (dir) => {
      await enableWorktree(repo, dir);
      const run = await createRun(repo, "steal-tree");
      const name = basename(run);
      await writeTasks(run, [{ title: "First", files: ["src/core/claim.ts"] }]);
      expect((await runCli(["plan", "done", run], repo)).code).toBe(0);
      await startImplement(repo, run);
      expect((await runCli(["claim", run, "T1", "--session", "alice"], repo)).code).toBe(0);
      const taskPath = join(dir, name, "T1");
      const branch = `${name}-T1`;
      const stolen = await runCli(
        ["steal", run, "T1", "--session", "bob", "--ttl", "0", "--json"],
        repo,
      );
      expect(stolen.code, stolen.stderr).toBe(0);
      expect(JSON.parse(stolen.stdout)).toMatchObject({
        worktree: { path: taskPath, branch },
      });
      const owner = await readOwner(run, "T1");
      expect(owner.session).toBe("bob");
      expect(owner.path).toBe(taskPath);
      expect(owner.branch).toBe(branch);
    });
  });
});

test("direct worktree claim, steal, release, and integrate keep their records consistent", async () => {
  await withTempGitRepo(async (repo) => {
    await withTempDir(async (dir) => {
      await enableWorktree(repo, dir);
      const run = await createRun(repo, "direct-tree");
      await writeTasks(run, [{ title: "First", files: ["src/core/claim.ts"] }]);
      expect((await runCli(["plan", "done", run], repo)).code).toBe(0);
      await startImplement(repo, run);

      const claimed = await claimTask(run, "T1", "alice");
      expect(claimed.worktree).toBeDefined();
      const record = claimed.worktree!;
      const runJson = JSON.parse(await readFile(join(run, "run.json"), "utf8"));
      expect(await taskWorktreeBase(run, runJson, "T1")).toMatchObject({ cwd: record.path });
      const stolen = await stealTask(run, "T1", "bob", 0);
      expect(stolen.worktree).toEqual(record);
      await writeFile(join(record.path, "local.txt"), "dirty\n");
      const kept = await releaseTask(run, "T1", "bob", false);
      expect(kept).toMatchObject({ worktree: "kept", worktreeReason: "worktree has changes" });
      await rm(join(record.path, "local.txt"));
      const removed = await integrateTask(run, "T1");
      expect(removed.merged).toBe(true);
      await expect(lstat(record.path)).rejects.toThrow();
    });
  });
});
