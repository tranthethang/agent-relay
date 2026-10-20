import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { gitCommit, reachReview, runCli, withTempDir, withTempGitRepo } from "./helper.js";

const execFileAsync = promisify(execFile);

type Created = { path: string; name: string; worktree: { path: string; branch: string } };

async function git(cwd: string, args: string[]): Promise<string> {
  const identity = ["-c", "user.email=test@example.com", "-c", "user.name=test"];
  return (await execFileAsync("git", [...identity, ...args], { cwd })).stdout.trim();
}

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
        ["run", "new", "--slug", "wt-cli", "--title", "CLI", "--json"],
        repo,
      );
      const run = JSON.parse(created.stdout) as Created;
      try {
        await reachReview(run.path, run.worktree.path);
        await gitCommit(run.worktree.path, "work");
        for (
          const args of [
            ["review", "new", run.path, "self", "--tool", "cursor"],
            ["review", "done", run.path, "self"],
          ]
        ) {
          const result = await runCli(args, run.worktree.path);
          if (result.code !== 0) throw new Error(result.stderr);
        }
        await fn(repo, run);
      } finally {
        await git(repo, ["worktree", "remove", "--force", run.worktree.path]).catch(() =>
          undefined
        );
      }
    });
  });
}

test("worktree cleanup refuses without run argument", async () => {
  await withTempGitRepo(async (repo) => {
    const result = await runCli(["worktree", "cleanup"], repo);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("run is required");
  });
});

test("worktree cleanup refuses when run has no worktree", async () => {
  await withTempGitRepo(async (repo) => {
    await gitCommit(repo);
    const created = await runCli(
      ["run", "new", "--slug", "no-wt", "--title", "No WT", "--json"],
      repo,
    );
    const run = JSON.parse(created.stdout) as { path: string; name: string };
    const closeResult = await runCli(["close", run.path, "--abandon", "abandon"], repo);
    expect(closeResult.code).toBe(0);
    const result = await runCli(["worktree", "cleanup", run.name], repo);
    expect(result.code).toBe(4);
    expect(result.stderr).toContain("run has no worktree");
  });
});

test("worktree cleanup refuses when run is not closed", async () => {
  await withReviewedRun(async (repo, run) => {
    const result = await runCli(["worktree", "cleanup", run.name], repo);
    expect(result.code).toBe(4);
    expect(result.stderr).toContain("worktree cleanup refused: run is reviewing");
  });
});

test("worktree cleanup removes worktree and outputs text", async () => {
  await withReviewedRun(async (repo, run) => {
    await git(repo, ["merge", "--no-ff", run.name, "-m", "merge"]);
    const closeResult = await runCli(["close", run.path], repo);
    expect(closeResult.code).toBe(0);
    const cleanupResult = await runCli(["worktree", "cleanup", run.name], repo);
    expect(cleanupResult.code).toBe(0);
    expect(cleanupResult.stdout).toContain("worktree: removed\n");
  });
});

test("worktree cleanup accepts --run flag and --json", async () => {
  await withReviewedRun(async (repo, run) => {
    await git(repo, ["merge", "--no-ff", run.name, "-m", "merge"]);
    await runCli(["close", run.path], repo);
    const result = await runCli(["worktree", "cleanup", "--run", run.name, "--json"], repo);
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      schema: number;
      path: string;
      worktree: { removed: boolean };
    };
    expect(parsed.schema).toBe(1);
    expect(parsed.worktree.removed).toBe(true);
  });
});
