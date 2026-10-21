import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { RelayError } from "./error.js";

export function gitProgramFor(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? String.raw`C:\Program Files\Git\cmd\git.exe` : "/usr/bin/git";
}

export const gitProgram = gitProgramFor();

export type DiffSize = {
  files: number;
  added: number;
  deleted: number;
};

export async function gitRoot(cwd: string): Promise<string> {
  try {
    return (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
  } catch {
    throw new RelayError("not_found", "git root not found", "base");
  }
}

export async function gitHead(cwd: string): Promise<string> {
  let head: string;
  try {
    head = (await git(cwd, ["rev-parse", "HEAD"])).trim();
  } catch {
    throw new RelayError("validation", "git HEAD not found", "base");
  }
  if (head.length === 0) throw new RelayError("validation", "git HEAD not found", "base");
  return head;
}

// Run artifacts under .agent-relay/ are not part of the change.
const outsideRuns = [".", ":(exclude).agent-relay"];

export async function workTree(cwd: string): Promise<string> {
  let root: string;
  let indexPath: string;
  try {
    root = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
    indexPath = resolve(root, (await git(root, ["rev-parse", "--git-path", "index"])).trim());
  } catch {
    throw new RelayError("validation", "git index not found", "base");
  }
  const tempDir = await mkdtemp(join(tmpdir(), "atry-index-"));
  const tempIndex = join(tempDir, "index");
  try {
    const env = { ...process.env, GIT_INDEX_FILE: tempIndex };
    try {
      await copyFile(indexPath, tempIndex);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    // `git add -A` errors when `.agent-relay` is ignored. `git add -A -f` also
    // hashes other ignored files, so update tracked paths and add untracked
    // paths that are not ignored.
    const tracked = await git(root, ["ls-files", "-z"], env);
    if (tracked.length > 0) await git(root, ["add", "-u", "--", ...outsideRuns], env);
    const untracked = await git(root, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ...outsideRuns,
    ], env);
    if (untracked.length > 0) {
      await git(
        root,
        ["add", "--pathspec-from-file=-", "--pathspec-file-nul", "--"],
        env,
        untracked,
      );
    }
    return (await git(root, ["write-tree"], env)).trim();
  } catch {
    throw new RelayError("validation", "git working tree hash failed", "base");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

// Changes outside .agent-relay/, staged or not, plus untracked files that are not ignored.
export async function treeStatus(cwd: string): Promise<string> {
  try {
    const root = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
    return await git(root, ["status", "--porcelain", "--", ...outsideRuns]);
  } catch {
    throw new RelayError("validation", "git status failed", "tree");
  }
}

export async function changedPaths(cwd: string, from: string, to: string): Promise<string[]> {
  let text: string;
  try {
    text = await git(cwd, ["diff", "--name-only", "--no-renames", "-z", from, to]);
  } catch {
    throw new RelayError("validation", "git diff failed", "base");
  }
  return text.split("\0").filter((name) => name.length > 0);
}

export async function treeDiffSize(cwd: string, from: string, to: string): Promise<DiffSize> {
  let text: string;
  try {
    text = await git(cwd, ["diff", "--numstat", from, to]);
  } catch {
    throw new RelayError("validation", "git diff failed", "base");
  }
  let files = 0;
  let added = 0;
  let deleted = 0;
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    const [add, del] = line.split("\t");
    files += 1;
    added += count(add);
    deleted += count(del);
  }
  return { files, added, deleted };
}

export async function diffSize(
  cwd: string,
  base: string,
  ..._previousHead: string[]
): Promise<DiffSize> {
  let text: string;
  let untracked: string;
  let root: string;
  try {
    root = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
    text = await git(root, ["diff", "--numstat", base, "--", ...outsideRuns]);
    untracked = await git(root, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ...outsideRuns,
    ]);
  } catch {
    throw new RelayError("validation", "git diff failed", "base");
  }
  let files = 0;
  let added = 0;
  let deleted = 0;
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    const [add, del] = line.split("\t");
    files += 1;
    added += count(add);
    deleted += count(del);
  }
  for (const name of untracked.split("\0")) {
    if (name.length === 0) continue;
    files += 1;
    added += await lineCount(root, name);
  }
  return { files, added, deleted };
}

async function lineCount(cwd: string, name: string): Promise<number> {
  let body: Buffer;
  try {
    body = await readFile(join(cwd, name));
  } catch {
    return 0;
  }
  if (body.includes(0) || body.length === 0) return 0;
  let lines = 0;
  for (const byte of body) {
    if (byte === 10) lines += 1;
  }
  if (body.at(-1) !== 10) lines += 1;
  return lines;
}

function count(value: string | undefined): number {
  if (value === undefined || !/^\d+$/.test(value)) return 0;
  return Number(value);
}

function git(
  cwd: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
  input?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      gitProgram,
      args,
      { cwd, ...(env === undefined ? {} : { env }) },
      (error, stdout) => {
        if (error === null) {
          resolve(stdout);
          return;
        }
        reject(error instanceof Error ? error : new Error("git failed"));
      },
    );
    if (input !== undefined) child.stdin?.end(input);
  });
}
