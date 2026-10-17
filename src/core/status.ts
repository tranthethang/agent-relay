import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { rebuildRun } from "./cache.js";
import { listRunNames } from "./discover.js";
import { RelayError } from "./error.js";
import { isEnoent } from "./files.js";
import { formatAge, nextStep } from "./next.js";
import { type RunState } from "./reduce.js";
import { type RunJson } from "./run.js";
import { schemaVersion } from "./vocab.js";

export type StatusRow = {
  name: string;
  id: string;
  stage: RunState["stage"];
  lifecycle: RunState["lifecycle"];
  age: string;
  next: string;
};

export type StatusList = {
  schema: 1;
  runs: StatusRow[];
  warnings?: string[];
};

export type StatusDetail = {
  schema: 1;
  name: string;
  id: string;
  ymd: string;
  slug: string;
  title: string;
  base: string;
  from?: string;
  stage: RunState["stage"];
  lifecycle: RunState["lifecycle"];
  approved: boolean;
  age: string;
  tasks: RunState["tasks"];
  next: string;
  warnings?: string[];
};

export async function statusList(relayDir: string, nowMs: number): Promise<StatusList> {
  const names = await listRunNames(relayDir);
  const runs: StatusRow[] = [];
  const warnings: string[] = [];
  for (const name of names) {
    const runDir = join(relayDir, name);
    if (!await hasCache(runDir)) continue;
    try {
      const loaded = await rebuildRun(runDir);
      if (loaded.warning !== null) warnings.push(`${name}: ${loaded.warning}`);
      runs.push(rowFrom(name, loaded.run, loaded.events, await cacheMtime(runDir), nowMs));
    } catch (error) {
      if (!(error instanceof RelayError)) throw error;
      const warning = `${name}: ${error.message}`;
      warnings.push(warning);
      process.stderr.write(`warning: ${warning}\n`);
    }
  }
  const result: StatusList = { schema: schemaVersion, runs };
  if (warnings.length > 0) result.warnings = warnings;
  return result;
}

export async function statusDetail(runDir: string, nowMs: number): Promise<StatusDetail> {
  const loaded = await rebuildRun(runDir);
  const run = loaded.run;
  const detail: StatusDetail = {
    schema: schemaVersion,
    name: basename(runDir),
    id: run.id,
    ymd: run.ymd,
    slug: run.slug,
    title: run.title,
    base: run.base,
    stage: run.state.stage,
    lifecycle: run.state.lifecycle,
    approved: run.state.approved,
    age: ageOf(loaded.events, await cacheMtime(runDir), nowMs),
    tasks: run.state.tasks,
    next: nextStep(run.id, run.state, loaded.events),
  };
  if (run.from !== undefined) detail.from = run.from;
  if (loaded.warning !== null) detail.warnings = [loaded.warning];
  return detail;
}

export function statusListText(result: StatusList): string {
  if (result.runs.length === 0) return "runs: none\n";
  return `${
    result.runs.map((run) =>
      `${run.name} ${run.stage} ${run.lifecycle} ${run.age}\nnext: ${run.next}`
    ).join("\n\n")
  }\n`;
}

export function statusDetailText(result: StatusDetail): string {
  const lines = [
    `run: ${result.name}`,
    `title: ${result.title}`,
    `stage: ${result.stage}`,
    `status: ${result.lifecycle}`,
    `approved: ${result.approved ? "yes" : "no"}`,
    `age: ${result.age}`,
    `tasks: ${taskLine(result.tasks)}`,
    `next: ${result.next}`,
  ];
  return `${lines.join("\n")}\n`;
}

function rowFrom(
  name: string,
  run: RunJson,
  events: Parameters<typeof nextStep>[2],
  mtimeMs: number,
  nowMs: number,
): StatusRow {
  return {
    name,
    id: run.id,
    stage: run.state.stage,
    lifecycle: run.state.lifecycle,
    age: ageOf(events, mtimeMs, nowMs),
    next: nextStep(run.id, run.state, events),
  };
}

function ageOf(events: readonly { ts: string }[], mtimeMs: number, nowMs: number): string {
  const from = events[0] !== undefined ? Date.parse(events[0].ts) : mtimeMs;
  return formatAge(from, nowMs);
}

function taskLine(tasks: RunState["tasks"]): string {
  if (tasks.length === 0) return "none";
  return tasks.map((task) => `${task.id} ${task.status}`).join(", ");
}

async function hasCache(runDir: string): Promise<boolean> {
  try {
    await stat(join(runDir, "run.json"));
    return true;
  } catch (error) {
    if (isEnoent(error)) return false;
    throw error;
  }
}

async function cacheMtime(runDir: string): Promise<number> {
  const info = await stat(join(runDir, "run.json"));
  return info.mtimeMs;
}
