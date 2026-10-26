import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import type { EventPair } from "./trajectory.ts";

const execFileAsync = promisify(execFile);

export const cliPath = fileURLToPath(new URL("../../dist/atry.js", import.meta.url));
export const scenariosPath = fileURLToPath(new URL("./scenarios.json", import.meta.url));

const pair = z.object({ stage: z.string().min(1), action: z.string().min(1) });

export const fixtureKinds = ["clean", "small-file", "approved-two-tasks", "implemented"] as const;
export type FixtureKind = (typeof fixtureKinds)[number];

export const scenarioFileSchema = z.object({
  schema: z.literal(1),
  scenarios: z.array(z.object({
    name: z.string().min(1),
    skill: z.string().min(1),
    prompt: z.string().min(1),
    fixture: z.enum(fixtureKinds),
    required: z.array(pair),
    forbidden: z.array(pair),
    fileCheck: z.enum(["none", "clean-tree", "brainstorm-notes"]),
  })).min(1),
});

export type Scenario = z.infer<typeof scenarioFileSchema>["scenarios"][number];

export function parseScenarios(text: string): Scenario[] {
  return scenarioFileSchema.parse(JSON.parse(text)).scenarios;
}

export async function loadScenarios(path = scenariosPath): Promise<Scenario[]> {
  return parseScenarios(await readFile(path, "utf8"));
}

export type Fixture = {
  repo: string;
  // Empty for a fixture that holds no run.
  runPath: string;
  env: NodeJS.ProcessEnv;
  cleanup: () => Promise<void>;
};

const overview = `# Overview

## Goal

Add two note files.

## Non-goals

Nothing else.

## Constraints

Keep each file to one line.
`;

function taskText(title: string, detail: string): string {
  return `# ${title}\n\n## Detail\n\n${detail}\n\n## Acceptance\n\n- The file exists and holds one line.\n`;
}

async function exec(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const { stdout } = await execFileAsync(command, args, { cwd, env });
  return stdout;
}

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

async function atry(repo: string, env: NodeJS.ProcessEnv, args: string[]): Promise<string> {
  return exec(process.execPath, [cliPath, ...args], repo, env);
}

async function commitAll(repo: string, env: NodeJS.ProcessEnv, message: string): Promise<void> {
  await exec("git", ["add", "-A"], repo, env);
  await exec("git", ["commit", "--allow-empty", "-m", message], repo, env);
}

async function planTwoTasks(repo: string, env: NodeJS.ProcessEnv): Promise<string> {
  const created = JSON.parse(
    await atry(repo, env, ["run", "new", "--slug", "notes", "--title", "Add notes", "--json"]),
  ) as { path: string };
  const plan = join(created.path, "10-plan");
  const tasks = [
    { title: "Add note a", deps: [], files: ["notes/a.txt"] },
    { title: "Add note b", deps: [], files: ["notes/b.txt"] },
  ];
  await write(join(plan, "overview.md"), overview);
  await write(join(plan, "tasks.input.json"), `${JSON.stringify({ schema: 1, tasks })}\n`);
  await atry(repo, env, ["plan", "done", created.path]);
  await write(
    join(plan, "T1.md"),
    taskText("T1: Add note a", "Create `notes/a.txt` with the line `note a`."),
  );
  await write(
    join(plan, "T2.md"),
    taskText("T2: Add note b", "Create `notes/b.txt` with the line `note b`."),
  );
  await atry(repo, env, ["approve", created.path, "--via", "arg"]);
  return created.path;
}

async function implementBySkipping(
  repo: string,
  env: NodeJS.ProcessEnv,
  run: string,
): Promise<void> {
  await atry(repo, env, ["stage", "start", run, "implement", "--tool", "unknown"]);
  for (const task of ["T1", "T2"]) {
    await atry(repo, env, ["task", "skip", run, task, "--reason", "fixture"]);
  }
  await atry(repo, env, ["stage", "done", run, "implement", "--tool", "unknown"]);
}

// Builds a fixture without a model call. The CLI runs from dist/atry.js with ATRY_DEV=1.
export async function createFixture(kind: FixtureKind): Promise<Fixture> {
  const repo = await realpath(await mkdtemp(join(tmpdir(), "atry-model-")));
  const env: NodeJS.ProcessEnv = { ...process.env, ATRY_DEV: "1" };
  const cleanup = () => rm(repo, { recursive: true, force: true });
  try {
    await exec("git", ["init", "-b", "main"], repo, env);
    await exec("git", ["config", "user.email", "eval@example.com"], repo, env);
    await exec("git", ["config", "user.name", "eval"], repo, env);
    await exec("git", ["config", "core.autocrlf", "false"], repo, env);
    await write(join(repo, "README.md"), "# fixture\n");
    if (kind === "small-file") {
      await write(join(repo, "src", "greet.ts"), "export const hello = () => \"hello\";\n");
    }
    await commitAll(repo, env, "init");
    let runPath = "";
    if (kind === "approved-two-tasks" || kind === "implemented") {
      runPath = await planTwoTasks(repo, env);
      if (kind === "implemented") await implementBySkipping(repo, env, runPath);
      await commitAll(repo, env, "fixture run");
    }
    return { repo, runPath, env, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

// The eval runs with --experimental-strip-types and cannot import `src/`, so it checks
// `open.json` with its own small schema.
const brainstormOpenSchema = z.object({ schema: z.literal(1), open: z.array(z.unknown()) });

const brainstormDirPattern = /^\d{8}-[a-z0-9]+(-[a-z0-9]+)*$/;

async function brainstormNotesFailures(repo: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(join(repo, ".agent-relay", "brainstorms"));
  } catch {
    names = [];
  }
  const dirs = names.filter((name) => brainstormDirPattern.test(name));
  if (dirs.length !== 1) {
    return [`expected one brainstorm directory, found ${dirs.length}`];
  }
  const rel = join(".agent-relay", "brainstorms", dirs[0] ?? "", "open.json");
  try {
    brainstormOpenSchema.parse(JSON.parse(await readFile(join(repo, rel), "utf8")));
  } catch {
    return [`${rel} is missing or is not a valid open.json`];
  }
  return [];
}

export async function fileCheckFailures(
  fixture: Pick<Fixture, "repo" | "env">,
  fileCheck: Scenario["fileCheck"],
): Promise<string[]> {
  if (fileCheck === "none") return [];
  if (fileCheck === "clean-tree") {
    const status = await exec("git", ["status", "--porcelain"], fixture.repo, fixture.env);
    return status.trim() === "" ? [] : [`tree is not clean:\n${status.trimEnd()}`];
  }
  const outside = await exec(
    "git",
    ["status", "--porcelain", "--", ".", ":(exclude).agent-relay"],
    fixture.repo,
    fixture.env,
  );
  const failures = outside.trim() === ""
    ? []
    : [`tree is not clean outside .agent-relay:\n${outside.trimEnd()}`];
  return [...failures, ...await brainstormNotesFailures(fixture.repo)];
}

export function scenarioPrompt(scenario: Scenario, runPath: string): string {
  return scenario.prompt.replaceAll("{run}", runPath);
}

export type RequiredPairs = EventPair[];
