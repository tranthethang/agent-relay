import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { type ZodType } from "zod";
import { type RebuildResult, rebuildRun } from "./cache.js";
import { fromZod, RelayError } from "./error.js";
import { type EventLine } from "./event.js";
import { atomicWrite, isEnoent, readJson } from "./files.js";
import { workTree } from "./git.js";
import {
  acquireLock,
  createStealGuard,
  readOwner,
  releaseLock,
  removeLock,
  removeStealGuard,
  stealLock,
} from "./lock.js";
import { appendEvent, withRunLock } from "./mutate.js";
import { overlappingTask } from "./overlap.js";
import { type RunState } from "./reduce.js";
import { type PlanIndex, planIndexSchema } from "./tasks.js";
import { schemaVersion, taskIdSchema, taskStatuses } from "./vocab.js";
import { runGitCwd } from "./worktree.js";

type TaskStatus = (typeof taskStatuses)[number];

export type ClaimResult = {
  schema: 1;
  path: string;
  task: string;
  status: "in-progress";
  session: string;
  action: "claimed" | "stolen";
  implement: string;
};

export type ReleaseResult = {
  schema: 1;
  path: string;
  task: string;
  session: string;
  action: "released";
  forced: boolean;
  reason?: string;
};

export type ListTask = {
  id: string;
  status: TaskStatus;
  blocked: string[];
  owner?: string;
};

export type ListResult = {
  schema: 1;
  path: string;
  tasks: ListTask[];
};

export function claimText(result: ClaimResult): string {
  return [
    `task: ${result.task}`,
    `status: ${result.status}`,
    `session: ${result.session}`,
    `action: ${result.action}`,
    `implement: ${result.implement}`,
  ].join("\n") + "\n";
}

export function releaseText(result: ReleaseResult): string {
  const lines = [
    `task: ${result.task}`,
    `session: ${result.session}`,
    `action: ${result.action}`,
  ];
  if (result.reason !== undefined) lines.push(`reason: ${result.reason}`);
  return `${lines.join("\n")}\n`;
}

export function listText(result: ListResult): string {
  if (result.tasks.length === 0) return "tasks: none\n";
  return `${result.tasks.map(listLine).join("\n")}\n`;
}

export async function claimTask(
  runDir: string,
  task: string,
  session: string,
): Promise<ClaimResult> {
  requireSession(session);
  const id = parseTaskId(task);
  return withRunLock(runDir, async (loaded) => {
    assertImplementing(loaded.run.state, "claim");
    const index = await loadPlanIndex(runDir);
    const item = requireTask(index, id);
    refuseFinished(loaded.run.state, id, "claim");
    assertDeps(loaded.run.state, id, item.deps, "claim");
    await acquireLock(runDir, id, session);
    try {
      await assertNoOverlap(runDir, index, id, session);
    } catch (error) {
      await releaseLock(runDir, id, session);
      throw error;
    }
    const implement = await ensureImplement(runDir, item.id, item.title);
    const tree = await workTree(await runGitCwd(runDir, loaded.run));
    await appendAll(loaded, runDir, [
      { stage: "implement", action: "claimed", task: id, session },
      { stage: "implement", action: "task-started", task: id, session, tree },
    ]);
    return {
      schema: schemaVersion,
      path: runDir,
      task: id,
      status: "in-progress",
      session,
      action: "claimed",
      implement,
    };
  });
}

export async function releaseTask(
  runDir: string,
  task: string,
  session: string,
  force: boolean,
  reason?: string,
): Promise<ReleaseResult> {
  requireSession(session);
  const id = parseTaskId(task);
  return withRunLock(runDir, async (loaded) => {
    assertImplementing(loaded.run.state, "release");
    const index = await loadPlanIndex(runDir);
    requireTask(index, id);
    const text = reason?.trim() ?? "";
    if (force) {
      if (text.length === 0) throw new RelayError("validation", "reason is empty", "reason");
      await removeLock(runDir, id);
    } else {
      if (text.length > 0) throw new RelayError("usage", "reason requires --force", "reason");
      await releaseLock(runDir, id, session);
    }
    const input = {
      stage: "implement" as const,
      action: "released" as const,
      task: id,
      session,
      ...(force ? { reason: text } : {}),
    };
    await appendEvent(loaded, runDir, input);
    const result: ReleaseResult = {
      schema: schemaVersion,
      path: runDir,
      task: id,
      session,
      action: "released",
      forced: force,
    };
    if (force) result.reason = text;
    return result;
  });
}

export async function stealTask(
  runDir: string,
  task: string,
  session: string,
  ttlMinutes: number,
): Promise<ClaimResult> {
  requireSession(session);
  if (!Number.isFinite(ttlMinutes) || ttlMinutes < 0) {
    throw new RelayError("usage", "ttl must be a non-negative number", "ttl");
  }
  const id = parseTaskId(task);
  return withRunLock(runDir, async (loaded) => {
    assertImplementing(loaded.run.state, "steal");
    const index = await loadPlanIndex(runDir);
    const item = requireTask(index, id);
    refuseFinished(loaded.run.state, id, "steal");
    assertDeps(loaded.run.state, id, item.deps, "steal");
    await createStealGuard(runDir, id, session);
    try {
      await assertNoOverlap(runDir, index, id, session);
      await stealLock(runDir, id, session, ttlMinutes * 60_000);
      const implement = await ensureImplement(runDir, item.id, item.title);
      const tree = await workTree(await runGitCwd(runDir, loaded.run));
      await appendEvent(loaded, runDir, {
        stage: "implement",
        action: "stolen",
        task: id,
        session,
        tree,
      });
      return {
        schema: schemaVersion,
        path: runDir,
        task: id,
        status: "in-progress",
        session,
        action: "stolen",
        implement,
      };
    } finally {
      await removeStealGuard(runDir, id);
    }
  });
}

export async function listTasks(runDir: string): Promise<ListResult> {
  const loaded = await rebuildRun(runDir);
  const index = await loadPlanIndex(runDir);
  const tasks: ListTask[] = [];
  for (const item of index.tasks) {
    const blocked = item.deps.filter((dep) => !isClear(statusOf(loaded.run.state, dep)));
    const owner = await ownerOf(runDir, item.id, loaded.run.state);
    const row: ListTask = { id: item.id, status: statusOf(loaded.run.state, item.id), blocked };
    if (owner !== undefined) row.owner = owner;
    tasks.push(row);
  }
  return { schema: schemaVersion, path: runDir, tasks };
}

export async function assertClaimOwner(
  runDir: string,
  task: string,
  session: string | undefined,
): Promise<void> {
  const id = parseTaskId(task);
  let ownerSession: string;
  try {
    ownerSession = (await readOwner(runDir, id)).session;
  } catch (error) {
    if (error instanceof RelayError && error.code === "not_found") return;
    throw error;
  }
  if (session !== ownerSession) {
    throw new RelayError("lock", `lock held by ${ownerSession}`, `locks/${id}.lock`);
  }
}

export async function releaseClaimLock(
  runDir: string,
  task: string,
  session: string | undefined,
): Promise<void> {
  if (session === undefined) return;
  const id = parseTaskId(task);
  try {
    await releaseLock(runDir, id, session);
  } catch (error) {
    if (error instanceof RelayError && error.code === "not_found") return;
    throw error;
  }
}

function listLine(task: ListTask): string {
  const parts = [`${task.id}: ${task.status}`];
  if (task.owner !== undefined) parts.push(`owner=${task.owner}`);
  if (task.blocked.length > 0) parts.push(`blocked: ${task.blocked.join(" ")}`);
  return parts.join(" ");
}

async function assertNoOverlap(
  runDir: string,
  index: PlanIndex,
  taskId: string,
  session: string,
): Promise<void> {
  const held = new Set<string>();
  for (const item of index.tasks) {
    if (item.id === taskId) continue;
    try {
      const owner = await readOwner(runDir, item.id);
      if (owner.session !== session) held.add(item.id);
    } catch (error) {
      if (error instanceof RelayError && error.code === "not_found") continue;
      // A lock file that exists but is not yet readable is still held.
      held.add(item.id);
    }
  }
  const other = overlappingTask(index.tasks, taskId, held);
  if (other !== null) {
    throw new RelayError("lock", `overlaps ${other}`, `${taskId}.files`);
  }
}

async function appendAll(
  loaded: RebuildResult,
  runDir: string,
  inputs: Omit<EventLine, "schema" | "ts">[],
): Promise<void> {
  let current = loaded;
  for (const input of inputs) {
    const result = await appendEvent(current, runDir, input);
    current = {
      run: result.run,
      events: [...current.events, result.event],
      warning: current.warning,
    };
  }
}

function requireSession(session: string): void {
  if (session.trim().length === 0) {
    throw new RelayError("usage", "session is empty", "session");
  }
}

function refuseFinished(state: RunState, id: string, verb: string): void {
  const current = statusOf(state, id);
  if (current === "done" || current === "skipped") {
    throw new RelayError("gate", `${verb} refused: ${id} is ${current}`, id);
  }
}

function assertDeps(state: RunState, id: string, deps: readonly string[], verb: string): void {
  for (const dep of deps) {
    const status = statusOf(state, dep);
    if (!isClear(status)) {
      throw new RelayError("gate", `${verb} refused: ${dep} is ${status}`, `${id}.deps`);
    }
  }
}

function isClear(status: TaskStatus): boolean {
  return status === "done" || status === "skipped";
}

function assertImplementing(state: RunState, verb: string): void {
  if (state.lifecycle === "implementing") return;
  throw new RelayError("gate", `${verb} refused: run is ${state.lifecycle}`, "state.lifecycle");
}

function statusOf(state: RunState, id: string): TaskStatus {
  return state.tasks.find((task) => task.id === id)?.status ?? "pending";
}

function parseTaskId(value: string): string {
  const parsed = taskIdSchema.safeParse(value);
  if (!parsed.success) throw new RelayError("validation", "invalid task id", "task");
  return parsed.data;
}

function requireTask(index: PlanIndex, id: string): PlanIndex["tasks"][number] {
  const found = index.tasks.find((task) => task.id === id);
  if (found === undefined) throw new RelayError("not_found", "task not found", "task");
  return found;
}

async function ownerOf(
  runDir: string,
  id: string,
  state: RunState,
): Promise<string | undefined> {
  try {
    return (await readOwner(runDir, id)).session;
  } catch (error) {
    if (!(error instanceof RelayError) || error.code !== "not_found") throw error;
  }
  return state.tasks.find((task) => task.id === id)?.session;
}

async function loadPlanIndex(runDir: string): Promise<PlanIndex> {
  const rel = "10-plan/index.json";
  return readSchema(join(runDir, rel), rel, planIndexSchema, "index.json not found");
}

async function readSchema<T>(
  filePath: string,
  rel: string,
  schema: ZodType<T>,
  missing: string,
): Promise<T> {
  let value: unknown;
  try {
    value = await readJson(filePath);
  } catch (error) {
    if (isEnoent(error)) throw new RelayError("not_found", missing, rel);
    if (error instanceof RelayError && error.message === "invalid JSON") {
      throw new RelayError("validation", "invalid JSON", rel);
    }
    throw error;
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = fromZod(parsed.error);
    const fieldPath = issue.fieldPath.length === 0 ? rel : `${rel}:${issue.fieldPath}`;
    throw new RelayError("validation", issue.message, fieldPath);
  }
  return parsed.data;
}

async function ensureImplement(runDir: string, id: string, title: string): Promise<string> {
  const file = join(runDir, "20-implement", `${id}.md`);
  await mkdir(join(runDir, "20-implement"), { recursive: true });
  if (!(await exists(file))) {
    await atomicWrite(file, `# ${id}: ${title}\n\n## Files\n\n## Assumptions\n\n## Risks\n`);
  }
  return file;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isEnoent(error)) return false;
    throw error;
  }
}
