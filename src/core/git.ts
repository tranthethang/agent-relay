import { execFile } from "node:child_process";
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

export async function diffSize(cwd: string, base: string, head: string): Promise<DiffSize> {
  let text: string;
  try {
    text = await git(cwd, ["diff", "--numstat", base, head]);
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
