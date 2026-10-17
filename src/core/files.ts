import { randomBytes } from "node:crypto";
import { appendFile, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { RelayError } from "./error.js";

export function isEnoent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function joinUnder(root: string, ...parts: string[]): string {
  const base = resolve(root);
  const target = resolve(base, ...parts);
  const rel = relative(base, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new RelayError("validation", "path escapes the root", parts.join("/"));
  }
  return target;
}

export async function atomicWrite(filePath: string, contents: string): Promise<void> {
  const tmp = join(
    dirname(filePath),
    `.${basename(filePath)}.${randomBytes(8).toString("hex")}.tmp`,
  );
  try {
    await writeFile(tmp, contents, "utf8");
    await replaceFile(tmp, filePath);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}

const renameRetryCodes = new Set(["EPERM", "EACCES", "EBUSY"]);
const renameRetryDelaysMs = [10, 50, 100, 200, 400];

// Windows can refuse a rename while another process holds the target open.
// Retry; never delete the target, so a failed write keeps the old file.
async function replaceFile(tmp: string, filePath: string): Promise<void> {
  for (let attempt = 0;; attempt += 1) {
    try {
      await rename(tmp, filePath);
      return;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      const delay = renameRetryDelaysMs[attempt];
      if (!renameRetryCodes.has(code) || delay === undefined) throw error;
      await sleep(delay);
    }
  }
}

export async function appendJsonl(filePath: string, line: string): Promise<void> {
  if (line.length === 0 || line.includes("\n") || line.includes("\r")) {
    throw new RelayError("validation", "jsonl line must be one line", filePath);
  }
  await appendFile(filePath, `${line}\n`, { encoding: "utf8", flag: "a" });
}

export async function readText(filePath: string): Promise<string> {
  const raw = await readFile(filePath);
  return raw.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export async function readJson(filePath: string): Promise<unknown> {
  const text = await readText(filePath);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RelayError("validation", "invalid JSON", filePath);
  }
}

export async function readJsonl(filePath: string): Promise<unknown[]> {
  const text = await readText(filePath);
  if (text.length === 0) return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.map((line, index) => {
    if (line.length === 0) {
      throw new RelayError("validation", "invalid JSON", `${filePath}:lines[${index}]`);
    }
    try {
      return JSON.parse(line) as unknown;
    } catch {
      throw new RelayError("validation", "invalid JSON", `${filePath}:lines[${index}]`);
    }
  });
}
