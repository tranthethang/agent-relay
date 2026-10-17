import { z } from "zod";
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
