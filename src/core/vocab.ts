import { z } from "zod";

export const schemaVersion = 1;

export const stages = [
  "brainstorm",
  "plan",
  "implement",
  "self-review",
  "cross-review",
  "distill",
  "run",
] as const;

export const actions = [
  "created",
  "started",
  "completed",
  "decided",
  "approved",
  "closed",
  "waived",
  "abandoned",
  "task-started",
  "task-done",
  "task-skipped",
  "claimed",
  "released",
  "stolen",
] as const;

export const tools = [
  "cursor",
  "claude-code",
  "cowork",
  "codex",
  "antigravity",
  "kiro",
  "unknown",
] as const;

export type Tool = (typeof tools)[number];

export const viaValues = ["confirm", "arg"] as const;

export const stageSchema = z.enum(stages);
export const actionSchema = z.enum(actions);
export const toolSchema = z.enum(tools);
export const viaSchema = z.enum(viaValues);

export const taskIdSchema = z.string().regex(/^T[1-9][0-9]*$/);
export const runIdSchema = z.string().regex(/^[0-9]{10,11}$/);
export const ymdSchema = z.string().regex(/^[0-9]{8}$/);
export const slugSchema = z.string().regex(/^[a-z]+(-[a-z]+)*$/);

export const runDirNamePattern = /^[0-9]{8}-[0-9]{10,11}-[a-z]+(-[a-z]+)*$/;
export const brainstormDirNamePattern = /^[0-9]{8}-[a-z0-9]+(-[a-z0-9]+)*$/;

export const utcTimestampSchema = z.iso.datetime({ local: false, offset: false });

export const lifecycles = [
  "planned",
  "approved",
  "implementing",
  "reviewing",
  "closed",
  "abandoned",
] as const;

export const taskStatuses = ["pending", "in-progress", "done", "skipped"] as const;

export const lifecycleSchema = z.enum(lifecycles);
export const taskStatusSchema = z.enum(taskStatuses);
