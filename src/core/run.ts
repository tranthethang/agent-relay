import { z } from "zod";
import {
  lifecycleSchema,
  runIdSchema,
  schemaVersion,
  slugSchema,
  stageSchema,
  taskIdSchema,
  taskStatusSchema,
  ymdSchema,
} from "./vocab.js";

const runTaskSchema = z.object({
  id: taskIdSchema,
  status: taskStatusSchema,
  session: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
}).strict();

export const runJsonSchema = z.object({
  schema: z.literal(schemaVersion),
  id: runIdSchema,
  ymd: ymdSchema,
  slug: slugSchema,
  title: z.string().min(1),
  base: z.string().min(1),
  from: z.string().min(1).optional(),
  worktree: z.object({
    path: z.string().min(1),
    branch: z.string().min(1),
  }).strict().optional(),
  state: z.object({
    lifecycle: lifecycleSchema,
    stage: stageSchema,
    approved: z.boolean(),
    tasks: z.array(runTaskSchema),
  }).strict(),
}).strict();

export type RunJson = z.infer<typeof runJsonSchema>;

export function parseRunJson(value: unknown): RunJson {
  return runJsonSchema.parse(value);
}
