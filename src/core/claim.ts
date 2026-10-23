import { mkdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { type ZodType } from "zod";
import { type RebuildResult, rebuildRun } from "./cache.js";
import { detectTool } from "./detect.js";
import { fromZod, RelayError } from "./error.js";
import { type EventLine } from "./event.js";
import { atomicWrite, isEnoent, readJson } from "./files.js";
import { gitHead, treeStatus, workTree } from "./git.js";
import {
  acquireLock,
  createStealGuard,
  type LockFile,
  readOwner,
  recordLockWorktree,
  releaseLock,
  removeLock,
  removeStealGuard,
  stealLock,
} from "./lock.js";
import { appendEvent, withRunLock } from "./mutate.js";
import { overlappingTask } from "./overlap.js";
import { readPolicy } from "./policy.js";
import { type RunState } from "./reduce.js";
import { type PlanIndex, planIndexSchema } from "./tasks.js";
import { schemaVersion, taskIdSchema, taskStatuses } from "./vocab.js";
import {
  addTaskWorktree,
  mainRoot,
  mergeTaskBranch,
  releaseTaskWorktree,
  rollbackWorktree,
  runGitCwd,
  taskWorktreeRecord,
  type WorktreeRecord,
} from "./worktree.js";

type TaskStatus = (typeof taskStatuses)[number];

export type ClaimResult = {
  schema: 1;
  path: string;
  task: string;
  status: "in-progress";
  session: string;
  action: "claimed" | "stolen";
  implement: string;
  worktree?: WorktreeRecord;
};

export type IntegrateResult = {
  schema: 1;
  path: string;
  task: string;
  branch: string;
  merged: boolean;
  paths: string[];
  worktree?: "kept";
  worktreeReason?: string;
};

export type ReleaseResult = {
  schema: 1;
  path: string;
  task: string;
  session: string;
  action: "released";
  forced: boolean;
  reason?: string;
  worktree?: "removed" | "kept";
  worktreeReason?: string;
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
  const lines = [
    `task: ${result.task}`,
    `status: ${result.status}`,
    `session: ${result.session}`,
    `action: ${result.action}`,
    `implement: ${result.implement}`,
  ];
  if (result.worktree !== undefined) {
    lines.push(`worktree: ${result.worktree.path}`, `branch: ${result.worktree.branch}`);
  }
  return `${lines.join("\n")}\n`;
}

export function releaseText(result: ReleaseResult): string {
  const lines = [
    `task: ${result.task}`,
    `session: ${result.session}`,
    `action: ${result.action}`,
  ];
  if (result.reason !== undefined) lines.push(`reason: ${result.reason}`);
  if (result.worktree === "removed") lines.push("worktree: removed");
  if (result.worktree === "kept") {
    lines.push(`worktree: kept (${result.worktreeReason ?? "unknown"})`);
  }
  return `${lines.join("\n")}\n`;
}

export function integrateText(result: IntegrateResult): string {
  const lines = [
    `task: ${result.task}`,
    `branch: ${result.branch}`,
    `merged: ${result.merged ? "yes" : "no"}`,
  ];
  for (const path of result.paths) lines.push(`conflict: ${path}`);
  if (result.worktree === "kept") {
    lines.push(`worktree: kept (${result.worktreeReason ?? "unknown"})`);
  } else if (!result.merged) lines.push("worktree: kept");
  return `${lines.join("\n")}\n`;
}

export function listText(result: ListResult): string {
  if (result.tasks.length === 0) return "tasks: none\n";
  return `${result.tasks.map(listLine).join("\n")}\n`;
}

async function readLock(runDir: string, task: string): Promise<LockFile | undefined> {
  try {
    return await readOwner(runDir, task);
  } catch (error) {
    if (error instanceof RelayError && error.code === "not_found") return undefined;
    throw error;
  }
}

async function claimWorktree(
  runDir: string,
  loaded: RebuildResult,
  task: string,
): Promise<WorktreeRecord | undefined> {
  const cwd = await runGitCwd(runDir, loaded.run);
  const policy = await readPolicy(cwd, loaded.run.base);
  if (policy.worktree?.enabled !== true) return undefined;
  const relayDir = await realpath(dirname(runDir));
  const root = dirname(relayDir);
  return addTaskWorktree({
    root,
    relayDir,
    dir: policy.worktree.dir,
    runName: basename(runDir),
    task,
    head: await gitHead(cwd),
  });
}

async function rollbackClaimWorktree(runDir: string, record: WorktreeRecord): Promise<void> {
  const root = dirname(await realpath(dirname(runDir)));
  await rollbackWorktree(root, record.path, record.branch);
}

async function releaseClaimWorktree(
  runDir: string,
  loaded: RebuildResult,
  owner: LockFile | undefined,
): Promise<{ removed: boolean; reason?: string } | undefined> {
  if (owner?.path === undefined || owner.branch === undefined) return undefined;
  const root = dirname(await realpath(dirname(runDir)));
  return releaseTaskWorktree(
    root,
    { path: owner.path, branch: owner.branch },
    await runGitCwd(runDir, loaded.run),
  );
}

export async function integrateTask(runDir: string, task: string): Promise<IntegrateResult> {
  const id = parseTaskId(task);
  return withRunLock(runDir, async (loaded) => {
    assertImplementing(loaded.run.state, "integrate");
    const index = await loadPlanIndex(runDir);
    const item = requireTask(index, id);
    assertDeps(loaded.run.state, id, item.deps, "integrate");
    const record = await locateTaskWorktree(runDir, loaded, id);
    const checkout = await runGitCwd(runDir, loaded.run);
    const status = await treeStatus(record.path);
    if (status.length > 0) {
      return {
        schema: schemaVersion,
        path: record.path,
        task: id,
        branch: record.branch,
        merged: false,
        paths: [],
        worktree: "kept",
        worktreeReason: "worktree has uncommitted changes; commit before integrate",
      };
    }
    const merged = await mergeTaskBranch(checkout, record.branch);
    if (!merged.merged) {
      return {
        schema: schemaVersion,
        path: record.path,
        task: id,
        branch: record.branch,
        merged: false,
        paths: merged.paths,
      };
    }
    const removal = await releaseTaskWorktree(await mainRoot(runDir), record, checkout);
    if (!removal.removed) {
      return {
        schema: schemaVersion,
        path: record.path,
        task: id,
        branch: record.branch,
        merged: true,
        paths: [],
        worktree: "kept",
        worktreeReason: removal.reason,
      };
    }
    const actor = detectTool(process.env) === undefined ? "unknown" : "agent-env";
    await appendEvent(loaded, runDir, {
      stage: "run",
      action: "cleaned",
      actor,
      task: id,
      ref: record.branch,
    });
    return {
      schema: schemaVersion,
      path: record.path,
      task: id,
      branch: record.branch,
      merged: true,
      paths: [],
    };
  });
}

async function locateTaskWorktree(
  runDir: string,
  loaded: RebuildResult,
  task: string,
): Promise<WorktreeRecord> {
  const owner = await readLock(runDir, task);
  if (owner?.path !== undefined && owner.branch !== undefined) {
    return { path: owner.path, branch: owner.branch };
  }
  const record = await taskWorktreeRecord(runDir, loaded.run, task);
  if (record !== undefined) return record;
  const cwd = await runGitCwd(runDir, loaded.run);
  const policy = await readPolicy(cwd, loaded.run.base);
  if (policy.worktree?.enabled !== true) {
    throw new RelayError("gate", "integrate refused: worktree is off", "worktree.enabled");
  }
  throw new RelayError("not_found", "task worktree not found", task);
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
    let taskTree: WorktreeRecord | undefined;
    try {
      await assertNoOverlap(runDir, index, id, session);
      taskTree = await claimWorktree(runDir, loaded, id);
      if (taskTree !== undefined) await recordLockWorktree(runDir, id, session, taskTree);
      const implement = await ensureImplement(runDir, item.id, item.title);
      const tree = await workTree(await runGitCwd(runDir, loaded.run));
      await appendAll(loaded, runDir, [
        { stage: "implement", action: "claimed", task: id, session },
        { stage: "implement", action: "task-started", task: id, session, tree },
      ]);
      const result: ClaimResult = {
        schema: schemaVersion,
        path: runDir,
        task: id,
        status: "in-progress",
        session,
        action: "claimed",
        implement,
      };
      if (taskTree !== undefined) result.worktree = taskTree;
      return result;
    } catch (error) {
      if (taskTree !== undefined) await rollbackClaimWorktree(runDir, taskTree);
      await releaseLock(runDir, id, session);
      throw error;
    }
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
    const owner = await readLock(runDir, id);
    if (force) {
      if (text.length === 0) throw new RelayError("validation", "reason is empty", "reason");
      await removeLock(runDir, id);
    } else {
      if (text.length > 0) throw new RelayError("usage", "reason requires --force", "reason");
      await releaseLock(runDir, id, session);
    }
    const kept = await releaseClaimWorktree(runDir, loaded, owner);
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
    if (kept?.removed === true) result.worktree = "removed";
    if (kept?.removed === false) {
      result.worktree = "kept";
      if (kept.reason !== undefined) result.worktreeReason = kept.reason;
    }
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
      const lock = await stealLock(runDir, id, session, ttlMinutes * 60_000);
      const implement = await ensureImplement(runDir, item.id, item.title);
      const tree = await workTree(await runGitCwd(runDir, loaded.run));
      await appendEvent(loaded, runDir, {
        stage: "implement",
        action: "stolen",
        task: id,
        session,
        tree,
      });
      const result: ClaimResult = {
        schema: schemaVersion,
        path: runDir,
        task: id,
        status: "in-progress",
        session,
        action: "stolen",
        implement,
      };
      if (lock.path !== undefined && lock.branch !== undefined) {
        result.worktree = { path: lock.path, branch: lock.branch };
      }
      return result;
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
    const blocked = item.deps.filter((dep) => !isClear(taskStatus(loaded.run.state, dep)));
    const owner = await ownerOf(runDir, item.id, loaded.run.state);
    const row: ListTask = { id: item.id, status: taskStatus(loaded.run.state, item.id), blocked };
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
  const current = taskStatus(state, id);
  if (current === "done" || current === "skipped") {
    throw new RelayError("gate", `${verb} refused: ${id} is ${current}`, id);
  }
}

function assertDeps(state: RunState, id: string, deps: readonly string[], verb: string): void {
  for (const dep of deps) {
    const status = taskStatus(state, dep);
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

export function taskStatus(state: RunState, id: string): TaskStatus {
  return state.tasks.find((task) => task.id === id)?.status ?? "pending";
}

export function parseTaskId(value: string): string {
  const parsed = taskIdSchema.safeParse(value);
  if (!parsed.success) throw new RelayError("validation", "invalid task id", "task");
  return parsed.data;
}

export function requireTask(index: PlanIndex, id: string): PlanIndex["tasks"][number] {
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

export async function loadPlanIndex(runDir: string): Promise<PlanIndex> {
  const rel = "10-plan/index.json";
  return readSchema(join(runDir, rel), rel, planIndexSchema, "index.json not found");
}

export async function readSchema<T>(
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

export async function ensureImplement(runDir: string, id: string, title: string): Promise<string> {
  const file = join(runDir, "20-implement", `${id}.md`);
  await mkdir(join(runDir, "20-implement"), { recursive: true });
  if (!(await exists(file))) {
    await atomicWrite(file, `# ${id}: ${title}\n\n## Files\n\n## Assumptions\n\n## Risks\n`);
  }
  return file;
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isEnoent(error)) return false;
    throw error;
  }
}
