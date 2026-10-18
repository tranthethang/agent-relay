import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { fromZod, RelayError } from "./error.js";
import { type EventLine } from "./event.js";
import { isEnoent, readJson } from "./files.js";
import { gitHead, treeDiffSize, workTree } from "./git.js";
import { appendEvent, withRunLock } from "./mutate.js";
import { readPolicy } from "./policy.js";
import { type RunState } from "./reduce.js";
import { reviewJsonSchema } from "./review.js";
import { brainstormOpenSchema } from "./scaffold.js";
import { schemaVersion, toolSchema, viaSchema } from "./vocab.js";

const workflowStages = ["plan", "implement", "self-review", "cross-review"] as const;
const workflowStageSchema = z.enum(workflowStages);
const sizedStages = new Set<string>(["implement", "self-review", "cross-review"]);

const reviewDirs = [
  { dir: "30-self-review", stage: "self-review", rank: 0 },
  { dir: "40-cross-review", stage: "cross-review", rank: 1 },
] as const;

type Move = "approve" | "plan" | "implement start" | "implement done" | "review" | "close";

// The plan state diagram. `close --abandon` is allowed from every open lifecycle.
const allowedMoves: Record<RunState["lifecycle"], readonly Move[]> = {
  planned: ["approve", "plan"],
  approved: ["plan", "implement start"],
  implementing: ["implement done"],
  reviewing: ["review", "close"],
  closed: [],
  abandoned: [],
};

export type StageResult = {
  schema: 1;
  path: string;
  stage: (typeof workflowStages)[number];
  action: "started" | "completed";
  lifecycle: RunState["lifecycle"];
  head?: string;
  tree?: string;
  size?: { files: number; added: number; deleted: number };
};

export type ApproveResult = {
  schema: 1;
  path: string;
  approved: true;
  lifecycle: RunState["lifecycle"];
};

export type CloseResult = {
  schema: 1;
  path: string;
  lifecycle: "closed" | "abandoned";
};

export type ReviewIntegrity = {
  required: Array<"self" | "cross">;
  done: Array<"self" | "cross">;
  treeMatch: boolean | null;
  delta?: { files: number; added: number; deleted: number };
  waived: boolean;
};

export type BrainstormDoneResult = {
  schema: 1;
  path: string;
  open: number;
};

export function stageText(result: StageResult): string {
  const lines = [
    `stage: ${result.stage}`,
    `action: ${result.action}`,
    `lifecycle: ${result.lifecycle}`,
  ];
  if (result.head !== undefined) lines.push(`head: ${result.head}`);
  if (result.size !== undefined) {
    lines.push(`size: ${result.size.files} ${result.size.added} ${result.size.deleted}`);
  }
  return `${lines.join("\n")}\n`;
}

export function approveText(result: ApproveResult): string {
  return `approved: yes\nlifecycle: ${result.lifecycle}\n`;
}

export function closeText(result: CloseResult): string {
  return `lifecycle: ${result.lifecycle}\n`;
}

export function brainstormDoneText(result: BrainstormDoneResult): string {
  return `open: ${result.open}\n`;
}

export async function startStage(input: {
  runDir: string;
  stage: string;
  tool: string;
  model?: string;
}): Promise<StageResult> {
  return recordStage(input, "started");
}

export async function doneStage(input: {
  runDir: string;
  stage: string;
  tool: string;
  model?: string;
}): Promise<StageResult> {
  return recordStage(input, "completed");
}

export async function approveRun(input: {
  runDir: string;
  via: string;
}): Promise<ApproveResult> {
  const via = parseVia(input.via);
  return withRunLock(input.runDir, async (loaded) => {
    assertMove(loaded.run.state, "approve");
    const saved = await appendEvent(loaded, input.runDir, {
      stage: "plan",
      action: "approved",
      via,
    });
    return {
      schema: schemaVersion,
      path: input.runDir,
      approved: true,
      lifecycle: saved.run.state.lifecycle,
    };
  });
}

export async function closeRun(input: {
  runDir: string;
  via?: string;
  ackOpen?: boolean;
  ackFixes?: boolean;
  abandon?: string;
  waiveReview?: string;
}): Promise<CloseResult> {
  const via = input.via === undefined ? undefined : parseVia(input.via);
  const waiveReason = input.waiveReview?.trim();
  if (input.waiveReview !== undefined && waiveReason?.length === 0) {
    throw new RelayError("validation", "reason is empty", "waive-review");
  }
  return withRunLock(input.runDir, async (loaded) => {
    if (input.abandon !== undefined) {
      const reason = input.abandon.trim();
      if (reason.length === 0) throw new RelayError("validation", "reason is empty", "reason");
      const saved = await appendEvent(loaded, input.runDir, {
        stage: "run",
        action: "abandoned",
        reason,
        ...(via === undefined ? {} : { via }),
      });
      if (saved.run.state.lifecycle !== "abandoned") {
        throw new RelayError("validation", "close did not abandon the run", "state.lifecycle");
      }
      return { schema: schemaVersion, path: input.runDir, lifecycle: saved.run.state.lifecycle };
    }
    assertMove(loaded.run.state, "close");
    if (input.ackOpen !== true) await assertNoOpenQuestions(input.runDir, loaded.events);
    if (waiveReason !== undefined) {
      await appendEvent(loaded, input.runDir, {
        stage: "run",
        action: "waived",
        reason: waiveReason,
        ...(via === undefined ? {} : { via }),
      });
    } else {
      await assertReviewIntegrity(
        input.runDir,
        loaded.run.base,
        loaded.events,
        input.ackFixes === true,
      );
    }
    const saved = await appendEvent(loaded, input.runDir, {
      stage: "run",
      action: "closed",
      ...(via === undefined ? {} : { via }),
    });
    if (saved.run.state.lifecycle !== "closed") {
      throw new RelayError("validation", "close did not close the run", "state.lifecycle");
    }
    return { schema: schemaVersion, path: input.runDir, lifecycle: saved.run.state.lifecycle };
  });
}

export async function reviewIntegrity(
  runDir: string,
  base: string,
  events: readonly EventLine[],
): Promise<ReviewIntegrity> {
  const policy = await readPolicy(runDir, base);
  const tree = await workTree(runDir);
  const size = await treeDiffSize(runDir, base, tree);
  const required = size.added + size.deleted < policy.smallChange
    ? ["self"] as const
    : policy.requireReviews;
  const done: ReviewIntegrity["done"] = [];
  let latest: EventLine | undefined;
  for (const event of events) {
    if (event.action !== "completed") continue;
    if (event.stage !== "self-review" && event.stage !== "cross-review") continue;
    if (!done.includes(event.stage === "self-review" ? "self" : "cross")) {
      done.push(event.stage === "self-review" ? "self" : "cross");
    }
    latest = event;
  }
  return {
    required: [...required],
    done,
    treeMatch: latest === undefined ? null : latest.tree === tree,
    ...(latest?.delta === undefined ? {} : { delta: latest.delta }),
    waived: events.some((event) => event.action === "waived"),
  };
}

async function assertReviewIntegrity(
  runDir: string,
  base: string,
  events: readonly EventLine[],
  ackFixes: boolean,
): Promise<void> {
  const integrity = await reviewIntegrity(runDir, base, events);
  for (const kind of integrity.required) {
    if (!integrity.done.includes(kind)) {
      throw new RelayError("gate", `required ${kind} review is missing`, `${kind}-review`);
    }
  }
  if (integrity.treeMatch !== true) {
    throw new RelayError("gate", "latest review tree does not match current tree", "review.tree");
  }
  if (integrity.delta !== undefined && !ackFixes) {
    throw new RelayError("gate", "latest review has unacknowledged fixes", "review.delta");
  }
}

export async function finishBrainstorm(path: string): Promise<BrainstormDoneResult> {
  let value: unknown;
  try {
    value = await readJson(join(path, "open.json"));
  } catch (error) {
    if (isEnoent(error)) throw new RelayError("not_found", "open.json not found", "open.json");
    if (error instanceof RelayError && error.message === "invalid JSON") {
      throw new RelayError("validation", "invalid JSON", "open.json");
    }
    throw error;
  }
  const parsed = brainstormOpenSchema.safeParse(value);
  if (!parsed.success) {
    const issue = fromZod(parsed.error);
    const fieldPath = issue.fieldPath.length === 0 ? "open.json" : `open.json:${issue.fieldPath}`;
    throw new RelayError("validation", issue.message, fieldPath);
  }
  return { schema: schemaVersion, path, open: parsed.data.open.length };
}

async function recordStage(
  input: {
    runDir: string;
    stage: string;
    tool: string;
    model?: string;
  },
  action: "started" | "completed",
): Promise<StageResult> {
  const stage = parseStage(input.stage);
  const tool = parseTool(input.tool);
  const model = parseModel(input.model);
  return withRunLock(input.runDir, async (loaded) => {
    assertMove(loaded.run.state, stageMove(stage, action));
    const measured = action === "completed" && sizedStages.has(stage)
      ? await measure(input.runDir, loaded.run.base)
      : undefined;
    const saved = await appendEvent(loaded, input.runDir, {
      stage,
      action,
      tool,
      ...(model === undefined ? {} : { model }),
      ...(measured === undefined ? {} : {
        head: measured.head,
        tree: measured.tree,
        size: measured.size,
      }),
    });
    const result: StageResult = {
      schema: schemaVersion,
      path: input.runDir,
      stage,
      action,
      lifecycle: saved.run.state.lifecycle,
    };
    if (measured !== undefined) {
      result.head = measured.head;
      result.tree = measured.tree;
      result.size = measured.size;
    }
    return result;
  });
}

function stageMove(
  stage: (typeof workflowStages)[number],
  action: "started" | "completed",
): Move {
  if (stage === "plan") return "plan";
  if (stage === "implement") return action === "started" ? "implement start" : "implement done";
  return "review";
}

function assertMove(state: RunState, move: Move): void {
  if (move === "implement start" && !state.approved) {
    throw new RelayError(
      "gate",
      "implement start refused: plan is not approved",
      "state.approved",
    );
  }
  if (!allowedMoves[state.lifecycle].includes(move)) {
    throw new RelayError(
      "gate",
      `${move} refused: run is ${state.lifecycle}`,
      "state.lifecycle",
    );
  }
}

async function measure(
  runDir: string,
  base: string,
): Promise<{
  head: string;
  tree: string;
  size: { files: number; added: number; deleted: number };
}> {
  const head = await gitHead(runDir);
  const tree = await workTree(runDir);
  return { head, tree, size: await treeDiffSize(runDir, base, tree) };
}

async function assertNoOpenQuestions(runDir: string, events: readonly EventLine[]): Promise<void> {
  const latest = await latestReview(runDir, events);
  if (latest === null || latest.open === 0) return;
  throw new RelayError("gate", "latest review has open questions", latest.path);
}

// The folder whose review `completed` event is newest wins. Without events, cross beats self.
// A `ref` on that event names the exact file, so a later unfinished scaffold cannot hide it.
async function latestReview(
  runDir: string,
  events: readonly EventLine[],
): Promise<{ path: string; open: number } | null> {
  let newest: EventLine | undefined;
  for (const event of events) {
    if (event.action !== "completed") continue;
    if (reviewDirs.some((review) => review.stage === event.stage)) newest = event;
  }
  if (newest?.ref !== undefined) {
    const dir = reviewDirs.find((review) => review.stage === newest.stage)?.dir;
    if (dir === undefined || !new RegExp(`^${dir}/[0-9]+\\.json$`).test(newest.ref)) {
      throw new RelayError("validation", "invalid review ref", newest.ref);
    }
    return { path: newest.ref, open: await readReview(runDir, newest.ref) };
  }
  const hits: { done: number; rank: number; n: number; rel: string }[] = [];
  for (const review of reviewDirs) {
    let done = -1;
    events.forEach((event, index) => {
      if (event.stage === review.stage && event.action === "completed") done = index;
    });
    let names: string[];
    try {
      names = await readdir(join(runDir, review.dir));
    } catch (error) {
      if (isEnoent(error)) continue;
      throw error;
    }
    for (const name of names) {
      const match = /^([0-9]+)\.json$/.exec(name);
      if (match === null) continue;
      hits.push({ done, rank: review.rank, n: Number(match[1]), rel: `${review.dir}/${name}` });
    }
  }
  hits.sort((left, right) => left.done - right.done || left.rank - right.rank || left.n - right.n);
  const latest = hits[hits.length - 1];
  if (latest === undefined) return null;
  const value = await readReview(runDir, latest.rel);
  return { path: latest.rel, open: value };
}

async function readReview(runDir: string, rel: string): Promise<number> {
  let value: unknown;
  try {
    value = await readJson(join(runDir, rel));
  } catch (error) {
    if (error instanceof RelayError && error.message === "invalid JSON") {
      throw new RelayError("validation", "invalid JSON", rel);
    }
    throw error;
  }
  const parsed = reviewJsonSchema.safeParse(value);
  if (!parsed.success) {
    const issue = fromZod(parsed.error);
    const fieldPath = issue.fieldPath.length === 0 ? rel : `${rel}:${issue.fieldPath}`;
    throw new RelayError("validation", issue.message, fieldPath);
  }
  return parsed.data.open.length;
}

function parseStage(value: string): (typeof workflowStages)[number] {
  const parsed = workflowStageSchema.safeParse(value);
  if (!parsed.success) throw new RelayError("validation", "invalid stage", "stage");
  return parsed.data;
}

function parseTool(value: string): z.infer<typeof toolSchema> {
  const parsed = toolSchema.safeParse(value);
  if (!parsed.success) throw new RelayError("validation", "invalid tool", "tool");
  return parsed.data;
}

function parseVia(value: string): z.infer<typeof viaSchema> {
  const parsed = viaSchema.safeParse(value);
  if (!parsed.success) throw new RelayError("validation", "invalid via", "via");
  return parsed.data;
}

function parseModel(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.trim().length === 0) throw new RelayError("validation", "model is empty", "model");
  return value;
}
