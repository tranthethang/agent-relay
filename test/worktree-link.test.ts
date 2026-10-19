import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { RelayError } from "../src/core/error.js";
import { workTree } from "../src/core/git.js";
import { excludeRelay, linkRelay } from "../src/core/worktree.js";
import { gitCommit, withTempDir, withTempGitRepo } from "./helper.js";

const execFileAsync = promisify(execFile);

async function withWorktree(
  fn: (repo: string, worktree: string) => Promise<void>,
): Promise<void> {
  await withTempGitRepo(async (repo) => {
    await withTempDir(async (outside) => {
      await writeFile(join(repo, "a.txt"), "a\n");
      await execFileAsync("git", ["add", "a.txt"], { cwd: repo });
      await gitCommit(repo);
      await mkdir(join(repo, ".agent-relay"), { recursive: true });
      const worktree = join(outside, "wt");
      await execFileAsync("git", ["worktree", "add", "-b", "wt", worktree, "HEAD"], {
        cwd: repo,
      });
      try {
        await fn(repo, worktree);
      } finally {
        await rm(join(worktree, ".agent-relay"), { force: true });
        await execFileAsync("git", ["worktree", "remove", "--force", worktree], { cwd: repo });
      }
    });
  });
}

async function excludeLines(repo: string): Promise<string[]> {
  return (await readFile(join(repo, ".git", "info", "exclude"), "utf8")).split("\n");
}

test("linkRelay shows the main .agent-relay folder in the worktree", async () => {
  await withWorktree(async (repo, worktree) => {
    await linkRelay(worktree, join(repo, ".agent-relay"));
    await writeFile(join(repo, ".agent-relay", "probe.txt"), "probe\n");
    expect(await readFile(join(worktree, ".agent-relay", "probe.txt"), "utf8")).toBe("probe\n");
  });
});

test("linkRelay refuses when .agent-relay already exists in the worktree", async () => {
  await withWorktree(async (repo, worktree) => {
    await linkRelay(worktree, join(repo, ".agent-relay"));
    const error = await linkRelay(worktree, join(repo, ".agent-relay"))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RelayError);
    expect(error).toMatchObject({ code: "gate", fieldPath: ".agent-relay" });
  });
});

test("excludeRelay adds one line and keeps the existing lines", async () => {
  await withWorktree(async (repo, worktree) => {
    const exclude = join(repo, ".git", "info", "exclude");
    await mkdir(join(repo, ".git", "info"), { recursive: true });
    await writeFile(exclude, "# keep\n*.log");
    await excludeRelay(worktree);
    await excludeRelay(repo);
    const lines = await excludeLines(repo);
    expect(lines.filter((line) => line === ".agent-relay")).toHaveLength(1);
    expect(lines.slice(0, 2)).toEqual(["# keep", "*.log"]);
    expect((await readFile(exclude, "utf8")).endsWith("\n")).toBe(true);
  });
});

test("the linked .agent-relay does not change the worktree status or tree", async () => {
  await withWorktree(async (repo, worktree) => {
    const before = await workTree(worktree);
    await linkRelay(worktree, join(repo, ".agent-relay"));
    await excludeRelay(repo);
    const status = await execFileAsync("git", ["status", "--porcelain"], { cwd: worktree });
    expect(status.stdout).not.toContain(".agent-relay");
    expect(await workTree(worktree)).toBe(before);
  });
});
