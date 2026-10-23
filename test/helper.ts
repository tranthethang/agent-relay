import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
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
  let hasTasks = false;
  try {
    const raw = await readFile(index, "utf8");
    const parsed = JSON.parse(raw) as { tasks?: unknown[] };
    hasTasks = Array.isArray(parsed.tasks) && parsed.tasks.length > 0;
  } catch {
    hasTasks = false;
  }
  if (!hasTasks) await writeReadyPlan(runPath);
  await ensurePlanReady(runPath);
  for (
    const args of [
      ["approve", runPath, "--via", "arg"],
      ["stage", "start", runPath, "implement", "--tool", "cursor"],
      ["task", "skip", runPath, "T1", "--reason", "review fixture"],
      ["stage", "done", runPath, "implement", "--tool", "cursor"],
    ]
  ) {
    const result = await runCli(args, cwd);
    if (result.code !== 0) throw new Error(`${args.join(" ")}: ${result.stderr}`);
  }
}

// A complete one-task plan that `atry approve` accepts.
export async function writeReadyPlan(runPath: string): Promise<void> {
  const plan = join(runPath, "10-plan");
  await mkdir(plan, { recursive: true });
  await writeFile(
    join(plan, "overview.md"),
    "# Overview\n\n## Goal\n\nShip the review path.\n\n## Non-goals\n\nNothing else.\n\n## Constraints\n\nKeep it small.\n",
  );
  await writeFile(
    join(plan, "T1.md"),
    "# T1: One\n\n## Detail\n\nDo the task.\n\n## Acceptance\n\n- It works.\n",
  );
  await writeFile(
    join(plan, "index.json"),
    `${
      JSON.stringify({
        schema: 1,
        tasks: [{ id: "T1", title: "One", deps: [], files: ["src/one.ts"], path: "10-plan/T1.md" }],
      })
    }\n`,
  );
}

// Fill an empty Detail or Acceptance section so the plan passes the approval gate.
export async function ensurePlanReady(runPath: string): Promise<void> {
  await ensureOverview(runPath);
  let raw: string;
  try {
    raw = await readFile(join(runPath, "10-plan", "index.json"), "utf8");
  } catch {
    return;
  }
  let parsed: { tasks?: { id?: string; title?: string; path?: string }[] };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return;
  }
  for (const task of parsed.tasks ?? []) {
    if (task.id === undefined) continue;
    const rel = task.path ?? `10-plan/${task.id}.md`;
    const file = join(runPath, rel);
    let text = "";
    try {
      text = await readFile(file, "utf8");
    } catch {
      text = "";
    }
    const detail = section(text, "Detail");
    const acceptance = section(text, "Acceptance");
    if (detail !== "" && acceptance !== "") continue;
    await writeFile(
      file,
      `# ${task.id}: ${task.title ?? task.id}\n\n## Detail\n\n${
        detail === "" ? "Do the task." : detail
      }\n\n## Acceptance\n\n${acceptance === "" ? "- It works." : acceptance}\n`,
    );
  }
}

async function ensureOverview(runPath: string): Promise<void> {
  const file = join(runPath, "10-plan", "overview.md");
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch {
    text = "";
  }
  if (section(text, "Goal") !== "") return;
  await mkdir(join(runPath, "10-plan"), { recursive: true });
  const rest = text.replace(/^# Overview\s*/, "").trim();
  await writeFile(
    file,
    `# Overview\n\n## Goal\n\nShip the plan.\n\n${rest === "" ? "" : `${rest}\n`}`,
  );
}

function section(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const start = lines.indexOf(`## ${heading}`);
  if (start === -1) return "";
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    body.push(line);
  }
  return body.join("\n").trim();
}
