import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { runIdFromName, runSlugFromName } from "./discover.js";
import { fromZod, RelayError } from "./error.js";
import { type EventLine, eventLineSchema } from "./event.js";
import { appendJsonl, atomicWrite, isEnoent, readJson, readJsonlLines } from "./files.js";
import { reduceEvents, type RunState, type TaskState } from "./reduce.js";
import { type RunJson, runJsonSchema } from "./run.js";
import { acquireRunLock, releaseRunLock } from "./runlock.js";
import { schemaVersion } from "./vocab.js";

export const cacheWarning = "run.json disagreed with events.jsonl; rebuilt";

export type RebuildResult = {
  run: RunJson;
  events: EventLine[];
  warning: string | null;
};

type CacheRead = { current: RunJson; events: EventLine[]; state: RunState; same: boolean };

async function readRun(runDir: string): Promise<CacheRead> {
  const events = await readEvents(runDir);
  const state = canonicalState(reduceEvents(events));
  const current = await readCache(runDir);
  return { current, events, state, same: sameState(current.state, state) };
}

// Reads without a write. On drift, takes the run lock and checks again before it writes.
export async function rebuildRun(runDir: string): Promise<RebuildResult> {
  const read = await readRun(runDir);
  if (read.same) return { run: read.current, events: read.events, warning: null };
  const lock = await acquireRunLock(runDir);
  try {
    return await rebuildRunLocked(runDir);
  } finally {
    await releaseRunLock(lock);
  }
}

// The caller holds the run lock.
export async function rebuildRunLocked(runDir: string): Promise<RebuildResult> {
  const { current, events, state, same } = await readRun(runDir);
  if (same) return { run: current, events, warning: null };
  // Keep evidence of the drift; the rebuild below would otherwise erase it.
  const drifted = await appendChained(runDir, {
    schema: schemaVersion,
    ts: new Date().toISOString(),
    stage: "run",
    action: "drifted",
  });
  const run = withState(current, state);
  await atomicWrite(join(runDir, "run.json"), `${JSON.stringify(run)}\n`);
  process.stderr.write(`warning: ${cacheWarning}\n`);
  return { run, events: [...events, drifted], warning: cacheWarning };
}

// Appends one event with `prev` set to the hash of the last line. The caller holds the run lock.
export async function appendChained(
  runDir: string,
  input: Omit<EventLine, "prev">,
): Promise<EventLine> {
  const filePath = join(runDir, "events.jsonl");
  const lines = await readJsonlLines(filePath);
  const last = lines.at(-1);
  const event = eventLineSchema.parse(
    last === undefined ? input : { ...input, prev: lineHash(last.raw) },
  );
  await appendJsonl(filePath, JSON.stringify(event));
  return event;
}

export function lineHash(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

async function readEvents(runDir: string): Promise<EventLine[]> {
  let rows: Array<{ raw: string; value: unknown }>;
  try {
    rows = await readJsonlLines(join(runDir, "events.jsonl"));
  } catch (error) {
    if (isEnoent(error)) {
      throw new RelayError("not_found", "events.jsonl not found", "events.jsonl");
    }
    throw error;
  }
  const events = rows.map((row, index) => parseEvent(row.value, index));
  checkChain(rows, events);
  return events;
}

// Lines before the first `prev` predate the chain. Every later line must link to its parent.
function checkChain(rows: ReadonlyArray<{ raw: string }>, events: readonly EventLine[]): void {
  let chained = false;
  events.forEach((event, index) => {
    const fieldPath = `events.jsonl:lines[${index}].prev`;
    if (event.prev === undefined) {
      if (chained) throw new RelayError("validation", "prev is missing", fieldPath);
      return;
    }
    chained = true;
    const parent = rows[index - 1];
    if (parent === undefined || event.prev !== lineHash(parent.raw)) {
      throw new RelayError("validation", "prev does not match the previous line", fieldPath);
    }
  });
}

function parseEvent(row: unknown, index: number): EventLine {
  const parsed = eventLineSchema.safeParse(row);
  if (parsed.success) return parsed.data;
  const issue = fromZod(parsed.error);
  const prefix = `events.jsonl:lines[${index}]`;
  const fieldPath = issue.fieldPath.length === 0 ? prefix : `${prefix}.${issue.fieldPath}`;
  throw new RelayError(issue.code, issue.message, fieldPath);
}

async function readCache(runDir: string): Promise<RunJson> {
  let value: unknown;
  try {
    value = await readJson(join(runDir, "run.json"));
  } catch (error) {
    if (isEnoent(error)) throw new RelayError("not_found", "run.json not found", "run.json");
    if (error instanceof RelayError && error.message === "invalid JSON") {
      throw new RelayError("validation", "invalid JSON", "run.json");
    }
    throw error;
  }
  const parsed = runJsonSchema.safeParse(value);
  if (!parsed.success) {
    const issue = fromZod(parsed.error);
    const fieldPath = issue.fieldPath.length === 0 ? "run.json" : `run.json:${issue.fieldPath}`;
    throw new RelayError(issue.code, issue.message, fieldPath);
  }
  checkIdentity(basename(runDir), parsed.data);
  return parsed.data;
}

function checkIdentity(name: string, run: RunJson): void {
  const expected = { id: runIdFromName(name), ymd: name.slice(0, 8), slug: runSlugFromName(name) };
  for (const key of ["id", "ymd", "slug"] as const) {
    if (run[key] !== expected[key]) {
      throw new RelayError("validation", `does not match run directory ${name}`, `run.json:${key}`);
    }
  }
}

export async function commitState(
  runDir: string,
  current: RunJson,
  state: RunState,
): Promise<RunJson> {
  const run = withState(current, canonicalState(state));
  await atomicWrite(join(runDir, "run.json"), `${JSON.stringify(run)}\n`);
  return run;
}

function withState(current: RunJson, state: RunState): RunJson {
  const next: RunJson = {
    schema: schemaVersion,
    id: current.id,
    ymd: current.ymd,
    slug: current.slug,
    title: current.title,
    base: current.base,
    state,
  };
  if (current.from !== undefined) next.from = current.from;
  if (current.worktree !== undefined) next.worktree = current.worktree;
  return runJsonSchema.parse(next);
}

function sameState(left: RunState, right: RunState): boolean {
  return JSON.stringify(canonicalState(left)) === JSON.stringify(canonicalState(right));
}

function canonicalState(state: RunState): RunState {
  return {
    lifecycle: state.lifecycle,
    stage: state.stage,
    approved: state.approved,
    tasks: state.tasks.map((task) => canonicalTask(task)),
  };
}

function canonicalTask(task: TaskState): TaskState {
  const next: TaskState = { id: task.id, status: task.status };
  if (task.session !== undefined) next.session = task.session;
  if (task.reason !== undefined) next.reason = task.reason;
  return next;
}
