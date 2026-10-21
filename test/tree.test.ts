import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { changedPaths, workTree } from "../src/core/git.js";
import { gitCommit, withTempGitRepo } from "./helper.js";

const execFileAsync = promisify(execFile);

test("workTree hashes untracked files without changing the real index", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const indexPath = join(dir, ".git", "index");
    const before = await readFile(indexPath);
    await writeFile(join(dir, "new.txt"), "new file\n");
    const tree = await workTree(dir);
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD^{tree}"], { cwd: dir });
    expect(tree).not.toBe(stdout.trim());
    expect(await readFile(indexPath)).toEqual(before);
  });
});

test("workTree ignores gitignored files outside .agent-relay", async () => {
  await withTempGitRepo(async (dir) => {
    await writeFile(join(dir, ".gitignore"), "ignored.txt\n");
    await execFileAsync("git", ["add", ".gitignore"], { cwd: dir });
    await gitCommit(dir);
    const before = await workTree(dir);
    await writeFile(join(dir, "ignored.txt"), "secret\n");
    expect(await workTree(dir)).toBe(before);
  });
});

test("workTree ignores changes under .agent-relay", async () => {
  await withTempGitRepo(async (dir) => {
    await mkdir(join(dir, ".agent-relay", "run"), { recursive: true });
    await writeFile(join(dir, ".agent-relay", "run", "events.jsonl"), "before\n");
    await execFileAsync("git", ["add", "-f", ".agent-relay"], { cwd: dir });
    await gitCommit(dir);
    const before = await workTree(dir);
    await writeFile(join(dir, ".agent-relay", "run", "events.jsonl"), "after\n");
    expect(await workTree(dir)).toBe(before);
  });
});

test("workTree stores an edited file outside the repo object directory", async () => {
  await withTempGitRepo(async (dir) => {
    await writeFile(join(dir, "tracked.txt"), "one\n");
    await execFileAsync("git", ["add", "tracked.txt"], { cwd: dir });
    await gitCommit(dir);
    await writeFile(join(dir, "tracked.txt"), "two\nextra\n");
    const tree = await workTree(dir);
    const repoObjects = resolve(
      dir,
      (await execFileAsync("git", ["rev-parse", "--git-path", "objects"], { cwd: dir })).stdout
        .trim(),
    );
    const stored = join(dir, ".agent-relay", "objects", tree.slice(0, 2), tree.slice(2));
    await expect(readFile(stored)).resolves.toBeInstanceOf(Buffer);
    await expect(readFile(join(repoObjects, tree.slice(0, 2), tree.slice(2)))).rejects.toThrow();
    expect(await changedPaths(dir, "HEAD", tree)).toContain("tracked.txt");
  });
});

test("workTree appends a preset alternate object directory", async () => {
  await withTempGitRepo(async (dir) => {
    await writeFile(join(dir, "tracked.txt"), "one\n");
    await execFileAsync("git", ["add", "tracked.txt"], { cwd: dir });
    await gitCommit(dir);
    const repoObjects = resolve(
      dir,
      (await execFileAsync("git", ["rev-parse", "--git-path", "objects"], { cwd: dir })).stdout
        .trim(),
    );
    const previous = process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
    process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES = repoObjects;
    try {
      await writeFile(join(dir, "tracked.txt"), "two\nextra\n");
      const tree = await workTree(dir);
      const stored = join(dir, ".agent-relay", "objects", tree.slice(0, 2), tree.slice(2));
      await expect(readFile(stored)).resolves.toBeInstanceOf(Buffer);
      expect(await changedPaths(dir, "HEAD", tree)).toContain("tracked.txt");
    } finally {
      if (previous === undefined) delete process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
      else process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES = previous;
    }
  });
});

test("changedPaths lists both sides of a rename", async () => {
  await withTempGitRepo(async (dir) => {
    await writeFile(join(dir, "old.txt"), "content that is long enough to match\n".repeat(5));
    await execFileAsync("git", ["add", "old.txt"], { cwd: dir });
    await gitCommit(dir);
    const before = await workTree(dir);
    await execFileAsync("git", ["mv", "old.txt", "new.txt"], { cwd: dir });
    const paths = await changedPaths(dir, before, await workTree(dir));
    expect(paths.sort()).toEqual(["new.txt", "old.txt"]);
  });
});
