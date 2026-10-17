import { z } from "zod";
import { schemaVersion, toolSchema } from "./vocab.js";

export const reviewKinds = ["self", "cross"] as const;
export const testResults = ["pass", "fail", "not-run"] as const;

const openChoiceSchema = z.object({
  q: z.string().min(1),
  a: z.string().min(1),
  b: z.string().min(1),
}).strict();

const openNeedSchema = z.object({
  q: z.string().min(1),
  need: z.string().min(1),
}).strict();

export const reviewJsonSchema = z.object({
  schema: z.literal(schemaVersion),
  kind: z.enum(reviewKinds),
  tool: toolSchema,
  model: z.string().min(1),
  fixed: z.number().int().nonnegative(),
  tests: z.enum(testResults),
  open: z.array(z.union([openChoiceSchema, openNeedSchema])),
}).strict();

export type ReviewJson = z.infer<typeof reviewJsonSchema>;

export function parseReviewJson(value: unknown): ReviewJson {
  return reviewJsonSchema.parse(value);
}
