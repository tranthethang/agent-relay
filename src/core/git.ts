import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RelayError } from "./error.js";

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
  try {
    const head = (await git(cwd, ["rev-parse", "HEAD"])).trim();
    if (head.length === 0) throw new Error("empty");
    return head;
  } catch (error) {
    if (error instanceof RelayError) throw error;
    throw new RelayError("validation", "git HEAD not found", "base");
  }
}

// Run artifacts under .agent-relay/ are not part of the change.
const outsideRuns = [".", ":(exclude).agent-relay"];

export async function diffSize(cwd: string, base: string, head: string): Promise<DiffSize> {
  void head;
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
  if (body[body.length - 1] !== 10) lines += 1;
  return lines;
}

function count(value: string | undefined): number {
  if (value === undefined || !/^[0-9]+$/.test(value)) return 0;
  return Number(value);
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd }, (error, stdout) => {
      if (error !== null) reject(error);
      else resolve(stdout);
    });
  });
}
