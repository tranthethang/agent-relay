import { execFile } from "node:child_process";
import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
    const closed = await runCli(
      ["close", run.path, "--via", "arg", "--ack-warnings", "--waive-review", "x"],
      repo,
    );
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

test("close still closes the run when unlinking .agent-relay fails", async () => {
  await withReviewedRun(async (repo, run) => {
    await git(repo, ["merge", "--ff-only", run.name]);
    const link = join(run.worktree.path, ".agent-relay");
    await rm(link);
    await mkdir(join(link, "nested"), { recursive: true });
    try {
      const closed = await runCli(["close", run.path, "--via", "arg"], repo);
      expect(closed.code).toBe(0);
      expect(closed.stdout).toContain("lifecycle: closed");
      expect(closed.stdout).toContain("worktree: kept (unlink .agent-relay failed:");
      const context = await runCli(["context", run.path, "--json"], repo);
      expect(context.code).toBe(0);
      expect(JSON.parse(context.stdout)).toMatchObject({ lifecycle: "closed" });
    } finally {
      await rm(link, { recursive: true, force: true });
    }
  });
});

test("worktree cleanup removes merged worktree for closed run and is idempotent", async () => {
  await withReviewedRun(async (repo, run) => {
    // Close while unmerged -> worktree is kept
    const closed = await runCli(["close", run.path, "--via", "arg"], repo);
    expect(closed.code).toBe(0);
    expect(closed.stdout).toContain("worktree: kept (branch not merged");
    expect(await exists(run.worktree.path)).toBe(true);

    // Merge now
    await git(repo, ["merge", "--ff-only", run.name]);

    // Retry cleanup
    const cleaned = await runCli(["worktree", "cleanup", run.path], repo);
    expect(cleaned.code).toBe(0);
    expect(cleaned.stdout).toContain("worktree: removed");
    expect(await exists(run.worktree.path)).toBe(false);

    // Check cleaned event recorded
    const events = (await readFile(join(run.path, "events.jsonl"), "utf8")).trim().split("\n");
    expect(events.some((line) => JSON.parse(line).action === "cleaned")).toBe(true);

    // Repeat cleanup is idempotent
    const repeat = await runCli(["worktree", "cleanup", run.path], repo);
    expect(repeat.code).toBe(0);
    expect(repeat.stdout).toContain("worktree: removed");
  });
});

test("worktree cleanup reconciles missing cleaned event when worktree is gone", async () => {
  await withReviewedRun(async (repo, run) => {
    await git(repo, ["merge", "--ff-only", run.name]);
    const closed = await runCli(["close", run.path, "--via", "arg"], repo);
    expect(closed.code).toBe(0);
    expect(await exists(run.worktree.path)).toBe(false);

    // Filter out the cleaned event to simulate write failure after removal
    const eventsFile = join(run.path, "events.jsonl");
    const rawEvents = (await readFile(eventsFile, "utf8")).trim().split("\n");
    const withoutCleaned = rawEvents.filter((line) => JSON.parse(line).action !== "cleaned");
    await writeFile(eventsFile, `${withoutCleaned.join("\n")}\n`);

    // Verify cleaned event is missing
    const beforeEvents = (await readFile(eventsFile, "utf8")).trim().split("\n");
    expect(beforeEvents.some((line) => JSON.parse(line).action === "cleaned")).toBe(false);

    // Worktree cleanup reconciles the missing event
    const cleaned = await runCli(["worktree", "cleanup", run.path], repo);
    expect(cleaned.code).toBe(0);
    expect(cleaned.stdout).toContain("worktree: removed");

    const afterEvents = (await readFile(eventsFile, "utf8")).trim().split("\n");
    expect(afterEvents.some((line) => JSON.parse(line).action === "cleaned")).toBe(true);
  });
});

test("worktree cleanup refuses non-closed or abandoned runs and unmerged worktrees", async () => {
  await withReviewedRun(async (repo, run) => {
    // Calling cleanup on active run is refused
    const activeResult = await runCli(["worktree", "cleanup", run.path], repo);
    expect(activeResult.code).not.toBe(0);
    expect(activeResult.stderr).toContain("worktree cleanup refused: run is reviewing");

    // Close while unmerged -> retry cleanup refuses unmerged
    await runCli(["close", run.path, "--via", "arg"], repo);
    const unmergedResult = await runCli(["worktree", "cleanup", run.path], repo);
    expect(unmergedResult.code).toBe(0);
    expect(unmergedResult.stdout).toContain(
      `worktree: kept (branch not merged into ${run.worktree.branch})`,
    );
  });

  // Test abandoned run
  await withReviewedRun(async (repo, run) => {
    const abandoned = await runCli(["close", run.path, "--abandon", "no longer needed"], repo);
    expect(abandoned.code).toBe(0);
    const cleanupResult = await runCli(["worktree", "cleanup", run.path], repo);
    expect(cleanupResult.code).not.toBe(0);
    expect(cleanupResult.stderr).toContain("worktree cleanup refused: run is abandoned");
    expect(await exists(run.worktree.path)).toBe(true);
  });
});
