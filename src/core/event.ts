import { z } from "zod";
import {
  actionSchema,
  schemaVersion,
  stageSchema,
  taskIdSchema,
  toolSchema,
  utcTimestampSchema,
  viaSchema,
} from "./vocab.js";

export const sizeSchema = z.object({
  files: z.number().int().nonnegative(),
  added: z.number().int().nonnegative(),
  deleted: z.number().int().nonnegative(),
}).strict();

export const testsSchema = z.union([
  z.literal("not-configured"),
  z.object({
    exit: z.number().int(),
    ms: z.number().int().nonnegative(),
    tree: z.string().min(1),
  }).strict(),
]);

export const eventLineSchema = z.object({
  schema: z.literal(schemaVersion),
  ts: utcTimestampSchema,
  stage: stageSchema,
  action: actionSchema,
  tool: toolSchema.optional(),
  detected: toolSchema.optional(),
  actor: z.enum(["agent-env", "unknown"]).optional(),
  tests: testsSchema.optional(),
  question: z.string().min(1).optional(),
  answer: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  via: viaSchema.optional(),
  head: z.string().min(1).optional(),
  tree: z.string().min(1).optional(),
  size: sizeSchema.optional(),
  delta: sizeSchema.optional(),
  task: taskIdSchema.optional(),
  session: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  ref: z.string().min(1).optional(),
}).strict();

export type EventLine = z.infer<typeof eventLineSchema>;

export function parseEventLine(value: unknown): EventLine {
  return eventLineSchema.parse(value);
}
