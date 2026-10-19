import { join } from "node:path";
import { z } from "zod";
import { fromZod, RelayError } from "./error.js";
import { isEnoent, readJson } from "./files.js";
import { type RunState } from "./reduce.js";
import { schemaVersion, taskIdSchema } from "./vocab.js";

const filePathSchema = z.string().min(1);

export const tasksInputSchema = z.object({
  schema: z.literal(schemaVersion),
  tasks: z.array(
    z.object({
      title: z.string().min(1),
      deps: z.array(taskIdSchema),
      files: z.array(filePathSchema),
    }).strict(),
  ),
}).strict();

export const planIndexSchema = z.object({
  schema: z.literal(schemaVersion),
  tasks: z.array(
    z.object({
      id: taskIdSchema,
      title: z.string().min(1),
      deps: z.array(taskIdSchema),
      files: z.array(filePathSchema),
      path: z.string().min(1),
    }).strict(),
  ),
}).strict();

export type TasksInput = z.infer<typeof tasksInputSchema>;
export type PlanIndex = z.infer<typeof planIndexSchema>;

export function parseTasksInput(value: unknown): TasksInput {
  return tasksInputSchema.parse(value);
}

export function parsePlanIndex(value: unknown): PlanIndex {
  return planIndexSchema.parse(value);
}

export async function readPlanIndex(runDir: string): Promise<PlanIndex | null> {
  const rel = "10-plan/index.json";
  let value: unknown;
  try {
    value = await readJson(join(runDir, rel));
  } catch (error) {
    if (isEnoent(error)) return null;
    if (error instanceof RelayError && error.message === "invalid JSON") {
      throw new RelayError("validation", "invalid JSON", rel);
    }
    throw error;
  }
  const parsed = planIndexSchema.safeParse(value);
  if (!parsed.success) {
    const issue = fromZod(parsed.error);
    const fieldPath = issue.fieldPath.length === 0 ? rel : `${rel}:${issue.fieldPath}`;
    throw new RelayError("validation", issue.message, fieldPath);
  }
  return parsed.data;
}

export async function indexForImplement(
  runDir: string,
  state: RunState,
): Promise<PlanIndex | null> {
  const index = await readPlanIndex(runDir);
  if (index === null && openPlanTasks(null, state).length === 0) {
    throw new RelayError("not_found", "index.json not found", "10-plan/index.json");
  }
  return index;
}

export function openPlanTasks(index: PlanIndex | null, state: RunState): string[] {
  const byId = new Map(state.tasks.map((task) => [task.id, task.status]));
  const ids = index?.tasks.map((task) => task.id) ?? state.tasks.map((task) => task.id);
  return ids.filter((id) => {
    const status = byId.get(id) ?? "pending";
    return status === "pending" || status === "in-progress";
  });
}
