// Model-backed skill eval. It drives `claude -p` and `codex exec` through the
// scenarios in scenarios.json and checks each run's events.jsonl against an
// expected trajectory.
//
// Usage:
//   node --experimental-strip-types evals/model/run.ts [--tool NAME]...
//        [--scenario NAME]... [--repeat N] [--out DIR]
//
// The rate is a report, not a gate: the exit code is 0 when the harness ran,
// even when a scenario fails. Exit 2 is a usage error or a missing dist/atry.js.
// A tool with no binary or no API key is reported as skipped, not as a pass.

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  cliPath,
  createFixture,
  fileCheckFailures,
  loadScenarios,
  type Scenario,
  scenarioPrompt,
} from "./fixtures.ts";
import { buildReport, type Report, type Row, toMarkdown } from "./report.ts";
import { createRunners, type Runner } from "./runners.ts";
import { matchTrajectory, parseEvents } from "./trajectory.ts";

export const agentTimeoutMs = 15 * 60 * 1000;

export type RunOptions = {
  runners: Runner[];
  scenarios: Scenario[];
  repeat: number;
  outDir: string;
  timeoutMs?: number;
  date?: string;
};

// The run directory is the fixture's own, or the newest one the agent created.
async function findEvents(repo: string, runPath: string): Promise<string> {
  const file = async (dir: string) => {
    try {
      return await readFile(join(dir, "events.jsonl"), "utf8");
    } catch {
      return "";
    }
  };
  if (runPath !== "") return file(runPath);
  const root = join(repo, ".agent-relay");
  let names: string[] = [];
  try {
    names = (await readdir(root)).filter((name) => /^\d{8}-/.test(name)).sort();
  } catch {
    return "";
  }
  const last = names.at(-1);
  return last === undefined ? "" : file(join(root, last));
}

async function runOnce(
  runner: Runner,
  scenario: Scenario,
  repeat: number,
  options: RunOptions,
): Promise<Row> {
  const row: Row = {
    tool: runner.tool,
    scenario: scenario.name,
    repeat,
    status: "fail",
    matched: 0,
    required: scenario.required.length,
    ms: 0,
    reason: "",
  };
  const fixture = await createFixture(scenario.fixture);
  try {
    const result = await runner.run(
      scenarioPrompt(scenario, fixture.runPath),
      fixture.repo,
      options.timeoutMs ?? agentTimeoutMs,
    );
    row.ms = result.ms;
    const text = await findEvents(fixture.repo, fixture.runPath);
    const eventsDir = join(options.outDir, "events", runner.tool);
    await mkdir(eventsDir, { recursive: true });
    await writeFile(join(eventsDir, `${scenario.name}-${repeat}.jsonl`), text);
    const outcome = matchTrajectory(parseEvents(text), scenario);
    row.matched = outcome.matched;
    const problems: string[] = [];
    if (result.timedOut) problems.push("timeout");
    if (outcome.firstMissing) {
      problems.push(`missing ${outcome.firstMissing.stage}:${outcome.firstMissing.action}`);
    }
    for (const hit of outcome.forbiddenHits) {
      problems.push(`forbidden ${hit.stage}:${hit.action}`);
    }
    problems.push(...await fileCheckFailures(fixture, scenario.fileCheck));
    row.status = problems.length === 0 ? "pass" : "fail";
    row.reason = problems.join("; ");
  } catch (error) {
    row.reason = error instanceof Error ? error.message : String(error);
  } finally {
    await fixture.cleanup();
  }
  return row;
}

export async function runModelEvals(options: RunOptions): Promise<Report> {
  await mkdir(options.outDir, { recursive: true });
  const rows: Row[] = [];
  for (const runner of options.runners) {
    const ready = runner.available();
    for (const scenario of options.scenarios) {
      for (let repeat = 1; repeat <= options.repeat; repeat += 1) {
        if (ready) {
          rows.push(await runOnce(runner, scenario, repeat, options));
        } else {
          rows.push({
            tool: runner.tool,
            scenario: scenario.name,
            repeat,
            status: "skipped",
            matched: 0,
            required: scenario.required.length,
            ms: 0,
            reason: "binary or API key missing",
          });
        }
      }
    }
  }
  const report = buildReport(rows, options.date ?? new Date().toISOString());
  await writeFile(join(options.outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(options.outDir, "report.md"), toMarkdown(report));
  return report;
}

export type Args = { tools: string[]; scenarios: string[]; repeat: number; out: string | null };

export function parseArgs(argv: string[]): Args {
  const args: Args = { tools: [], scenarios: [], repeat: 1, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!["--tool", "--scenario", "--repeat", "--out"].includes(flag)) {
      throw new Error(`unknown argument ${flag}`);
    }
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value`);
    i += 1;
    if (flag === "--tool") args.tools.push(value);
    else if (flag === "--scenario") args.scenarios.push(value);
    else if (flag === "--out") args.out = value;
    else {
      if (!/^[1-9]\d*$/.test(value)) throw new Error("--repeat must be a positive integer");
      args.repeat = Number(value);
    }
  }
  return args;
}

async function main(argv: string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error((error as Error).message);
    return 2;
  }
  if (!existsSync(cliPath)) {
    console.error(`${cliPath} is missing; run npm run build`);
    return 2;
  }
  const all = await loadScenarios();
  const unknown = args.scenarios.find((name) => !all.some((s) => s.name === name));
  if (unknown !== undefined) {
    console.error(`unknown scenario ${unknown}`);
    return 2;
  }
  const runners = createRunners();
  const badTool = args.tools.find((name) => !runners.some((r) => r.tool === name));
  if (badTool !== undefined) {
    console.error(`unknown tool ${badTool}`);
    return 2;
  }
  const outDir = args.out ?? await mkdtemp(join(tmpdir(), "atry-model-evals-"));
  const report = await runModelEvals({
    runners: runners.filter((r) => args.tools.length === 0 || args.tools.includes(r.tool)),
    scenarios: all.filter((s) => args.scenarios.length === 0 || args.scenarios.includes(s.name)),
    repeat: args.repeat,
    outDir,
  });
  process.stdout.write(toMarkdown(report));
  console.log(`report: ${outDir}`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
