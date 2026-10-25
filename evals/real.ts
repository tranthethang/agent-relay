// Behavioral eval layer that drives the real CLI.
//
// Usage:
//   node --experimental-strip-types evals/real.ts [--scenario NAME] [--drift]
//
// Each scenario creates a temporary git repository and a temporary HOME. It
// runs `node dist/atry.js` with `ATRY_DEV=1`. It asserts exit codes, JSON
// fields, file contents, and git state. It never calls a model and never uses
// the network.
//
// `--drift` flips one recorded expectation on purpose. The harness must then
// fail, which shows that a behavior drift is caught.

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = join(here, "..", "dist", "atry.js");

type Cmd = { code: number; stdout: string; stderr: string };

type Check = { failures: string[]; steps: number };

type Context = {
  repo: string;
  home: string;
  env: NodeJS.ProcessEnv;
  drift: boolean;
  root: string;
};

export type RealResult = {
  scenario: string;
  steps: number;
  failures: string[];
};

type Scenario = {
  name: string;
  summary: string;
  run: (check: Check, ctx: Context) => Promise<void>;
};

class ScenarioStop extends Error {}

const readyOverview = `# Overview

## Goal

Ship the eval fixture.

## Non-goals

Nothing else.

## Decisions

Use one task.

## Constraints

Stay small.
`;

function taskText(title: string): string {
  return `# ${title}\n\n## Detail\n\nDo the task.\n\n## Acceptance\n\n- It works.\n`;
}

function exec(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<Cmd> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { cwd, env, encoding: "utf8", windowsHide: true },
      (error, stdout, stderr) => {
        const code = error === null
          ? 0
          : typeof error.code === "number"
          ? error.code
          : 1;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

function oneLine(text: string): string {
  return text.trim().replace(/\s+/g, " ").slice(0, 200);
}

function expectExit(check: Check, cmd: Cmd, expected: number, label: string): void {
  if (cmd.code === expected) return;
  check.failures.push(
    `${label}: exit ${cmd.code} does not match ${expected} (${oneLine(cmd.stderr)})`,
  );
  throw new ScenarioStop();
}

function expectText(check: Check, cmd: Cmd, needle: string, label: string): void {
  const haystack = `${cmd.stdout}\n${cmd.stderr}`;
  if (haystack.includes(needle)) return;
  check.failures.push(`${label}: output does not contain "${needle}"`);
}

function parseJson(check: Check, cmd: Cmd, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(cmd.stdout);
  } catch {
    check.failures.push(`${label}: stdout is not JSON`);
    throw new ScenarioStop();
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    check.failures.push(`${label}: stdout is not a JSON object`);
    throw new ScenarioStop();
  }
  return value as Record<string, unknown>;
}

function expectField(
  check: Check,
  value: Record<string, unknown>,
  field: string,
  expected: unknown,
  label: string,
): void {
  const actual = value[field];
  if (JSON.stringify(actual) === JSON.stringify(expected)) return;
  check.failures.push(
    `${label}: ${field} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
  );
}

function textField(
  check: Check,
  value: Record<string, unknown>,
  field: string,
  label: string,
): string {
  const actual = value[field];
  if (typeof actual === "string" && actual.length > 0) return actual;
  check.failures.push(`${label}: ${field} is not a non-empty string`);
  throw new ScenarioStop();
}

async function cli(check: Check, ctx: Context, args: string[]): Promise<Cmd> {
  check.steps += 1;
  return exec(process.execPath, [cliPath, ...args], ctx.repo, ctx.env);
}

async function git(ctx: Context, args: string[], cwd = ctx.repo): Promise<string> {
  const result = await exec(
    "git",
    ["-c", "user.email=eval@example.com", "-c", "user.name=eval", ...args],
    cwd,
    ctx.env,
  );
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${oneLine(result.stderr)}`);
  }
  return result.stdout;
}

async function commitAll(ctx: Context, message: string, cwd = ctx.repo): Promise<void> {
  await git(ctx, ["add", "-A"], cwd);
  await git(ctx, ["commit", "-m", message], cwd);
}

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

async function newRun(check: Check, ctx: Context, slug: string): Promise<string> {
  const result = await cli(check, ctx, ["run", "new", "--slug", slug, "--title", slug, "--json"]);
  expectExit(check, result, 0, `run new ${slug}`);
  return textField(check, parseJson(check, result, `run new ${slug}`), "path", `run new ${slug}`);
}

// The run worktree holds the change when the policy enables one. With the
// policy off, the change lands in the main repository.
async function runTree(ctx: Context, runPath: string): Promise<string> {
  const value = JSON.parse(await readFile(join(runPath, "run.json"), "utf8")) as {
    worktree?: { path?: unknown };
  };
  return typeof value.worktree?.path === "string" ? value.worktree.path : ctx.repo;
}

async function writePlan(
  check: Check,
  ctx: Context,
  runPath: string,
  taskFiles: string[][],
): Promise<void> {
  const plan = join(runPath, "10-plan");
  const tasks = taskFiles.map((files, index) => ({
    title: `Task ${index + 1}`,
    deps: [],
    files,
  }));
  await write(join(plan, "overview.md"), readyOverview);
  await write(join(plan, "tasks.input.json"), `${JSON.stringify({ schema: 1, tasks })}\n`);
  expectExit(check, await cli(check, ctx, ["plan", "done", runPath]), 0, "plan done");
  for (let index = 0; index < taskFiles.length; index += 1) {
    await write(join(plan, `T${index + 1}.md`), taskText(`T${index + 1}: Task ${index + 1}`));
  }
}

async function approveAndImplement(check: Check, ctx: Context, runPath: string): Promise<void> {
  expectExit(
    check,
    await cli(check, ctx, ["approve", runPath, "--via", "arg"]),
    0,
    "approve",
  );
  expectExit(
    check,
    await cli(check, ctx, ["stage", "start", runPath, "implement", "--tool", "cursor"]),
    0,
    "stage start implement",
  );
}

async function reachReview(check: Check, ctx: Context, runPath: string): Promise<void> {
  await writePlan(check, ctx, runPath, [["notes.txt"]]);
  await approveAndImplement(check, ctx, runPath);
  expectExit(
    check,
    await cli(check, ctx, ["task", "skip", runPath, "T1", "--reason", "eval fixture"]),
    0,
    "task skip",
  );
  expectExit(
    check,
    await cli(check, ctx, ["stage", "done", runPath, "implement", "--tool", "cursor"]),
    0,
    "stage done implement",
  );
}

async function writeReviewPair(
  check: Check,
  started: Record<string, unknown>,
  kind: "self" | "cross",
  question: string | undefined,
  findings: { id: string; severity: string; status: string }[] = [],
): Promise<void> {
  const markdown = textField(check, started, "markdown", `review new ${kind}`);
  const jsonPath = textField(check, started, "json", `review new ${kind}`);
  const open = question === undefined ? [] : [{ q: question, a: "Stop", b: "Close anyway" }];
  const cards = question === undefined
    ? ""
    : `\n- Q1: ${question}\n  - a. Stop\n  - b. Close anyway\n`;
  const lines = findings.map((finding) => `\n- ${finding.id}: eval defect\n`).join("");
  await write(markdown, `# ${kind}\n\n## Findings\n${lines}${cards}\n## Acceptance\n`);
  await write(
    jsonPath,
    `${
      JSON.stringify({
        schema: 1,
        kind,
        tool: kind === "self" ? "cursor" : "codex",
        model: kind === "self" ? "unknown" : "gpt-5.4",
        findings: findings.map((finding) => ({
          ...finding,
          file: null,
          line: null,
          evidence: "eval fixture",
        })),
        open,
      })
    }\n`,
  );
}

async function planGate(check: Check, ctx: Context): Promise<void> {
  const runPath = await newRun(check, ctx, "real-plan");
  expectExit(
    check,
    await cli(check, ctx, ["stage", "start", runPath, "plan", "--tool", "cursor"]),
    0,
    "stage start plan",
  );
  expectExit(check, await cli(check, ctx, ["plan", "new", runPath]), 0, "plan new");
  await write(
    join(runPath, "10-plan", "tasks.input.json"),
    `${JSON.stringify({ schema: 1, tasks: [] })}\n`,
  );
  // A drift run expects the wrong exit code. The harness must fail.
  const empty = await cli(check, ctx, ["plan", "done", runPath]);
  expectExit(check, empty, ctx.drift ? 0 : 4, "plan done with no tasks");
  expectText(check, empty, "plan has no tasks", "plan done with no tasks");

  await write(
    join(runPath, "10-plan", "tasks.input.json"),
    `${
      JSON.stringify({
        schema: 1,
        tasks: [{ title: "One", deps: [], files: ["notes.txt"] }],
      })
    }\n`,
  );
  const done = await cli(check, ctx, ["plan", "done", runPath]);
  expectExit(check, done, 0, "plan done");
  const index = JSON.parse(
    await readFile(join(runPath, "10-plan", "index.json"), "utf8"),
  ) as { tasks?: { id?: string }[] };
  if (index.tasks?.[0]?.id !== "T1") {
    check.failures.push("plan done: index.json does not name T1");
  }

  const preview = await cli(check, ctx, ["approve", runPath, "--preview", "--json"]);
  expectExit(check, preview, 0, "approve preview");
  expectField(
    check,
    parseJson(check, preview, "approve preview"),
    "ready",
    false,
    "approve preview",
  );

  const refused = await cli(check, ctx, ["approve", runPath, "--via", "arg"]);
  expectExit(check, refused, 4, "approve an incomplete plan");
  expectText(check, refused, "plan is not ready", "approve an incomplete plan");
  expectExit(
    check,
    await cli(check, ctx, ["stage", "start", runPath, "implement", "--tool", "cursor"]),
    4,
    "stage start implement before approve",
  );

  await write(join(runPath, "10-plan", "overview.md"), readyOverview);
  await write(join(runPath, "10-plan", "T1.md"), taskText("T1: One"));
  const ready = await cli(check, ctx, ["approve", runPath, "--preview", "--json"]);
  expectExit(check, ready, 0, "approve preview after the fill");
  expectField(
    check,
    parseJson(check, ready, "approve preview"),
    "ready",
    true,
    "approve preview after the fill",
  );
  const approved = await cli(check, ctx, ["approve", runPath, "--via", "arg", "--json"]);
  expectExit(check, approved, 0, "approve");
  expectField(check, parseJson(check, approved, "approve"), "approved", true, "approve");
  expectExit(
    check,
    await cli(check, ctx, ["stage", "start", runPath, "implement", "--tool", "cursor"]),
    0,
    "stage start implement",
  );
}

async function worktreeFlow(check: Check, ctx: Context): Promise<void> {
  await write(
    join(ctx.repo, ".agent-relay.json"),
    `${
      JSON.stringify({
        schema: 1,
        requireReviews: ["self"],
        smallChange: 0,
        worktree: { enabled: true },
      })
    }\n`,
  );
  await commitAll(ctx, "policy");
  const runPath = await newRun(check, ctx, "real-worktree");
  await writePlan(check, ctx, runPath, [["a.txt"], ["b.txt"]]);
  await approveAndImplement(check, ctx, runPath);

  const claimed = await cli(check, ctx, ["claim", runPath, "T1", "--session", "eval", "--json"]);
  expectExit(check, claimed, 0, "claim T1");
  const taskTree = parseJson(check, claimed, "claim T1").worktree as { path?: unknown } | undefined;
  if (typeof taskTree?.path !== "string") {
    check.failures.push("claim T1: worktree.path is missing");
    throw new ScenarioStop();
  }
  const taskPath = taskTree.path;
  await write(join(taskPath, "a.txt"), "first\n");

  const dirtyDone = await cli(check, ctx, [
    "task",
    "done",
    runPath,
    "T1",
    "--session",
    "eval",
  ]);
  expectExit(check, dirtyDone, 4, "task done with an uncommitted worktree");
  expectText(check, dirtyDone, "uncommitted changes", "task done with an uncommitted worktree");

  await commitAll(ctx, "task one", taskPath);
  expectExit(
    check,
    await cli(check, ctx, ["task", "done", runPath, "T1", "--session", "eval"]),
    0,
    "task done after the commit",
  );
  const integrated = await cli(check, ctx, ["integrate", runPath, "T1", "--json"]);
  expectExit(check, integrated, 0, "integrate T1");
  expectField(check, parseJson(check, integrated, "integrate T1"), "merged", true, "integrate T1");
  const tree = await runTree(ctx, runPath);
  if ((await readFile(join(tree, "a.txt"), "utf8")) !== "first\n") {
    check.failures.push("integrate T1: a.txt is not in the run tree");
  }
  if (await fileExists(taskPath)) {
    check.failures.push("integrate T1: the task worktree still exists");
  }

  const second = await cli(check, ctx, ["claim", runPath, "T2", "--session", "eval-two", "--json"]);
  expectExit(check, second, 0, "claim T2");
  const secondTree = parseJson(check, second, "claim T2").worktree as
    | { path?: unknown }
    | undefined;
  if (typeof secondTree?.path !== "string") {
    check.failures.push("claim T2: worktree.path is missing");
    throw new ScenarioStop();
  }
  await write(join(secondTree.path, "b.txt"), "second\n");
  const dirtyMerge = await cli(check, ctx, ["integrate", runPath, "T2"]);
  expectExit(check, dirtyMerge, 4, "integrate a dirty worktree");
  expectText(check, dirtyMerge, "merged: no", "integrate a dirty worktree");
  if (await fileExists(join(tree, "b.txt"))) {
    check.failures.push("integrate a dirty worktree: b.txt reached the run tree");
  }
}

async function staleSkills(check: Check, ctx: Context): Promise<void> {
  const dir = join(ctx.home, "installed-skills");
  const install = await cli(check, ctx, [
    "skills",
    "install",
    "--tool",
    "claude-code",
    "--dir",
    dir,
    "--json",
  ]);
  expectExit(check, install, 0, "skills install");
  const bundles = parseJson(check, install, "skills install").bundles;
  const expected = (await import("node:fs/promises")).readdir(join(here, "..", "skills"));
  const names = (await expected).filter((name) => name.startsWith("atry-"));
  if (!Array.isArray(bundles) || bundles.length !== names.length) {
    check.failures.push(
      `skills install: ${JSON.stringify(bundles)} is not ${names.length} bundles`,
    );
  }

  const reference = join(dir, "atry-plan", "references", "writing.md");
  const text = await readFile(reference, "utf8");
  await writeFile(reference, `${text}\nchanged by the eval\n`);

  const stale = await cli(check, ctx, ["skills", "status", "--dir", dir, "--json"]);
  expectExit(check, stale, 1, "skills status after an edit");
  expectField(check, parseJson(check, stale, "skills status"), "ok", false, "skills status");
  expectText(check, stale, "stale", "skills status after an edit");

  const reinstall = await cli(check, ctx, [
    "skills",
    "install",
    "--tool",
    "claude-code",
    "--dir",
    dir,
    "--json",
  ]);
  expectExit(check, reinstall, 0, "skills install again");
  const status = await cli(check, ctx, ["skills", "status", "--dir", dir, "--json"]);
  expectExit(check, status, 0, "skills status after the reinstall");
  const result = parseJson(check, status, "skills status after the reinstall");
  expectField(check, result, "ok", true, "skills status after the reinstall");
  const dirs = result.dirs as { bundles?: { status?: string }[] }[] | undefined;
  const ok = dirs?.[0]?.bundles?.filter((row) => row.status === "ok").length ?? 0;
  if (ok !== names.length) {
    check.failures.push(`skills status: ${ok} ok rows, expected ${names.length}`);
  }
}

async function closeAck(check: Check, ctx: Context): Promise<void> {
  await write(
    join(ctx.repo, ".agent-relay.json"),
    `${JSON.stringify({ schema: 1, requireReviews: ["self"], smallChange: 0 })}\n`,
  );
  await commitAll(ctx, "policy");

  const openRun = await newRun(check, ctx, "real-close-open");
  await reachReview(check, ctx, openRun);
  const selfNew = await cli(check, ctx, [
    "review",
    "new",
    openRun,
    "self",
    "--tool",
    "cursor",
    "--json",
  ]);
  expectExit(check, selfNew, 0, "review new self");
  await writeReviewPair(
    check,
    parseJson(check, selfNew, "review new self"),
    "self",
    "Continue?",
  );
  expectExit(
    check,
    await cli(check, ctx, ["review", "done", openRun, "self"]),
    0,
    "review done self",
  );
  const unacked = await cli(check, ctx, [
    "close",
    openRun,
    "--via",
    "confirm",
    "--ack-warnings",
  ]);
  expectExit(check, unacked, 4, "soft close with an open question");
  expectText(
    check,
    unacked,
    "open: latest review has open questions",
    "soft close with an open question",
  );
  const opened = await cli(check, ctx, [
    "close",
    openRun,
    "--via",
    "confirm",
    "--ack-open",
    "--json",
  ]);
  expectExit(check, opened, 0, "soft close with --ack-open");
  expectField(check, parseJson(check, opened, "soft close"), "lifecycle", "closed", "soft close");

  const deltaRun = await newRun(check, ctx, "real-close-delta");
  await reachReview(check, ctx, deltaRun);
  expectExit(
    check,
    await cli(check, ctx, ["review", "new", deltaRun, "self", "--tool", "cursor"]),
    0,
    "review new self",
  );
  expectExit(
    check,
    await cli(check, ctx, ["review", "done", deltaRun, "self"]),
    0,
    "review done self",
  );
  expectExit(
    check,
    await cli(check, ctx, [
      "review",
      "new",
      deltaRun,
      "cross",
      "--tool",
      "codex",
      "--model",
      "gpt-5.4",
    ]),
    0,
    "review new cross",
  );
  await write(join(ctx.repo, "fix.txt"), "fixed during the review\n");
  expectExit(
    check,
    await cli(check, ctx, ["review", "done", deltaRun, "cross"]),
    0,
    "review done cross",
  );
  const blocked = await cli(check, ctx, [
    "close",
    deltaRun,
    "--via",
    "confirm",
    "--ack-warnings",
  ]);
  expectExit(check, blocked, 4, "soft close with a cross-review delta");
  expectText(check, blocked, "review.self", "soft close with a cross-review delta");
  expectText(check, blocked, "no later self-review", "soft close with a cross-review delta");

  expectExit(
    check,
    await cli(check, ctx, ["review", "new", deltaRun, "self", "--tool", "cursor"]),
    0,
    "review new self after the delta",
  );
  expectExit(
    check,
    await cli(check, ctx, ["review", "done", deltaRun, "self"]),
    0,
    "review done self after the delta",
  );
  const closed = await cli(check, ctx, ["close", deltaRun, "--via", "confirm", "--json"]);
  expectExit(check, closed, 0, "soft close after the later self-review");
  expectField(
    check,
    parseJson(check, closed, "soft close after the later self-review"),
    "lifecycle",
    "closed",
    "soft close after the later self-review",
  );
}

// The decision command runs exactly as the CLI printed it. The same command
// without its ack flags is refused, so the flags in `onYes` are required.
async function decisionClose(check: Check, ctx: Context): Promise<void> {
  await write(
    join(ctx.repo, ".agent-relay.json"),
    `${JSON.stringify({ schema: 1, requireReviews: ["self"], smallChange: 0 })}\n`,
  );
  await commitAll(ctx, "policy");
  const run = await newRun(check, ctx, "real-decision-close");
  await reachReview(check, ctx, run);
  const selfNew = await cli(check, ctx, [
    "review",
    "new",
    run,
    "self",
    "--tool",
    "cursor",
    "--json",
  ]);
  expectExit(check, selfNew, 0, "review new self");
  await writeReviewPair(check, parseJson(check, selfNew, "review new self"), "self", "Continue?");
  expectExit(check, await cli(check, ctx, ["review", "done", run, "self"]), 0, "review done self");

  const preview = await cli(check, ctx, ["close", run, "--preview", "--json"]);
  expectExit(check, preview, 0, "close preview");
  const decision = parseJson(check, preview, "close preview").decision as
    | { onYes?: string | null }
    | undefined;
  const onYes = decision?.onYes;
  if (typeof onYes !== "string") {
    check.failures.push("close preview: decision.onYes is not a command");
    return;
  }
  const args = onYes.split(" ").slice(1);
  const stripped = args.filter((arg) => arg !== "--ack-open" && arg !== "--ack-warnings");
  const refused = await cli(check, ctx, stripped);
  expectExit(check, refused, 4, "decision command without its ack flags");
  const closed = await cli(check, ctx, [...args, "--json"]);
  expectExit(check, closed, 0, "decision.onYes as given");
  expectField(check, parseJson(check, closed, "decision close"), "lifecycle", "closed", "decision");
}

// An open high finding refuses close with exit 4. A later review that sets it fixed lets close pass.
async function highFindingGate(check: Check, ctx: Context): Promise<void> {
  await write(
    join(ctx.repo, ".agent-relay.json"),
    `${JSON.stringify({ schema: 1, requireReviews: ["self"], smallChange: 0 })}\n`,
  );
  await commitAll(ctx, "policy");
  const run = await newRun(check, ctx, "real-high-finding");
  await reachReview(check, ctx, run);
  const round = async (status: string): Promise<void> => {
    const started = await cli(check, ctx, [
      "review",
      "new",
      run,
      "self",
      "--tool",
      "cursor",
      "--json",
    ]);
    expectExit(check, started, 0, `review new self (${status})`);
    await writeReviewPair(
      check,
      parseJson(check, started, `review new self (${status})`),
      "self",
      undefined,
      [{ id: "F1", severity: "high", status }],
    );
    expectExit(
      check,
      await cli(check, ctx, ["review", "done", run, "self"]),
      0,
      `review done self (${status})`,
    );
  };
  await round("open");
  const preview = await cli(check, ctx, ["close", run, "--preview", "--json"]);
  expectExit(check, preview, 0, "close preview with an open high finding");
  expectText(check, preview, "open high finding: self F1", "close preview");
  const refused = await cli(check, ctx, [
    "close",
    run,
    "--via",
    "confirm",
    "--ack-warnings",
    "--ack-open",
  ]);
  expectExit(check, refused, 4, "close with an open high finding");
  expectText(check, refused, "open high finding: self F1", "close with an open high finding");
  await round("fixed");
  const closed = await cli(check, ctx, ["close", run, "--via", "confirm", "--json"]);
  expectExit(check, closed, 0, "close after the finding is fixed");
  expectField(
    check,
    parseJson(check, closed, "close after the finding is fixed"),
    "lifecycle",
    "closed",
    "close after the finding is fixed",
  );
}

const scenarios: Scenario[] = [
  {
    name: "real-plan-gate",
    summary: "The plan gate refuses an empty plan and an incomplete task file.",
    run: planGate,
  },
  {
    name: "real-worktree-flow",
    summary: "A task worktree needs a commit before done and integrate.",
    run: worktreeFlow,
  },
  {
    name: "real-stale-skills",
    summary: "An edited installed bundle is stale until the next install.",
    run: staleSkills,
  },
  {
    name: "real-close-ack",
    summary: "A soft close needs --ack-open and a self-review after a cross delta.",
    run: closeAck,
  },
  {
    name: "real-decision-close",
    summary: "The close preview onYes command closes the run as printed.",
    run: decisionClose,
  },
  {
    name: "real-high-finding-gate",
    summary: "An open high finding refuses close until a later review sets it fixed.",
    run: highFindingGate,
  },
];

export function realScenarioNames(): string[] {
  return scenarios.map((scenario) => scenario.name);
}

export function realScenarios(): { name: string; summary: string }[] {
  return scenarios.map((scenario) => ({ name: scenario.name, summary: scenario.summary }));
}

function evalEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ATRY_DEV: "1",
    HOME: home,
    USERPROFILE: home,
  };
  delete env.CODEX_THREAD_ID;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.CURSOR_TRACE_ID;
  return env;
}

export async function runRealEvals(
  options: { only?: string; drift?: boolean } = {},
): Promise<RealResult[]> {
  const selected = scenarios.filter((scenario) =>
    options.only === undefined || scenario.name === options.only
  );
  if (selected.length === 0) return [];
  const root = await realpath(await mkdtemp(join(tmpdir(), "atry-real-eval-")));
  try {
    const results: RealResult[] = [];
    for (const scenario of selected) {
      const check: Check = { failures: [], steps: 0 };
      const repo = join(root, scenario.name);
      const home = join(root, `${scenario.name}-home`);
      try {
        await mkdir(repo, { recursive: true });
        await mkdir(home, { recursive: true });
        const ctx: Context = {
          repo,
          home,
          env: evalEnv(home),
          drift: options.drift === true,
          root,
        };
        await git(ctx, ["init"]);
        await git(ctx, ["config", "core.autocrlf", "false"]);
        await git(ctx, ["commit", "--allow-empty", "-m", "init"]);
        await scenario.run(check, ctx);
      } catch (error) {
        if (!(error instanceof ScenarioStop)) {
          check.failures.push(
            `unexpected error: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      results.push({ scenario: scenario.name, steps: check.steps, failures: check.failures });
    }
    return results;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export function realText(result: RealResult): string {
  return `${result.scenario.padEnd(24)}${"real".padEnd(8)}${String(result.steps).padEnd(8)}${
    result.failures.length === 0 ? "ok" : "FAIL"
  }`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let only: string | undefined;
  let drift = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--drift") {
      drift = true;
      continue;
    }
    if (arg !== "--scenario") {
      process.stderr.write(`evals: unknown argument: ${arg}\n`);
      process.exitCode = 2;
      return;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      process.stderr.write("evals: --scenario requires a value\n");
      process.exitCode = 2;
      return;
    }
    only = value;
    index += 1;
  }
  const results = await runRealEvals({ only, drift });
  if (results.length === 0) {
    process.stderr.write(`evals: no real scenario named ${only ?? ""}\n`);
    process.exitCode = 2;
    return;
  }
  process.stdout.write("scenario\t\t\t\tlayer\tsteps\tresult\n");
  for (const result of results) process.stdout.write(`${realText(result)}\n`);
  for (const result of results) {
    for (const message of result.failures) {
      process.stderr.write(`fail: ${result.scenario}: ${message}\n`);
    }
  }
  const failed = results.filter((result) => result.failures.length > 0);
  process.stdout.write(`evals: ${results.length - failed.length}/${results.length} passed\n`);
  if (failed.length > 0) process.exitCode = 1;
}

const entry = process.argv[1] === undefined ? "" : pathToFileURL(process.argv[1]).href;
if (entry === import.meta.url) {
  await main();
}
