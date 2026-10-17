import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const cliPath = fileURLToPath(new URL("../dist/atry.js", import.meta.url));

export type CliResult = {
  stdout: string;
  stderr: string;
  code: number;
};

export function runCli(args: string[], cwd: string): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

export async function withTempGitRepo<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const parent = join(fileURLToPath(new URL("..", import.meta.url)), ".tmp-test");
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, "atry-"));
  try {
    await execFileAsync("git", ["init"], { cwd: dir });
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
