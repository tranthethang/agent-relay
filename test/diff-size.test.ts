import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { diffSize } from "../src/core/git.js";
import { gitCommit, withTempGitRepo } from "./helper.js";

const execFileAsync = promisify(execFile);

async function rev(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd });
  return stdout.trim();
}

test("diffSize counts a committed change against base", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const base = await rev(dir);
    await writeFile(join(dir, "note.txt"), "one\n");
    await execFileAsync("git", ["add", "note.txt"], { cwd: dir });
    await gitCommit(dir, "add note");
    const size = await diffSize(dir, base, await rev(dir));
    expect(size).toEqual({ files: 1, added: 1, deleted: 0 });
  });
});

test("diffSize counts an uncommitted change to a tracked file", async () => {
  await withTempGitRepo(async (dir) => {
    await writeFile(join(dir, "note.txt"), "one\n");
    await execFileAsync("git", ["add", "note.txt"], { cwd: dir });
    await gitCommit(dir, "add note");
    const base = await rev(dir);
    await writeFile(join(dir, "note.txt"), "one\ntwo\n");
    const size = await diffSize(dir, base, base);
    expect(size).toEqual({ files: 1, added: 1, deleted: 0 });
  });
});

test("diffSize counts an untracked file and skips an ignored file", async () => {
  await withTempGitRepo(async (dir) => {
    await writeFile(join(dir, ".gitignore"), "skip.txt\n");
    await execFileAsync("git", ["add", ".gitignore"], { cwd: dir });
    await gitCommit(dir, "ignore");
    const base = await rev(dir);
    await writeFile(join(dir, "skip.txt"), "secret\n");
    await writeFile(join(dir, "new.txt"), "a\nb\n");
    const size = await diffSize(dir, base, base);
    expect(size).toEqual({ files: 1, added: 2, deleted: 0 });
  });
});

test("diffSize counts a binary untracked file as zero lines", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const base = await rev(dir);
    await writeFile(join(dir, "blob.bin"), Buffer.from([0, 1, 2, 255]));
    const size = await diffSize(dir, base, base);
    expect(size).toEqual({ files: 1, added: 0, deleted: 0 });
  });
});

test("diffSize counts untracked files when called from a subdirectory", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const base = await rev(dir);
    await mkdir(join(dir, "sub"));
    await writeFile(join(dir, "top.txt"), "a\nb\n");
    const size = await diffSize(join(dir, "sub"), base, base);
    expect(size).toEqual({ files: 1, added: 2, deleted: 0 });
  });
});

test("diffSize skips tracked and untracked files under .agent-relay", async () => {
  await withTempGitRepo(async (dir) => {
    await mkdir(join(dir, ".agent-relay", "run"), { recursive: true });
    await writeFile(join(dir, ".agent-relay", "run", "events.jsonl"), "one\n");
    await execFileAsync("git", ["add", "-f", ".agent-relay"], { cwd: dir });
    await gitCommit(dir, "add run");
    const base = await rev(dir);
    await writeFile(join(dir, ".agent-relay", "run", "events.jsonl"), "one\ntwo\n");
    await writeFile(join(dir, ".agent-relay", "run", "notes.md"), "a\nb\n");
    await writeFile(join(dir, "note.txt"), "one\n");
    const size = await diffSize(join(dir, ".agent-relay", "run"), base, base);
    expect(size).toEqual({ files: 1, added: 1, deleted: 0 });
  });
});
