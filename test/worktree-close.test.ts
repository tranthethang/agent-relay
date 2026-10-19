import { execFile } from "node:child_process";
import { access, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { gitCommit, reachReview, runCli, withTempDir, withTempGitRepo } from "./helper.js";

const execFileAsync = promisify(execFile);

type Created = { path: string; name: string; worktree: { path: string; branch: string } };

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execFileAsync("git", args, { cwd })).stdout.trim();
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// A run in its own worktree, reviewed and ready to close. The run branch has one new commit.
async function withReviewedRun(fn: (repo: string, run: Created) => Promise<void>): Promise<void> {
  await withTempGitRepo(async (repo) => {
    await withTempDir(async (dir) => {
      const policy = {
        schema: 1,
        requireReviews: ["self"],
        smallChange: 20,
        worktree: {
          enabled: true,
          dir,
        },
      };
      await writeFile(join(repo, ".agent-relay.json"), `${JSON.stringify(policy)}\n`);
      await git(repo, ["add", ".agent-relay.json"]);
      await gitCommit(repo, "policy");
      const created = await runCli(
        ["run", "new", "--slug", "wt-close", "--title", "Close", "--json"],
        repo,
      );
      const run = JSON.parse(created.stdout) as Created;
      try {
        await reachReview(run.path, run.worktree.path);
        await gitCommit(run.worktree.path, "work");
        for (
          const args of [["review", "new", run.path, "self", "--tool", "cursor"], [
            "review",
            "done",
            run.path,
            "self",
          ]]
        ) {
          const result = await runCli(args, run.worktree.path);
          if (result.code !== 0) throw new Error(result.stderr);
        }
        await fn(repo, run);
      } finally {
        if (await exists(run.worktree.path)) {
          await rm(join(run.worktree.path, ".agent-relay"), { force: true });
          await git(repo, ["worktree", "remove", "--force", run.worktree.path]);
        }
      }
    });
  });
}

test("close removes a merged worktree and keeps the run history and branch", async () => {
  await withReviewedRun(async (repo, run) => {
    const before = await readdir(run.path);
    await git(repo, ["merge", "--ff-only", run.name]);
    const preview = await runCli(["close", run.path, "--preview"], repo);
    expect(preview.stdout).toContain("worktree: close will remove it");
    const closed = await runCli(["close", run.path, "--via", "arg"], repo);
    expect(closed.code).toBe(0);
    expect(closed.stdout).toContain("worktree: removed");
    expect(await exists(run.worktree.path)).toBe(false);
    expect((await readdir(run.path)).sort()).toEqual(expect.arrayContaining(before.sort()));
    expect(await git(repo, ["branch", "--list", run.name])).toContain(run.name);
    const context = await runCli(["context", run.path, "--json"], repo);
    expect(context.code).toBe(0);
    expect(JSON.parse(context.stdout)).toMatchObject({ lifecycle: "closed" });
    const next = await runCli(["next", run.path, "--json"], repo);
    expect(next.code).toBe(0);
    expect(JSON.parse(next.stdout)).toMatchObject({ command: "none" });
    expect((await runCli(["status", "--json"], repo)).code).toBe(0);
  });
});

test("close keeps the worktree when the run branch is not merged", async () => {
  await withReviewedRun(async (repo, run) => {
    const preview = await runCli(["close", run.path, "--preview"], repo);
    expect(preview.stdout).toContain(
      `worktree: close will keep it (branch not merged into ${run.worktree.branch})`,
    );
    const closed = await runCli(["close", run.path, "--via", "arg"], repo);
    expect(closed.code).toBe(0);
    expect(closed.stdout).toContain(
      `worktree: kept (branch not merged into ${run.worktree.branch})`,
    );
    expect(await exists(join(run.worktree.path, ".agent-relay", run.name))).toBe(true);
  });
});

test("close keeps a merged worktree that has changes", async () => {
  await withReviewedRun(async (repo, run) => {
    await git(repo, ["merge", "--ff-only", run.name]);
    await writeFile(join(run.worktree.path, "left.txt"), "left\n");
    const preview = await runCli(["close", run.path, "--preview"], repo);
    expect(preview.stdout).toContain("worktree: close will keep it (worktree has changes)");
    const closed = await runCli(["close", run.path, "--via", "arg", "--waive-review", "x"], repo);
    expect(closed.code).toBe(0);
    expect(closed.stdout).toContain("lifecycle: closed");
    expect(closed.stdout).toContain("worktree: kept (worktree has changes)");
    expect(await exists(join(run.worktree.path, ".agent-relay", run.name))).toBe(true);
  });
});

test("close still closes the run when git worktree remove fails", async () => {
  await withReviewedRun(async (repo, run) => {
    await git(repo, ["merge", "--ff-only", run.name]);
    await git(repo, ["worktree", "lock", run.worktree.path]);
    try {
      const closed = await runCli(["close", run.path, "--via", "arg"], repo);
      expect(closed.code).toBe(0);
      expect(closed.stdout).toContain("lifecycle: closed");
      expect(closed.stdout).toContain("worktree: kept (git worktree remove failed:");
      expect(await exists(join(run.worktree.path, ".agent-relay", run.name))).toBe(true);
    } finally {
      await git(repo, ["worktree", "unlock", run.worktree.path]);
    }
  });
});
