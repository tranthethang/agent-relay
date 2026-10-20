import { execFile } from "node:child_process";
import { lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { expect, test, vi } from "vitest";
import * as files from "../src/core/files.js";
import { createRun } from "../src/core/scaffold.js";
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

test("simultaneous creation with the same timestamp and slug creates distinct runs and worktrees", async () => {
  await withTempGitRepo(async (repo) => {
    await withTempDir(async (dir) => {
      await commitPolicy(repo, { enabled: true, dir });
      const nowMs = 1792461198000;
      const [r1, r2] = await Promise.all([
        createRun({ cwd: repo, slug: "simul", title: "Run 1", nowMs }),
        createRun({ cwd: repo, slug: "simul", title: "Run 2", nowMs }),
      ]);
      try {
        expect(r1.name).not.toBe(r2.name);
        expect(r1.id).not.toBe(r2.id);
        expect(r1.worktree?.path).not.toBe(r2.worktree?.path);
        expect(await lstat(r1.path)).toBeDefined();
        expect(await lstat(r2.path)).toBeDefined();
        expect(await lstat(r1.worktree!.path)).toBeDefined();
        expect(await lstat(r2.worktree!.path)).toBeDefined();
        expect(await git(repo, ["branch", "--list", r1.name])).toContain(r1.name);
        expect(await git(repo, ["branch", "--list", r2.name])).toContain(r2.name);
      } finally {
        await cleanup(repo, r1);
        await cleanup(repo, r2);
      }
    });
  });
});

test("run new fails with gate when worktree path exists and preserves pre-existing files", async () => {
  await withTempGitRepo(async (repo) => {
    await withTempDir(async (dir) => {
      await commitPolicy(repo, { enabled: true, dir });
      const nowMs = 1792461198000;
      const ymd = "20261020";
      const id = "1792461198";
      const targetName = `${ymd}-${id}-path-exists`;
      const targetPath = join(dir, targetName);
      await mkdir(targetPath, { recursive: true });
      await writeFile(join(targetPath, "marker.txt"), "pre-existing content", "utf8");

      await expect(
        createRun({ cwd: repo, slug: "path-exists", title: "Exists", nowMs }),
      ).rejects.toMatchObject({
        code: "gate",
        message: "worktree path already exists",
      });

      expect(await readFile(join(targetPath, "marker.txt"), "utf8")).toBe("pre-existing content");
      const runs = await readdir(join(repo, ".agent-relay")).catch(() => []);
      expect(runs.filter((name) => name.endsWith("path-exists"))).toEqual([]);
      expect(await git(repo, ["branch", "--list", targetName])).toBe("");
    });
  });
});

test("run new fails with gate when target branch exists and preserves pre-existing branch", async () => {
  await withTempGitRepo(async (repo) => {
    await withTempDir(async (dir) => {
      await commitPolicy(repo, { enabled: true, dir });
      const nowMs = 1792461198000;
      const ymd = "20261020";
      const id = "1792461198";
      const branchName = `${ymd}-${id}-branch-exists`;
      await git(repo, ["branch", branchName]);

      await expect(
        createRun({ cwd: repo, slug: "branch-exists", title: "Branch exists", nowMs }),
      ).rejects.toMatchObject({
        code: "gate",
        message: "worktree branch already exists",
      });

      expect(await git(repo, ["branch", "--list", branchName])).toContain(branchName);
      const runs = await readdir(join(repo, ".agent-relay")).catch(() => []);
      expect(runs.filter((name) => name.endsWith("branch-exists"))).toEqual([]);
      expect(await readdir(dir)).toEqual([]);
    });
  });
});

test("failure after worktree creation rolls back worktree, branch, and run directory", async () => {
  await withTempGitRepo(async (repo) => {
    await withTempDir(async (dir) => {
      await commitPolicy(repo, { enabled: true, dir });
      const nowMs = 1792461198000;
      const originalAtomicWrite = files.atomicWrite;
      const spy = vi.spyOn(files, "atomicWrite").mockImplementation(async (filePath, contents) => {
        if (filePath.endsWith("events.jsonl")) {
          throw new Error("simulated disk failure writing events.jsonl");
        }
        return originalAtomicWrite(filePath, contents);
      });
      try {
        await expect(
          createRun({ cwd: repo, slug: "fail-meta", title: "Fail Meta", nowMs }),
        ).rejects.toThrow("simulated disk failure writing events.jsonl");
      } finally {
        spy.mockRestore();
      }

      expect(await readdir(dir)).toEqual([]);
      const ymd = "20261020";
      const id = "1792461198";
      const branchName = `${ymd}-${id}-fail-meta`;
      expect(await git(repo, ["branch", "--list", branchName])).toBe("");
      const runs = await readdir(join(repo, ".agent-relay")).catch(() => []);
      expect(runs.filter((name) => name.endsWith("fail-meta"))).toEqual([]);
    });
  });
});

test("run new rejects committed policy with worktree.dir inside the repository", async () => {
  await withTempGitRepo(async (repo) => {
    await commitPolicy(repo, { enabled: true, dir: "./inside" });
    const result = await runCli([
      "run",
      "new",
      "--slug",
      "wt-inside",
      "--title",
      "Inside",
      "--json",
    ], repo);
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: { code: "validation", path: ".agent-relay.json:worktree.dir" },
    });
    const runs = await readdir(join(repo, ".agent-relay")).catch(() => []);
    expect(runs).toEqual([]);
  });
});

test("run new rejects committed policy with worktree.dir inside repo when enabled is false", async () => {
  await withTempGitRepo(async (repo) => {
    await commitPolicy(repo, { enabled: false, dir: "./inside" });
    const result = await runCli([
      "run",
      "new",
      "--slug",
      "wt-inside-off",
      "--title",
      "Inside",
      "--json",
    ], repo);
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: { code: "validation", path: ".agent-relay.json:worktree.dir" },
    });
    const runs = await readdir(join(repo, ".agent-relay")).catch(() => []);
    expect(runs).toEqual([]);
  });
});
