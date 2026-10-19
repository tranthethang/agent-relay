import { execFile } from "node:child_process";
import { lstat, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { gitCommit, runCli, withTempDir, withTempGitRepo } from "./helper.js";

const execFileAsync = promisify(execFile);

type Created = {
  path: string;
  name: string;
  base: string;
  worktree?: { path: string; branch: string };
};

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execFileAsync("git", args, { cwd })).stdout.trim();
}

async function commitPolicy(repo: string, worktree: Record<string, unknown>): Promise<void> {
  const policy = { schema: 1, requireReviews: ["self"], smallChange: 20, worktree };
  await writeFile(join(repo, ".agent-relay.json"), `${JSON.stringify(policy)}\n`);
  await git(repo, ["add", ".agent-relay.json"]);
  await gitCommit(repo, "policy");
}

async function runNew(repo: string, slug: string): Promise<Created> {
  const result = await runCli(["run", "new", "--slug", slug, "--title", "Wt", "--json"], repo);
  if (result.code !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout) as Created;
}

async function cleanup(repo: string, created: Created): Promise<void> {
  if (created.worktree === undefined) return;
  await rm(join(created.worktree.path, ".agent-relay"), { force: true });
  await git(repo, ["worktree", "remove", "--force", created.worktree.path]);
}

test("run new creates a worktree, a branch, and the .agent-relay link", async () => {
  await withTempGitRepo(async (repo) => {
    await withTempDir(async (dir) => {
      await commitPolicy(repo, { enabled: true, dir });
      const branch = await git(repo, ["symbolic-ref", "--short", "HEAD"]);
      const created = await runNew(repo, "wt-on");
      try {
        const path = join(dir, created.name);
        expect(created.worktree).toEqual({ path, branch });
        expect(await git(repo, ["branch", "--list", created.name])).toContain(created.name);
        expect((await lstat(join(path, ".agent-relay"))).isSymbolicLink()).toBe(true);
        expect(await realpath(join(path, ".agent-relay", created.name)))
          .toBe(await realpath(created.path));
        const run = JSON.parse(await readFile(join(created.path, "run.json"), "utf8")) as Created;
        expect(run.worktree).toEqual({ path, branch });
        expect(run.base).toBe(await git(path, ["rev-parse", "HEAD"]));
        const text = await runCli(["context", created.path, "--json"], repo);
        expect(JSON.parse(text.stdout)).toMatchObject({ run: { worktree: { path, branch } } });
      } finally {
        await cleanup(repo, created);
      }
    });
  });
});

test("run new ignores a policy change that is not committed", async () => {
  await withTempGitRepo(async (repo) => {
    await withTempDir(async (dir) => {
      await commitPolicy(repo, { enabled: false });
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
      const created = await runNew(repo, "wt-dirty-policy");
      expect(created.worktree).toBeUndefined();
      expect(await readdir(dir)).toEqual([]);
    });
  });
});

test("run new uses <repo>_work-tree when dir is missing", async () => {
  await withTempGitRepo(async (repo) => {
    await commitPolicy(repo, { enabled: true });
    const root = join(dirname(repo), `${basename(repo)}_work-tree`);
    let created: Created | undefined;
    try {
      created = await runNew(repo, "wt-default");
      expect(created.worktree?.path).toBe(join(root, created.name));
    } finally {
      if (created !== undefined) await cleanup(repo, created);
      await rm(root, { recursive: true, force: true });
    }
  });
});

test("run new on a detached HEAD fails with gate and creates no run", async () => {
  await withTempGitRepo(async (repo) => {
    await withTempDir(async (dir) => {
      await commitPolicy(repo, { enabled: true, dir });
      await git(repo, ["checkout", "--detach", "HEAD"]);
      const result = await runCli(["run", "new", "--slug", "wt-detached", "--title", "Wt"], repo);
      expect(result.code).toBe(4);
      expect(result.stderr).toContain("worktree needs a branch at HEAD");
      const runs = await readdir(join(repo, ".agent-relay")).catch(() => []);
      expect(runs.filter((name) => name.endsWith("wt-detached"))).toEqual([]);
      expect(await readdir(dir)).toEqual([]);
    });
  });
});

test("run new with worktree off writes no record and creates no branch", async () => {
  await withTempGitRepo(async (repo) => {
    await commitPolicy(repo, { enabled: false });
    const created = await runNew(repo, "wt-off");
    expect(created.worktree).toBeUndefined();
    const run = JSON.parse(await readFile(join(created.path, "run.json"), "utf8")) as Created;
    expect(run.worktree).toBeUndefined();
    expect(await git(repo, ["branch", "--list", created.name])).toBe("");
  });
});
