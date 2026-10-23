// Skill eval harness.
//
// Usage:
//   node --experimental-strip-types evals/run.ts [--root DIR] [--scenarios FILE]
//        [--scenario NAME] [--layer fake|real|all] [--drift] [--list]
//
// The harness has two layers:
//
// - The fake layer replays the recorded steps in scenarios.json through
//   evals/fake-atry.ts. It checks the command sequence, the JSON schema, the
//   step count, and the skill token count. It never calls a model.
// - The real layer drives `node dist/atry.js` through evals/real.ts. It creates
//   temporary repositories and asserts exit codes, JSON fields, file contents,
//   and git state.
//
// With no arguments both layers run. `--scenario NAME` runs the layer that owns
// the name. `--drift` flips one recorded expectation and the real layer must
// fail, which shows that behavior drift is caught.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { realScenarioNames, realScenarios, runRealEvals } from "./real.ts";

type Step = {
  argv: string[];
  exit: number;
  stdout?: unknown;
  stderr?: string;
};

type Scenario = {
  name: string;
  skill: string;
  summary: string;
  steps: Step[];
};

type Collection = {
  schema: number;
  maxTokens: number;
  maxSteps: number;
  scenarios: Scenario[];
};

type Layer = "fake" | "real" | "all";

type Options = {
  root: string;
  scenarios: string;
  scenariosGiven: boolean;
  only?: string;
  list: boolean;
  layer?: Layer;
  drift: boolean;
};

type Outcome = {
  scenario: string;
  layer: "fake" | "real";
  skill: string;
  steps: number;
  tokens?: number;
  summary: string;
  failures: string[];
};

const here = dirname(fileURLToPath(import.meta.url));
const fakeAtry = join(here, "fake-atry.ts");
const realNames = new Set(realScenarioNames());

function fail(message: string): never {
  process.stderr.write(`evals: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    root: resolve(here, ".."),
    scenarios: join(here, "scenarios.json"),
    scenariosGiven: false,
    list: false,
    drift: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--list") {
      options.list = true;
      continue;
    }
    if (arg === "--drift") {
      options.drift = true;
      continue;
    }
    if (
      arg !== "--root" && arg !== "--scenarios" && arg !== "--scenario" && arg !== "--layer"
    ) {
      fail(`unknown argument: ${arg}`);
    }
    if (value === undefined || value === "" || value.startsWith("--")) {
      fail(`${arg} requires a value`);
    }
    if (arg === "--root") options.root = resolve(value);
    if (arg === "--scenarios") {
      options.scenarios = resolve(value);
      options.scenariosGiven = true;
    }
    if (arg === "--scenario") options.only = value;
    if (arg === "--layer") {
      if (value !== "fake" && value !== "real" && value !== "all") {
        fail(`--layer must be fake, real, or all`);
      }
      options.layer = value;
    }
    index += 1;
  }
  if (options.drift && (options.layer === "fake" || options.scenariosGiven)) {
    fail("--drift needs the real layer");
  }
  return options;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return fail(`${path}: ${message}`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadCollection(path: string): Collection {
  const value = readJson(path);
  if (!isObject(value) || value.schema !== 1) fail(`${path}: schema must be 1`);
  const scenarios = value.scenarios;
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    fail(`${path}: scenarios must be a non-empty array`);
  }
  for (const item of scenarios) {
    if (!isObject(item) || typeof item.name !== "string" || typeof item.skill !== "string") {
      fail(`${path}: each scenario needs a name and a skill`);
    }
    if (!Array.isArray(item.steps) || item.steps.length === 0) {
      fail(`${path}: ${item.name} needs at least one step`);
    }
  }
  return {
    schema: 1,
    maxTokens: typeof value.maxTokens === "number" ? value.maxTokens : 2500,
    maxSteps: typeof value.maxSteps === "number" ? value.maxSteps : 12,
    scenarios: scenarios as Scenario[],
  };
}

function skillTokens(root: string): Map<string, number> {
  const script = join(root, "scripts/maint/skill-tokens.ts");
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", script, "--root", root],
    {
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    fail(`skill-tokens failed: ${(result.stderr ?? "").trim()}`);
  }
  const counts = new Map<string, number>();
  for (const line of (result.stdout ?? "").split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 6) continue;
    const stage = cells[1] ?? "";
    const tokens = Number(cells[4]);
    if (stage === "" || stage === "stage" || stage === "total" || Number.isNaN(tokens)) continue;
    counts.set(stage, tokens);
  }
  return counts;
}

const twoWordVerbs = new Set([
  "brainstorm",
  "hook",
  "plan",
  "policy",
  "review",
  "run",
  "skills",
  "stage",
  "task",
]);

function verbOf(argv: readonly string[]): string {
  const first = argv[0] ?? "";
  if (argv.length > 1 && twoWordVerbs.has(first)) return `${first} ${argv[1]}`;
  return first;
}

const requiredKeys: Record<string, string[]> = {
  approve: ["approved", "lifecycle"],
  "brainstorm new": ["path", "notes", "open"],
  close: ["recommend", "reasons"],
  context: ["run", "stage", "lifecycle", "tasks", "paths"],
  distill: ["path", "files"],
  next: ["command", "recommendation", "actions", "reason", "needsHuman", "read"],
  preflight: ["ok", "installed", "required"],
  "review new": ["path", "markdown", "json", "stage", "action"],
  "run new": ["path", "name", "id", "base"],
};

function checkJson(verb: string, value: Record<string, unknown>): string[] {
  const failures: string[] = [];
  if (value.schema !== 1) failures.push(`schema must be 1, found ${JSON.stringify(value.schema)}`);
  for (const key of requiredKeys[verb] ?? []) {
    if (!(key in value)) failures.push(`${verb} JSON is missing "${key}"`);
  }
  if (verb === "next" && Array.isArray(value.actions)) {
    for (const action of value.actions) {
      if (!isObject(action)) {
        failures.push("next action must be an object");
        continue;
      }
      for (const key of ["kind", "command", "args", "reason", "needsHuman", "read"]) {
        if (!(key in action)) failures.push(`next action is missing "${key}"`);
      }
    }
    if (value.actions.length === 0 && isObject(value.state)) {
      const lifecycle = value.state.lifecycle;
      if (lifecycle !== "closed" && lifecycle !== "abandoned") {
        failures.push("next actions is empty for an open run");
      }
    }
  }
  return failures;
}

function checkSkillDeclares(skillText: string, verb: string): string | undefined {
  if (verb === "") return "step has an empty command";
  if (!skillText.includes(`atry ${verb}`)) {
    return `SKILL.md does not declare "atry ${verb}"`;
  }
  return undefined;
}

function runScenario(
  scenario: Scenario,
  options: Options,
  collection: Collection,
  counts: Map<string, number>,
): Outcome {
  const failures: string[] = [];
  const stage = scenario.skill.replace(/^atry-/, "");
  const tokens = counts.get(stage);
  if (tokens === undefined) {
    failures.push(`skill-tokens has no row for ${stage}`);
  } else if (tokens >= collection.maxTokens) {
    failures.push(`${tokens} tokens is not under ${collection.maxTokens}`);
  }
  if (scenario.steps.length > collection.maxSteps) {
    failures.push(`${scenario.steps.length} steps is more than ${collection.maxSteps}`);
  }

  let skillText = "";
  try {
    skillText = readFileSync(join(options.root, "skills", scenario.skill, "SKILL.md"), "utf8");
  } catch {
    failures.push(`skills/${scenario.skill}/SKILL.md is missing`);
  }

  const work = mkdtempSync(join(tmpdir(), "atry-eval-"));
  const scenarioPath = join(work, "scenario.json");
  const recordPath = join(work, "calls.jsonl");
  writeFileSync(scenarioPath, `${JSON.stringify(scenario)}\n`);
  writeFileSync(recordPath, "");
  try {
    for (let index = 0; index < scenario.steps.length; index += 1) {
      const step = scenario.steps[index];
      if (!Array.isArray(step?.argv) || step.argv.length === 0) {
        failures.push(`step ${index + 1}: argv must be a non-empty array`);
        continue;
      }
      const verb = verbOf(step.argv);
      const declared = checkSkillDeclares(skillText, verb);
      if (declared !== undefined) failures.push(`step ${index + 1}: ${declared}`);
      const result = spawnSync(process.execPath, [
        "--experimental-strip-types",
        fakeAtry,
        ...step.argv,
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          ATRY_EVAL_SCENARIO: scenarioPath,
          ATRY_EVAL_RECORD: recordPath,
          ATRY_EVAL_STEP: String(index),
        },
      });
      if (result.status !== step.exit) {
        const detail = (result.stderr ?? "").trim();
        failures.push(
          `step ${index + 1}: exit ${result.status ?? "none"} does not match ${step.exit}${
            detail === "" ? "" : ` (${detail})`
          }`,
        );
      }
      if (isObject(step.stdout)) {
        for (const item of checkJson(verb, step.stdout)) {
          failures.push(`step ${index + 1}: ${item}`);
        }
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return {
    scenario: scenario.name,
    layer: "fake",
    skill: scenario.skill,
    steps: scenario.steps.length,
    tokens: tokens ?? 0,
    summary: scenario.summary,
    failures,
  };
}

function chosenLayers(options: Options): Layer[] {
  if (options.layer === "all") return ["fake", "real"];
  if (options.layer !== undefined) return [options.layer];
  if (options.only !== undefined) return realNames.has(options.only) ? ["real"] : ["fake"];
  if (options.scenariosGiven) return ["fake"];
  return ["fake", "real"];
}

function listLayers(options: Options): Layer[] {
  if (options.layer === "all") return ["fake", "real"];
  if (options.layer !== undefined) return [options.layer];
  return ["fake", "real"];
}

function rowText(row: Outcome): string {
  return `${row.scenario.padEnd(24)}${row.layer.padEnd(8)}${row.skill.padEnd(24)}${
    String(row.steps).padEnd(8)
  }${(row.tokens === undefined ? "-" : String(row.tokens)).padEnd(8)}${
    row.failures.length === 0 ? "ok" : "FAIL"
  }`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const layers = chosenLayers(options);
  if (options.drift && !layers.includes("real")) {
    fail("--drift needs the real layer");
  }

  if (options.list) {
    if (listLayers(options).includes("fake")) {
      for (const scenario of loadCollection(options.scenarios).scenarios) {
        process.stdout.write(`${scenario.name}\tfake\t${scenario.summary}\n`);
      }
    }
    if (listLayers(options).includes("real")) {
      for (const scenario of realScenarios()) {
        process.stdout.write(`${scenario.name}\treal\t${scenario.summary}\n`);
      }
    }
    return;
  }

  const rows: Outcome[] = [];
  if (layers.includes("fake")) {
    const collection = loadCollection(options.scenarios);
    const selected = collection.scenarios.filter((scenario) =>
      options.only === undefined || scenario.name === options.only
    );
    const counts = skillTokens(options.root);
    for (const scenario of selected) {
      rows.push(runScenario(scenario, options, collection, counts));
    }
  }
  if (layers.includes("real")) {
    if (!existsSync(join(options.root, "dist", "atry.js"))) {
      fail("dist/atry.js is missing; run npm run build");
    }
    const results = await runRealEvals({ only: options.only, drift: options.drift });
    for (const result of results) {
      rows.push({
        scenario: result.scenario,
        layer: "real",
        skill: "cli",
        steps: result.steps,
        summary: "",
        failures: result.failures,
      });
    }
  }

  if (options.only !== undefined && rows.length === 0) {
    fail(`no scenario named ${options.only}`);
  }

  process.stdout.write(
    `${"scenario".padEnd(24)}${"layer".padEnd(8)}${"skill".padEnd(24)}${"steps".padEnd(8)}${
      "tokens".padEnd(8)
    }result\n`,
  );
  for (const row of rows) process.stdout.write(`${rowText(row)}\n`);
  for (const row of rows) {
    for (const message of row.failures) {
      process.stderr.write(`fail: ${row.scenario}: ${message}\n`);
    }
  }
  const failed = rows.filter((row) => row.failures.length > 0);
  process.stdout.write(`evals: ${rows.length - failed.length}/${rows.length} passed\n`);
  if (failed.length > 0) process.exitCode = 1;
}

await main();
