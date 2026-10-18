import { basename, join } from "node:path";
import { rebuildRun } from "./cache.js";
import { fromZod, RelayError } from "./error.js";
import { isEnoent, readJson } from "./files.js";
import { type RunState } from "./reduce.js";
import { type RunJson } from "./run.js";
import { type ReviewEvidence, reviewEvidenceFor } from "./status.js";
import { type PlanIndex, planIndexSchema } from "./tasks.js";
import { schemaVersion, taskIdSchema } from "./vocab.js";

type TaskView = {
  id: string;
  status: RunState["tasks"][number]["status"];
  session?: string;
  reason?: string;
  path: string;
  implement: string;
  files: string[];
};

export type ContextResult = {
  schema: 1;
  run: {
    name: string;
    path: string;
    id: string;
    ymd: string;
    slug: string;
    title: string;
    base: string;
    from?: string;
  };
  stage: RunState["stage"];
  lifecycle: RunState["lifecycle"];
  approved: boolean;
  tasks: TaskView[];
  reviews: { self: ReviewEvidence | null; cross: ReviewEvidence | null };
  brainstorm: string | null;
  paths: {
    plan: string[];
    implement: string[];
    "self-review": string[];
    "cross-review": string[];
    distill: string[];
    run: string[];
  };
  task?: { id: string; plan: string; implement: string };
  warnings?: string[];
};

export async function contextFor(runDir: string, task: string | undefined): Promise<ContextResult> {
  const loaded = await rebuildRun(runDir);
  const index = await readIndex(runDir);
  const tasks = mergeTasks(loaded.run.state, index);
  const reviews = {
    self: await reviewEvidenceFor(runDir, loaded.events, "self"),
    cross: await reviewEvidenceFor(runDir, loaded.events, "cross"),
  };
  const result: ContextResult = {
    schema: schemaVersion,
    run: runFields(runDir, loaded.run),
    stage: loaded.run.state.stage,
    lifecycle: loaded.run.state.lifecycle,
    approved: loaded.run.state.approved,
    tasks,
    reviews,
    brainstorm: loaded.run.from ?? null,
    paths: stagePaths(tasks),
  };
  if (loaded.warning !== null) result.warnings = [loaded.warning];
  if (task === undefined) return result;
  result.task = focusedTask(tasks, task);
  return result;
}

export function contextText(result: ContextResult): string {
  const lines = [
    `run: ${result.run.name}`,
    `stage: ${result.stage}`,
    `status: ${result.lifecycle}`,
    `approved: ${result.approved ? "yes" : "no"}`,
    `brainstorm: ${result.brainstorm ?? "none"}`,
    `tasks: ${
      result.tasks.length === 0
        ? "none"
        : result.tasks.map((task) => `${task.id} ${task.status}`).join(", ")
    }`,
  ];
  if (result.task !== undefined) {
    lines.push(`plan: ${result.task.plan}`);
    lines.push(`implement: ${result.task.implement}`);
  }
  return `${lines.join("\n")}\n`;
}

function runFields(runDir: string, run: RunJson): ContextResult["run"] {
  const fields: ContextResult["run"] = {
    name: basename(runDir),
    path: runDir,
    id: run.id,
    ymd: run.ymd,
    slug: run.slug,
    title: run.title,
    base: run.base,
  };
  if (run.from !== undefined) fields.from = run.from;
  return fields;
}

function stagePaths(tasks: TaskView[]): ContextResult["paths"] {
  const plan = ["10-plan/overview.md", "10-plan/tasks.input.json", "10-plan/index.json"];
  for (const task of tasks) plan.push(task.path);
  const implement = tasks.length === 0 ? ["20-implement/"] : tasks.map((task) => task.implement);
  return {
    plan,
    implement,
    "self-review": ["30-self-review/"],
    "cross-review": ["40-cross-review/"],
    distill: ["90-distill/manifest.json"],
    run: ["run.json", "events.jsonl"],
  };
}

function mergeTasks(state: RunState, index: PlanIndex | null): TaskView[] {
  const byId = new Map(state.tasks.map((task) => [task.id, task]));
  const seen = new Set<string>();
  const views: TaskView[] = [];
  for (const item of index?.tasks ?? []) {
    seen.add(item.id);
    views.push(viewFor(item.id, byId.get(item.id), item.path, item.files));
  }
  for (const task of state.tasks) {
    if (seen.has(task.id)) continue;
    views.push(viewFor(task.id, task, `10-plan/${task.id}.md`, []));
  }
  return views;
}

function viewFor(
  id: string,
  task: RunState["tasks"][number] | undefined,
  path: string,
  files: string[],
): TaskView {
  const view: TaskView = {
    id,
    status: task?.status ?? "pending",
    path,
    implement: `20-implement/${id}.md`,
    files,
  };
  if (task?.session !== undefined) view.session = task.session;
  if (task?.reason !== undefined) view.reason = task.reason;
  return view;
}

function focusedTask(
  tasks: TaskView[],
  task: string,
): { id: string; plan: string; implement: string } {
  const parsed = taskIdSchema.safeParse(task);
  if (!parsed.success) {
    const issue = fromZod(parsed.error);
    throw new RelayError(issue.code, issue.message, "task");
  }
  const found = tasks.find((item) => item.id === parsed.data);
  if (found === undefined) throw new RelayError("not_found", "task not found", "task");
  return { id: found.id, plan: found.path, implement: found.implement };
}

async function readIndex(runDir: string): Promise<PlanIndex | null> {
  let value: unknown;
  try {
    value = await readJson(join(runDir, "10-plan", "index.json"));
  } catch (error) {
    if (isEnoent(error)) return null;
    if (error instanceof RelayError && error.message === "invalid JSON") {
      throw new RelayError("validation", "invalid JSON", "10-plan/index.json");
    }
    throw error;
  }
  const parsed = planIndexSchema.safeParse(value);
  if (!parsed.success) {
    const issue = fromZod(parsed.error);
    const fieldPath = issue.fieldPath.length === 0
      ? "10-plan/index.json"
      : `10-plan/index.json:${issue.fieldPath}`;
    throw new RelayError(issue.code, issue.message, fieldPath);
  }
  return parsed.data;
}
