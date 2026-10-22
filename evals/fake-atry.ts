// Fake `atry` for the deterministic skill eval layer.
//
// Usage:
//   node --experimental-strip-types evals/fake-atry.ts <args...>
//
// Environment:
//   ATRY_EVAL_SCENARIO  path to one scenario JSON file (a scenario, not the collection)
//   ATRY_EVAL_RECORD    path to the call log, one JSON line per call
//   ATRY_EVAL_STEP      zero-based step index to play
//
// The fake prints the response that the real CLI would print for that step. It
// records every call first, so a failed scenario still shows what ran.

import { appendFileSync, readFileSync } from "node:fs";

type Step = {
  argv: string[];
  exit: number;
  stdout?: unknown;
  stderr?: string;
};

type Scenario = {
  name: string;
  skill: string;
  steps: Step[];
};

function fail(message: string): never {
  process.stderr.write(`fake-atry: ${message}\n`);
  process.exit(90);
}

// The command surface of `atry`. A scenario step outside this table is a wrong
// command, not a new CLI feature. Add a verb here when the real CLI adds one.
const commands: Record<string, string[]> = {
  approve: [],
  claim: [],
  close: [],
  context: [],
  distill: [],
  list: [],
  next: [],
  plan: ["amend", "done", "new"],
  preflight: [],
  release: [],
  resolve: [],
  review: ["decide", "done", "new"],
  run: ["new"],
  skills: ["install", "status"],
  stage: ["done", "start"],
  status: [],
  steal: [],
  task: ["done", "skip", "start"],
  brainstorm: ["done", "new"],
};

function checkCommand(argv: string[]): void {
  const verb = argv[0] ?? "";
  const subcommands = commands[verb];
  if (subcommands === undefined) fail(`step is not an atry command: "${verb}"`);
  if (subcommands.length === 0) return;
  const sub = argv[1] ?? "";
  if (!subcommands.includes(sub)) fail(`"${verb} ${sub}" is not an atry command`);
}

const scenarioPath = process.env.ATRY_EVAL_SCENARIO;
const recordPath = process.env.ATRY_EVAL_RECORD;
if (scenarioPath === undefined || scenarioPath === "") fail("ATRY_EVAL_SCENARIO is not set");
if (recordPath === undefined || recordPath === "") fail("ATRY_EVAL_RECORD is not set");

const scenario = JSON.parse(readFileSync(scenarioPath, "utf8")) as Scenario;
const stepIndex = Number(process.env.ATRY_EVAL_STEP ?? "0");
const argv = process.argv.slice(2);
appendFileSync(recordPath, `${JSON.stringify({ argv, step: stepIndex })}\n`);

const step = scenario.steps[stepIndex];
if (step === undefined) {
  fail(`scenario ${scenario.name} has no step ${stepIndex + 1}`);
}
checkCommand(argv);
const expected = JSON.stringify(step.argv);
const actual = JSON.stringify(argv);
if (expected !== actual) {
  fail(`step ${stepIndex + 1} expected ${expected} but the skill ran ${actual}`);
}

if (step.stdout !== undefined) {
  process.stdout.write(
    typeof step.stdout === "string" ? step.stdout : `${JSON.stringify(step.stdout)}\n`,
  );
}
if (step.stderr !== undefined) process.stderr.write(step.stderr);
process.exitCode = step.exit;
