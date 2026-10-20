import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { type ZodType } from "zod";
import { assertClaimOwner, releaseClaimLock } from "./claim.js";
import { fromZod, RelayError } from "./error.js";
import { type EventLine } from "./event.js";
import { atomicWrite, isEnoent, readJson } from "./files.js";
import { changedPaths, workTree } from "./git.js";
import { appendEvent, openRun, withRunLock } from "./mutate.js";
import { normalizePath } from "./overlap.js";
import { readPolicy } from "./policy.js";
import { type RunState } from "./reduce.js";
import { outsidePaths } from "./scope.js";
import { type PlanIndex, planIndexSchema, type TasksInput, tasksInputSchema } from "./tasks.js";
import { schemaVersion, taskIdSchema } from "./vocab.js";
import { runGitCwd } from "./worktree.js";

const maxPlanTasks = 8;

export const overviewScaffold = `# Overview

## Goal

## Non-goals

## Decisions

## Constraints

## Flow
`;

export type PlanNewResult = {
  schema: 1;
  path: string;
  overview: string;
  tasks: string;
};

export type PlanDoneResult = {
  schema: 1;
  path: string;
  tasks: string[];
  index: string;
  warning?: string;
};

export type TaskMoveResult = {
  schema: 1;
  path: string;
  task: string;
  status: "in-progress" | "done" | "skipped";
  implement: string;
  reason?: string;
};

export function planNewText(result: PlanNewResult): string {
  return `${result.overview}\n${result.tasks}\n`;
}

export function planDoneText(result: PlanDoneResult): string {
  const tasks = result.tasks.length === 0 ? "none" : result.tasks.join(", ");
  const warning = result.warning === undefined ? "" : `warning: ${result.warning}\n`;
  return `tasks: ${tasks}\nindex: ${result.index}\n${warning}`;
}

export function taskMoveText(result: TaskMoveResult): string {
  const lines = [
    `task: ${result.task}`,
    `status: ${result.status}`,
    `implement: ${result.implement}`,
  ];
  if (result.reason !== undefined) lines.push(`reason: ${result.reason}`);
  return `${lines.join("\n")}\n`;
}

export function tasksInputScaffold(): string {
  return `${JSON.stringify({ schema: schemaVersion, tasks: [] })}\n`;
}

export function indexFromTasks(
  tasks: TasksInput["tasks"],
  ids?: readonly string[],
  strictPlan = true,
): PlanIndex {
  if (strictPlan && tasks.length > maxPlanTasks) {
    throw new RelayError("gate", "plan has more than 8 tasks", "tasks");
  }
  const assigned = tasks.map((task, index) => {
    const id = ids === undefined ? `T${index + 1}` : ids[index];
    if (id === undefined || !taskIdSchema.safeParse(id).success) {
      throw new RelayError("validation", "invalid task id", `tasks[${index}]`);
    }
    return {
      id,
      title: task.title,
      deps: task.deps,
      files: task.files,
      path: `10-plan/${id}.md`,
    };
  });
  const unique = new Set(assigned.map((task) => task.id));
  if (unique.size !== assigned.length) {
    throw new RelayError("validation", "duplicate task id", "tasks");
  }
  assertDeps(assigned);
  return planIndexSchema.parse({ schema: schemaVersion, tasks: assigned });
}

export async function planNew(runDir: string): Promise<PlanNewResult> {
  await openRun(runDir);
  const overview = join(runDir, "10-plan", "overview.md");
  const tasks = join(runDir, "10-plan", "tasks.input.json");
  await mkdir(join(runDir, "10-plan"), { recursive: true });
  if (await exists(overview)) {
    throw new RelayError("validation", "already exists", "10-plan/overview.md");
  }
  if (await exists(tasks)) {
    throw new RelayError("validation", "already exists", "10-plan/tasks.input.json");
  }
  await atomicWrite(overview, overviewScaffold);
  await atomicWrite(tasks, tasksInputScaffold());
  return { schema: schemaVersion, path: runDir, overview, tasks };
}

export async function planDone(runDir: string): Promise<PlanDoneResult> {
  return withRunLock(runDir, async (loaded) => {
    assertLifecycle(loaded.run.state, ["planned", "approved"], "plan done");
    const started = loaded.run.state.tasks.find((task) => task.status !== "pending");
    if (started !== undefined) {
      throw new RelayError("gate", `plan done refused: ${started.id} has started`, started.id);
    }
    const input = await readTasksInput(runDir);
    assertPlanFiles(input.tasks);
    const cwd = await runGitCwd(runDir, loaded.run);
    const policy = await readPolicy(cwd, loaded.run.base);
    const index = indexFromTasks(input.tasks, undefined, policy.strict.plan);
    await writePlanFiles(runDir, index);
    await appendEvent(loaded, runDir, { stage: "plan", action: "completed" });
    const result = doneResult(runDir, index);
    if (!policy.strict.plan && index.tasks.length > maxPlanTasks) {
      result.warning =
        `plan has ${index.tasks.length} tasks; strict.plan=false allows more than ${maxPlanTasks}`;
    }
    return result;
  });
}

export async function planAmend(runDir: string): Promise<PlanDoneResult> {
  return withRunLock(runDir, async (loaded) => {
    const current = await readIndex(runDir);
    const input = await readTasksInput(runDir);
    assertPlanFiles(input.tasks);
    const cwd = await runGitCwd(runDir, loaded.run);
    const policy = await readPolicy(cwd, loaded.run.base);
    const unmatched = new Map<string, string[]>();
    for (const task of current.tasks) {
      unmatched.set(task.title, [...(unmatched.get(task.title) ?? []), task.id]);
    }
    const matched = input.tasks.map((task) => unmatched.get(task.title)?.shift());
    for (const task of current.tasks) {
      if (matched.includes(task.id)) continue;
      if (hasStarted(loaded.run.state, task.id)) {
        throw new RelayError("gate", `plan amend refused: ${task.id} has started`, task.id);
      }
    }
    for (let index = 0; index < input.tasks.length; index += 1) {
      const id = matched[index];
      const task = input.tasks[index];
      if (id === undefined || task === undefined) continue;
      if (!hasStarted(loaded.run.state, id)) continue;
      const previous = current.tasks.find((item) => item.id === id);
      if (previous === undefined || sameDeps(previous.deps, task.deps)) continue;
      throw new RelayError("gate", `plan amend refused: ${id} has started`, `${id}.deps`);
    }
    let next = maxTaskNumber([
      ...current.tasks.map((task) => task.id),
      ...(await planFileIds(runDir)),
    ]);
    const ids = matched.map((existing) => {
      if (existing !== undefined) return existing;
      next += 1;
      return `T${next}`;
    });
    const index = indexFromTasks(input.tasks, ids, policy.strict.plan);
    await writePlanFiles(runDir, index);
    const result = doneResult(runDir, index);
    if (!policy.strict.plan && index.tasks.length > maxPlanTasks) {
      result.warning =
        `plan has ${index.tasks.length} tasks; strict.plan=false allows more than ${maxPlanTasks}`;
    }
    return result;
  });
}

export async function taskStart(runDir: string, task: string): Promise<TaskMoveResult> {
  const id = parseTaskId(task);
  return withRunLock(runDir, async (loaded) => {
    assertLifecycle(loaded.run.state, ["implementing"], "task start");
    const index = await readIndex(runDir);
    const item = requireTask(index, id);
    const current = taskStatus(loaded.run.state, id);
    if (current !== "pending") {
      throw new RelayError("gate", `task start refused: ${id} is ${current}`, id);
    }
    for (const dep of item.deps) {
      const status = taskStatus(loaded.run.state, dep);
      if (status !== "done" && status !== "skipped") {
        throw new RelayError("gate", `task start refused: ${dep} is ${status}`, `${id}.deps`);
      }
    }
    const implement = await writeImplementScaffold(runDir, item.id, item.title);
    const tree = await workTree(await runGitCwd(runDir, loaded.run));
    await appendEvent(loaded, runDir, {
      stage: "implement",
      action: "task-started",
      task: id,
      tree,
    });
    return moveResult(runDir, id, "in-progress", implement);
  });
}

export async function taskDone(
  runDir: string,
  task: string,
  session?: string,
  allowExtra?: string,
): Promise<TaskMoveResult> {
  const id = parseTaskId(task);
  return withRunLock(runDir, async (loaded) => {
    assertLifecycle(loaded.run.state, ["implementing"], "task done");
    const index = await readIndex(runDir);
    const item = requireTask(index, id);
    const current = taskStatus(loaded.run.state, id);
    if (current !== "in-progress") {
      throw new RelayError("gate", `task done refused: ${id} is ${current}`, id);
    }
    await assertClaimOwner(runDir, id, session);
    const from = startTree(loaded.events, id);
    if (from === undefined) {
      throw new RelayError("gate", `task done refused: ${id} has no start tree`, id);
    }
    const cwd = await runGitCwd(runDir, loaded.run);
    const policy = await readPolicy(cwd, loaded.run.base);
    const outside = outsidePaths(
      await changedPaths(cwd, from, await workTree(cwd)),
      item.files,
      otherFiles(index, loaded.run.state, loaded.events, id),
    );
    const extra = extraFields(id, outside, allowExtra, policy.strict.scope);
    await appendEvent(loaded, runDir, {
      stage: "implement",
      action: "task-done",
      task: id,
      ...extra,
    });
    await releaseClaimLock(runDir, id, session);
    const result = moveResult(runDir, id, "done", join(runDir, "20-implement", `${id}.md`));
    if (extra.reason !== undefined) result.reason = extra.reason;
    return result;
  });
}

export async function taskSkip(
  runDir: string,
  task: string,
  reason: string,
  session?: string,
): Promise<TaskMoveResult> {
  const id = parseTaskId(task);
  const text = reason.trim();
  if (text.length === 0) throw new RelayError("validation", "reason is empty", "reason");
  return withRunLock(runDir, async (loaded) => {
    assertLifecycle(loaded.run.state, ["implementing"], "task skip");
    const index = await readIndex(runDir);
    requireTask(index, id);
    const current = taskStatus(loaded.run.state, id);
    if (current === "done" || current === "skipped") {
      throw new RelayError("gate", `task skip refused: ${id} is ${current}`, id);
    }
    await assertClaimOwner(runDir, id, session);
    await appendEvent(loaded, runDir, {
      stage: "implement",
      action: "task-skipped",
      task: id,
      reason: text,
    });
    await releaseClaimLock(runDir, id, session);
    const result = moveResult(runDir, id, "skipped", join(runDir, "20-implement", `${id}.md`));
    result.reason = text;
    return result;
  });
}

function startTree(events: readonly EventLine[], id: string): string | undefined {
  let tree: string | undefined;
  for (const event of events) {
    if (event.task !== id) continue;
    if (event.action !== "task-started" && event.action !== "stolen") continue;
    if (event.tree !== undefined) tree = event.tree;
  }
  return tree;
}

function otherFiles(
  index: PlanIndex,
  state: RunState,
  events: readonly EventLine[],
  id: string,
): string[] {
  const active = new Set(
    state.tasks.filter((task) => task.id !== id && task.status === "in-progress").map((task) =>
      task.id
    ),
  );
  let startAt = -1;
  events.forEach((event, at) => {
    if (event.task === id && (event.action === "task-started" || event.action === "stolen")) {
      startAt = at;
    }
  });
  events.forEach((event, at) => {
    if (at > startAt && event.action === "task-done" && event.task !== id && event.task) {
      active.add(event.task);
    }
  });
  return index.tasks.filter((task) => active.has(task.id)).flatMap((task) => task.files);
}

function extraFields(
  id: string,
  outside: readonly string[],
  allowExtra: string | undefined,
  strict: boolean,
): { extra?: string[]; reason?: string } {
  if (outside.length === 0) return {};
  if (allowExtra === undefined && strict) {
    const shown = outside.slice(0, 10).join(", ");
    throw new RelayError(
      "gate",
      `task done refused: ${id} has edits outside its files: ${shown}`,
      id,
    );
  }
  const reason = allowExtra === undefined
    ? `scope warning: accepted outside task files under strict.scope=false (${outside.join(", ")})`
    : allowExtra.trim();
  if (reason.length === 0) throw new RelayError("validation", "reason is empty", "allow-extra");
  return { extra: [...outside], reason };
}

function doneResult(runDir: string, index: PlanIndex): PlanDoneResult {
  return {
    schema: schemaVersion,
    path: runDir,
    tasks: index.tasks.map((task) => task.id),
    index: join(runDir, "10-plan", "index.json"),
  };
}

function moveResult(
  runDir: string,
  task: string,
  status: TaskMoveResult["status"],
  implement: string,
): TaskMoveResult {
  return { schema: schemaVersion, path: runDir, task, status, implement };
}

function assertLifecycle(
  state: RunState,
  allowed: readonly RunState["lifecycle"][],
  verb: string,
): void {
  if (allowed.includes(state.lifecycle)) return;
  throw new RelayError("gate", `${verb} refused: run is ${state.lifecycle}`, "state.lifecycle");
}

function assertPlanFiles(tasks: TasksInput["tasks"]): void {
  tasks.forEach((task, index) => {
    task.files.forEach((file, fileIndex) => {
      try {
        normalizePath(file);
      } catch (error) {
        if (error instanceof RelayError) {
          throw new RelayError("validation", error.message, `tasks[${index}].files[${fileIndex}]`);
        }
        throw error;
      }
    });
  });
}

function hasStarted(state: RunState, id: string): boolean {
  return taskStatus(state, id) !== "pending";
}

function sameDeps(left: readonly string[], right: readonly string[]): boolean {
  const before = new Set(left);
  const after = new Set(right);
  if (before.size !== after.size) return false;
  for (const dep of before) {
    if (!after.has(dep)) return false;
  }
  return true;
}

function taskStatus(state: RunState, id: string): RunState["tasks"][number]["status"] {
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

function maxTaskNumber(ids: readonly string[]): number {
  let max = 0;
  for (const id of ids) {
    const number = Number(id.slice(1));
    if (number > max) max = number;
  }
  return max;
}

// A dropped task keeps its T<n>.md, so its id is never handed to a new task.
async function planFileIds(runDir: string): Promise<string[]> {
  const names = await readdir(join(runDir, "10-plan"));
  return names
    .filter((name) => /^T[1-9]\d*\.md$/.test(name))
    .map((name) => name.slice(0, -".md".length));
}

function assertDeps(tasks: PlanIndex["tasks"]): void {
  const order = new Map(tasks.map((task, index) => [task.id, index]));
  tasks.forEach((task, index) => {
    task.deps.forEach((dep, depIndex) => {
      if (!order.has(dep)) {
        throw new RelayError(
          "validation",
          `unknown id ${dep}`,
          `tasks[${index}].deps[${depIndex}]`,
        );
      }
    });
  });
  const cycle = findCycle(tasks);
  if (cycle !== null) {
    throw new RelayError(
      "validation",
      `cycle ${cycle.nodes.join(" ")}`,
      `tasks[${cycle.index}].deps[${cycle.depIndex}]`,
    );
  }
  tasks.forEach((task, index) => {
    task.deps.forEach((dep, depIndex) => {
      const at = order.get(dep);
      if (at !== undefined && at > index) {
        throw new RelayError(
          "validation",
          `forward dep ${dep}`,
          `tasks[${index}].deps[${depIndex}]`,
        );
      }
    });
  });
}

function findCycle(
  tasks: PlanIndex["tasks"],
): { nodes: string[]; index: number; depIndex: number } | null {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const color = new Map<string, number>();
  const stack: string[] = [];
  const visit = (id: string): { nodes: string[]; index: number; depIndex: number } | null => {
    const state = color.get(id) ?? 0;
    if (state === 1) {
      const start = stack.indexOf(id);
      const nodes = stack.slice(start);
      const from = stack.at(-1) ?? id;
      const owner = byId.get(from);
      const index = tasks.findIndex((task) => task.id === from);
      const depIndex = owner?.deps.indexOf(id) ?? 0;
      return { nodes, index, depIndex };
    }
    if (state === 2) return null;
    color.set(id, 1);
    stack.push(id);
    for (const dep of byId.get(id)?.deps ?? []) {
      if (!byId.has(dep)) continue;
      const found = visit(dep);
      if (found !== null) return found;
    }
    stack.pop();
    color.set(id, 2);
    return null;
  };
  for (const task of tasks) {
    const found = visit(task.id);
    if (found !== null) return found;
  }
  return null;
}

async function readTasksInput(runDir: string): Promise<TasksInput> {
  const rel = "10-plan/tasks.input.json";
  return readSchema(join(runDir, rel), rel, tasksInputSchema, "tasks.input.json not found");
}

async function readIndex(runDir: string): Promise<PlanIndex> {
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

async function writePlanFiles(runDir: string, index: PlanIndex): Promise<void> {
  await mkdir(join(runDir, "10-plan"), { recursive: true });
  await atomicWrite(join(runDir, "10-plan", "index.json"), `${JSON.stringify(index)}\n`);
  for (const task of index.tasks) {
    const file = join(runDir, "10-plan", `${task.id}.md`);
    if (await exists(file)) continue;
    await atomicWrite(file, `# ${task.id}: ${task.title}\n\n## Detail\n`);
  }
}

async function writeImplementScaffold(runDir: string, id: string, title: string): Promise<string> {
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
