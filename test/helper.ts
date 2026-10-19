import { execFile, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
      // Inherit NODE_V8_COVERAGE so a spawned dist/atry.js is part of the coverage run.
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

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  // Windows tmpdir() can be an 8.3 short path; the CLI reports the long one.
  const dir = await realpath(await mkdtemp(join(tmpdir(), "atry-")));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

export function gitCommit(cwd: string, message = "init"): Promise<unknown> {
  return execFileAsync(
    "git",
    [
      "-c",
      "user.email=test@example.com",
      "-c",
      "user.name=test",
      "commit",
      "--allow-empty",
      "-m",
      message,
    ],
    { cwd },
  );
}

export async function reachReview(runPath: string, cwd: string): Promise<void> {
  const index = join(runPath, "10-plan", "index.json");
  try {
    await access(index);
  } catch {
    await mkdir(join(runPath, "10-plan"), { recursive: true });
    await writeFile(index, `${JSON.stringify({ schema: 1, tasks: [] })}\n`);
  }
  for (
    const args of [
      ["approve", runPath, "--via", "arg"],
      ["stage", "start", runPath, "implement", "--tool", "cursor"],
      ["stage", "done", runPath, "implement", "--tool", "cursor"],
    ]
  ) {
    const result = await runCli(args, cwd);
    if (result.code !== 0) throw new Error(`${args.join(" ")}: ${result.stderr}`);
  }
}
