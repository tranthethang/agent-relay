import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { type RebuildResult, rebuildRun } from "./cache.js";
import { detectTool } from "./detect.js";
import { fromZod, RelayError } from "./error.js";
import { type EventLine } from "./event.js";
import { isEnoent, readJson } from "./files.js";
import { changedPaths, gitHead, treeDiffSize, treeStatus, workTree } from "./git.js";
import { appendEvent, withRunLock } from "./mutate.js";
import { readPolicy } from "./policy.js";
import { type RunState } from "./reduce.js";
import { parseReviewJson, readReviewDocument } from "./review.js";
import { brainstormOpenSchema } from "./scaffold.js";
import { outsidePaths } from "./scope.js";
import { openPlanTasks, planIndexSchema, readPlanIndex } from "./tasks.js";
import { schemaVersion, toolSchema, viaSchema } from "./vocab.js";
import {
  gitCwd,
  keepReason,
  mainRoot,
  removeMergedWorktree,
  runGitCwd,
  validateRunWorktree,
  type WorktreeRecord,
  type WorktreeRemoval,
} from "./worktree.js";

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
  warning?: string;
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
  worktree?: WorktreeRemoval;
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
  if (result.warning !== undefined) lines.push(`warning: ${result.warning}`);
  return `${lines.join("\n")}\n`;
}

export function approveText(result: ApproveResult): string {
  return `approved: yes\nlifecycle: ${result.lifecycle}\n`;
}

export function closeText(result: CloseResult): string {
  const lines = [`lifecycle: ${result.lifecycle}`];
  if (result.worktree?.removed === true) lines.push("worktree: removed");
  if (result.worktree?.reason !== undefined) {
    lines.push(`worktree: kept (${result.worktree.reason})`);
  }
  return `${lines.join("\n")}\n`;
}

export type ApprovePreview = {
  schema: 1;
  goal: string;
  decisions: string;
  tasks: number;
};

export type ClosePreview = {
  schema: 1;
  recommend: "y" | "n";
  reasons: string[];
  worktree?: { remove: boolean; reason?: string };
};

export function approvePreviewText(result: ApprovePreview): string {
  return `Goal:\n${result.goal}\n\nDecisions:\n${result.decisions}\n\ntasks: ${result.tasks}\n`;
}

export function closePreviewText(result: ClosePreview): string {
  const reasons = result.reasons.length === 0 ? "" : `${result.reasons.join("\n")}\n`;
  let worktree = "";
  if (result.worktree?.remove === true) worktree = "worktree: close will remove it\n";
  if (result.worktree?.reason !== undefined) {
    worktree = `worktree: close will keep it (${result.worktree.reason})\n`;
  }
  return `recommend: ${result.recommend}\n${reasons}${worktree}`;
}

export function sectionText(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const start = lines.indexOf(`## ${heading}`);
  if (start === -1) return "";
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    body.push(line);
  }
  return body.join("\n").trim();
}

export async function approvePreview(runDir: string): Promise<ApprovePreview> {
  let overview = "";
  try {
    overview = await readFile(join(runDir, "10-plan/overview.md"), "utf8");
  } catch (error) {
    if (!isEnoent(error)) throw error;
  }
  return {
    schema: schemaVersion,
    goal: sectionText(overview, "Goal"),
    decisions: sectionText(overview, "Decisions"),
    tasks: await taskCount(runDir),
  };
}

export async function closePreview(runDir: string): Promise<ClosePreview> {
  const loaded = await rebuildRun(runDir);
  const reasons = await closeReasons(runDir, loaded.run.base, loaded.events);
  const preview: ClosePreview = {
    schema: schemaVersion,
    recommend: reasons.length === 0 ? "y" : "n",
    reasons,
  };
  if (loaded.run.worktree !== undefined) {
    const reason = await keepReason(
      await mainRoot(runDir),
      basename(runDir),
      loaded.run.worktree,
    );
    preview.worktree = reason === null ? { remove: true } : { remove: false, reason };
  }
  return preview;
}

async function closeReasons(
  runDir: string,
  base: string,
  events: readonly EventLine[],
): Promise<string[]> {
  const reasons: string[] = [];
  const integrity = await reviewIntegrity(runDir, base, events);
  for (const kind of integrity.required) {
    if (!integrity.done.includes(kind)) reasons.push(`missing ${kind} review`);
  }
  if (integrity.treeMatch === false) reasons.push("tree mismatch");
  if (integrity.delta !== undefined) reasons.push("reviewer changes after latest review");
  const latest = await latestReview(runDir, events);
  if (latest !== null && latest.open > 0) reasons.push("open items");
  const completed = [...events].reverse().find((event) =>
    event.action === "completed"
    && (event.stage === "self-review" || event.stage === "cross-review")
  );
  if (
    completed?.tests !== undefined && completed.tests !== "not-configured"
    && completed.tests.exit !== 0
  ) {
    reasons.push("failed tests");
  }
  return reasons;
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
  allowExtra?: string;
}): Promise<StageResult> {
  return recordStage(input, "completed");
}

export async function approveRun(input: {
  runDir: string;
  via: string;
}): Promise<ApproveResult> {
  const via = parseVia(input.via);
  const actor = detectTool(process.env) === undefined ? "unknown" : "agent-env";
  return withRunLock(input.runDir, async (loaded) => {
    assertMove(loaded.run.state, "approve");
    const saved = await appendEvent(loaded, input.runDir, {
      stage: "plan",
      action: "approved",
      via,
      actor,
    });
    return {
      schema: schemaVersion,
      path: input.runDir,
      approved: true,
      lifecycle: saved.run.state.lifecycle,
    };
  });
}

async function executeAbandon(
  loaded: RebuildResult,
  runDir: string,
  rawReason: string,
  actor: "agent-env" | "unknown",
  via?: EventLine["via"],
): Promise<CloseResult> {
  const reason = rawReason.trim();
  if (reason.length === 0) throw new RelayError("validation", "reason is empty", "reason");
  const saved = await appendEvent(loaded, runDir, {
    stage: "run",
    action: "abandoned",
    reason,
    actor,
    ...(via === undefined ? {} : { via }),
  });
  if (saved.run.state.lifecycle !== "abandoned") {
    throw new RelayError("validation", "close did not abandon the run", "state.lifecycle");
  }
  return { schema: schemaVersion, path: runDir, lifecycle: saved.run.state.lifecycle };
}

async function cleanupWorktreeOnClose(
  runDir: string,
  worktree: WorktreeRecord,
  saved: { run: RebuildResult["run"]; event: EventLine },
  loadedEvents: readonly EventLine[],
  actor: "agent-env" | "unknown",
): Promise<WorktreeRemoval> {
  try {
    const root = await mainRoot(runDir);
    const removal = await removeMergedWorktree(root, {
      name: basename(runDir),
      worktree,
    });
    if (removal.removed) {
      try {
        await appendEvent(
          { run: saved.run, events: [...loadedEvents, saved.event], warning: null },
          runDir,
          {
            stage: "run",
            action: "cleaned",
            actor,
          },
        );
      } catch {
        // Swallow event write failure to report removal and preserve closed run
      }
    }
    return removal;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { removed: false, reason: `worktree cleanup failed: ${message}` };
  }
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
  const actor = detectTool(process.env) === undefined ? "unknown" : "agent-env";
  const waiveReason = input.waiveReview?.trim();
  if (input.waiveReview !== undefined && waiveReason?.length === 0) {
    throw new RelayError("validation", "reason is empty", "waive-review");
  }
  return withRunLock(input.runDir, async (loaded) => {
    if (input.abandon !== undefined) {
      return executeAbandon(loaded, input.runDir, input.abandon, actor, via);
    }
    assertMove(loaded.run.state, "close");
    const policy = await readPolicy(await gitCwd(input.runDir), loaded.run.base);
    const softClose = !policy.strict.reviewIntegrity && via !== undefined;
    if (input.ackOpen !== true && !softClose) {
      await assertNoOpenQuestions(input.runDir, loaded.events);
    }
    const warnings = softClose
      ? await closeReasons(input.runDir, loaded.run.base, loaded.events)
      : [];
    if (waiveReason !== undefined) {
      await appendEvent(loaded, input.runDir, {
        stage: "run",
        action: "waived",
        reason: waiveReason,
        actor,
        ...(via === undefined ? {} : { via }),
      });
    } else if (!softClose) {
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
      actor,
      ...(warnings.length === 0
        ? {}
        : { reason: `non-strict review-integrity warnings: ${warnings.join(", ")}` }),
      ...(via === undefined ? {} : { via }),
    });
    if (saved.run.state.lifecycle !== "closed") {
      throw new RelayError("validation", "close did not close the run", "state.lifecycle");
    }
    const result: CloseResult = {
      schema: schemaVersion,
      path: input.runDir,
      lifecycle: saved.run.state.lifecycle,
    };
    if (loaded.run.worktree !== undefined) {
      result.worktree = await cleanupWorktreeOnClose(
        input.runDir,
        loaded.run.worktree,
        saved,
        loaded.events,
        actor,
      );
    }
    return result;
  });
}

export function reviewProgress(events: readonly EventLine[]): {
  done: ReviewIntegrity["done"];
  latest: EventLine | undefined;
} {
  const done: ReviewIntegrity["done"] = [];
  let latest: EventLine | undefined;
  for (const event of events) {
    if (event.action !== "completed") continue;
    if (event.stage !== "self-review" && event.stage !== "cross-review") continue;
    const kind = event.stage === "self-review" ? "self" : "cross";
    if (!done.includes(kind)) done.push(kind);
    latest = event;
  }
  return { done, latest };
}

export async function reviewIntegrity(
  runDir: string,
  base: string,
  events: readonly EventLine[],
): Promise<ReviewIntegrity> {
  const cwd = await integrityCwd(runDir, events);
  if (cwd === null) return removedIntegrity(runDir, base, events);
  const policy = await readPolicy(cwd, base);
  const tree = await workTree(cwd);
  const size = await treeDiffSize(cwd, base, tree);
  const required = size.added + size.deleted < policy.smallChange
    ? ["self"] as const
    : policy.requireReviews;
  const { done, latest } = reviewProgress(events);
  return {
    required: [...required],
    done,
    treeMatch: latest === undefined ? null : latest.tree === tree,
    ...(latest?.delta === undefined ? {} : { delta: latest.delta }),
    waived: events.some((event) => event.action === "waived"),
  };
}

// `null` means `close` removed the worktree of this closed run.
async function integrityCwd(runDir: string, events: readonly EventLine[]): Promise<string | null> {
  try {
    return await gitCwd(runDir);
  } catch (error) {
    const removed = error instanceof RelayError && error.fieldPath === "run.json:worktree.path"
      && events.some((event) => event.action === "closed");
    if (removed) return null;
    throw error;
  }
}

// A closed run without its worktree has no live tree. Size comes from the latest review tree.
async function removedIntegrity(
  runDir: string,
  base: string,
  events: readonly EventLine[],
): Promise<ReviewIntegrity> {
  const policy = await readPolicy(runDir, base);
  const { done, latest } = reviewProgress(events);
  const size = latest?.tree === undefined
    ? { added: 0, deleted: 0 }
    : await treeDiffSize(runDir, base, latest.tree);
  const required = size.added + size.deleted < policy.smallChange
    ? ["self"] as const
    : policy.requireReviews;
  return {
    required: [...required],
    done,
    treeMatch: null,
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

async function prepareImplementStart(
  runDir: string,
  locked: RebuildResult,
): Promise<RebuildResult> {
  if (locked.run.worktree !== undefined) {
    await validateRunWorktree(runDir, locked.run.worktree);
    return locked;
  }
  return rebaseRun(runDir, locked);
}

async function assertImplementDoneTasks(runDir: string, state: RunState): Promise<void> {
  const index = await readPlanIndex(runDir);
  if (index === null) {
    throw new RelayError("not_found", "index.json not found", "10-plan/index.json");
  }
  const open = openPlanTasks(index, state);
  if (open.length > 0) {
    throw new RelayError(
      "gate",
      `implement done refused: open tasks: ${open.join(", ")}`,
      "tasks",
    );
  }
}

async function measureStageCompletion(
  runDir: string,
  loaded: RebuildResult,
  stage: (typeof workflowStages)[number],
  allowExtra?: string,
): Promise<{
  measured?: Awaited<ReturnType<typeof measure>>;
  scope?: Awaited<ReturnType<typeof implementScope>>;
}> {
  if (!sizedStages.has(stage)) return {};
  const cwd = await runGitCwd(runDir, loaded.run);
  const measured = await measure(cwd, loaded.run.base);
  const scope = stage === "implement"
    ? await implementScope(
      runDir,
      cwd,
      loaded.run.base,
      loaded.events,
      measured.tree,
      allowExtra,
    )
    : undefined;
  return { measured, scope };
}

async function recordStage(
  input: {
    runDir: string;
    stage: string;
    tool: string;
    model?: string;
    allowExtra?: string;
  },
  action: "started" | "completed",
): Promise<StageResult> {
  const stage = parseStage(input.stage);
  const tool = parseTool(input.tool);
  const model = parseModel(input.model);
  const detected = action === "started" ? detectTool(process.env) : undefined;
  if (detected !== undefined && detected !== tool) {
    process.stderr.write(`warning: detected tool ${detected} differs from declared ${tool}\n`);
  }
  return withRunLock(input.runDir, async (locked) => {
    assertMove(locked.run.state, stageMove(stage, action));
    const loaded = action === "started" && stage === "implement"
      ? await prepareImplementStart(input.runDir, locked)
      : locked;
    if (action === "completed" && stage === "implement") {
      await assertImplementDoneTasks(input.runDir, loaded.run.state);
    }
    const { measured, scope } = action === "completed"
      ? await measureStageCompletion(input.runDir, loaded, stage, input.allowExtra)
      : {};
    const saved = await appendEvent(loaded, input.runDir, {
      stage,
      action,
      tool,
      ...(detected === undefined ? {} : { detected }),
      ...(model === undefined ? {} : { model }),
      ...(measured === undefined ? {} : {
        head: measured.head,
        tree: measured.tree,
        size: measured.size,
      }),
      ...(scope?.extra === undefined ? {} : { extra: scope.extra, reason: scope.reason }),
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
    if (scope?.extra !== undefined) {
      result.warning = `accepted out-of-scope edits: ${scope.extra.join(", ")}`;
    }
    return result;
  });
}

// Without a worktree, implement starts from a clean tree, and `base` moves to HEAD.
async function rebaseRun(runDir: string, loaded: RebuildResult): Promise<RebuildResult> {
  if ((await treeStatus(runDir)).length > 0) {
    throw new RelayError("gate", "working tree has changes", "tree");
  }
  const head = await gitHead(runDir);
  const saved = await appendEvent({ ...loaded, run: { ...loaded.run, base: head } }, runDir, {
    stage: "run",
    action: "rebased",
    ref: head,
  });
  return { ...loaded, run: saved.run, events: [...loaded.events, saved.event] };
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

async function implementScope(
  runDir: string,
  cwd: string,
  base: string,
  events: readonly EventLine[],
  tree: string,
  allowExtra: string | undefined,
): Promise<{ extra?: string[]; reason?: string }> {
  const own = await plannedFiles(runDir);
  const recorded = events.flatMap((event) => event.extra ?? []);
  const outside = outsidePaths(
    await changedPaths(cwd, base, tree),
    own,
    recorded,
  );
  if (outside.length === 0) return {};
  const strict = (await readPolicy(cwd, base)).strict.scope;
  if (allowExtra === undefined && strict) {
    const shown = outside.slice(0, 10).join(", ");
    throw new RelayError(
      "gate",
      `implement done refused: edits outside task files: ${shown}`,
      "files",
    );
  }
  const reason = allowExtra === undefined
    ? `scope warning: accepted edits under strict.scope=false (${outside.join(", ")})`
    : allowExtra.trim();
  if (reason.length === 0) throw new RelayError("validation", "reason is empty", "allow-extra");
  return { extra: outside, reason };
}

async function taskCount(runDir: string): Promise<number> {
  let value: unknown;
  try {
    value = await readJson(join(runDir, "10-plan/index.json"));
  } catch (error) {
    if (isEnoent(error)) return 0;
    throw error;
  }
  const parsed = planIndexSchema.safeParse(value);
  if (!parsed.success) return 0;
  return parsed.data.tasks.length;
}

async function plannedFiles(runDir: string): Promise<string[]> {
  const rel = "10-plan/index.json";
  let value: unknown;
  try {
    value = await readJson(join(runDir, rel));
  } catch (error) {
    if (isEnoent(error)) return [];
    throw error;
  }
  const parsed = planIndexSchema.safeParse(value);
  if (!parsed.success) {
    const issue = fromZod(parsed.error);
    throw new RelayError("validation", issue.message, rel);
  }
  return parsed.data.tasks.flatMap((task) => task.files);
}

async function measure(
  cwd: string,
  base: string,
): Promise<{
  head: string;
  tree: string;
  size: { files: number; added: number; deleted: number };
}> {
  const head = await gitHead(cwd);
  const tree = await workTree(cwd);
  return { head, tree, size: await treeDiffSize(cwd, base, tree) };
}

async function assertNoOpenQuestions(runDir: string, events: readonly EventLine[]): Promise<void> {
  const latest = await latestReview(runDir, events);
  if (latest === null || latest.open === 0) return;
  throw new RelayError("gate", "latest review has open questions", latest.path);
}

// The folder whose review `completed` event is newest wins. Without events, cross beats self.
// A `ref` on that event names the exact file, so a later unfinished scaffold cannot hide it.
function newestCompletedReview(events: readonly EventLine[]): EventLine | undefined {
  let newest: EventLine | undefined;
  for (const event of events) {
    if (event.action !== "completed") continue;
    if (reviewDirs.some((review) => review.stage === event.stage)) newest = event;
  }
  return newest;
}

async function reviewFromRef(
  runDir: string,
  newest: EventLine,
  ref: string,
  events: readonly EventLine[],
): Promise<{ path: string; open: number }> {
  const dir = reviewDirs.find((review) => review.stage === newest.stage)?.dir;
  if (dir === undefined || !new RegExp(String.raw`^${dir}/\d+\.json$`).test(ref)) {
    throw new RelayError("validation", "invalid review ref", ref);
  }
  const openItems = await readReview(runDir, ref);
  return { path: ref, open: unresolvedOpenCount(ref, openItems, events) };
}

function completedIndex(events: readonly EventLine[], stage: EventLine["stage"]): number {
  let done = -1;
  events.forEach((event, index) => {
    if (event.stage === stage && event.action === "completed") done = index;
  });
  return done;
}

async function reviewHits(
  runDir: string,
  events: readonly EventLine[],
): Promise<{ done: number; rank: number; n: number; rel: string }[]> {
  const hits: { done: number; rank: number; n: number; rel: string }[] = [];
  for (const review of reviewDirs) {
    const done = completedIndex(events, review.stage);
    let names: string[];
    try {
      names = await readdir(join(runDir, review.dir));
    } catch (error) {
      if (isEnoent(error)) continue;
      throw error;
    }
    for (const name of names) {
      const match = /^(\d+)\.json$/.exec(name);
      if (match === null) continue;
      hits.push({ done, rank: review.rank, n: Number(match[1]), rel: `${review.dir}/${name}` });
    }
  }
  hits.sort((left, right) => left.done - right.done || left.rank - right.rank || left.n - right.n);
  return hits;
}

async function latestReview(
  runDir: string,
  events: readonly EventLine[],
): Promise<{ path: string; open: number } | null> {
  const newest = newestCompletedReview(events);
  if (newest?.ref !== undefined) return reviewFromRef(runDir, newest, newest.ref, events);
  const latest = (await reviewHits(runDir, events)).at(-1);
  if (latest === undefined) return null;
  const openItems = await readReview(runDir, latest.rel);
  return {
    path: latest.rel,
    open: unresolvedOpenCount(latest.rel, openItems, events),
  };
}

async function readReview(
  runDir: string,
  rel: string,
): Promise<Awaited<ReturnType<typeof parseReviewJson>>["open"]> {
  return (await readReviewDocument(runDir, rel)).open;
}

function unresolvedOpenCount(
  rel: string,
  open: Awaited<ReturnType<typeof parseReviewJson>>["open"],
  events: readonly EventLine[],
): number {
  const decided = new Set(
    events.filter((event) =>
      event.action === "decided" && event.ref === rel && event.question !== undefined
    ).map((event) => event.question),
  );
  return open.filter((item) => !decided.has(item.q)).length;
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
