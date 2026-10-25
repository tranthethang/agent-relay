import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { rebuildRun } from "./cache.js";
import { listRunNames } from "./discover.js";
import { fromZod, RelayError } from "./error.js";
import { type EventLine } from "./event.js";
import { isEnoent, readJson } from "./files.js";
import { type ReviewIntegrity, reviewIntegrity, reviewProgress } from "./lifecycle.js";
import { formatAge, nextActions, nextStep } from "./next.js";
import { type RunState } from "./reduce.js";
import { listReviewPaths, readReviewDocument, reviewJsonSchema, reviewKinds } from "./review.js";
import { type RunJson } from "./run.js";
import { indexForImplement, type PlanIndex } from "./tasks.js";
import { schemaVersion } from "./vocab.js";
import { openTaskWorktrees } from "./worktree.js";

export type StatusRow = {
  name: string;
  id: string;
  stage: RunState["stage"];
  lifecycle: RunState["lifecycle"];
  age: string;
  next: string;
  actions: string[];
  reviews: StatusReviews;
  actors: RunActors;
};

export type StatusList = {
  schema: 1;
  runs: StatusRow[];
  warnings?: string[];
};

export type StatusDetail = {
  schema: 1;
  name: string;
  id: string;
  ymd: string;
  slug: string;
  title: string;
  base: string;
  from?: string;
  stage: RunState["stage"];
  lifecycle: RunState["lifecycle"];
  approved: boolean;
  age: string;
  tasks: RunState["tasks"];
  next: string;
  actions: string[];
  reviews: StatusReviews;
  actors: RunActors;
  drift: number;
  findings: { open: number; highOpen: number };
  warnings?: string[];
};

export type ReviewEvidence = {
  path: string;
  kind: "self" | "cross";
  claimed: { tool: string; model: string; open: number };
  measured: {
    detected: string | null;
    tests: NonNullable<EventLine["tests"]> | null;
    delta: NonNullable<EventLine["delta"]> | null;
    decided: number;
  };
};

export type StatusReviews = ReviewIntegrity & {
  self: ReviewEvidence | null;
  cross: ReviewEvidence | null;
};

export type RunActors = { approve?: string; close?: string };

export async function statusList(relayDir: string, nowMs: number): Promise<StatusList> {
  const names = await listRunNames(relayDir);
  const runs: StatusRow[] = [];
  const warnings: string[] = [];
  for (const name of names) {
    const runDir = join(relayDir, name);
    if (!await hasCache(runDir)) continue;
    try {
      const loaded = await rebuildRun(runDir);
      if (loaded.warning !== null) warnings.push(`${name}: ${loaded.warning}`);
      const integrity = await safeReviewIntegrity(runDir, loaded.run.base, loaded.events);
      const evidence = await statusReviews(runDir, loaded.events, integrity);
      appendReviewWarnings(warnings, name, evidence.warnings);
      const reviews = evidence.reviews;
      const index = loaded.run.state.lifecycle === "implementing"
        ? await indexForImplement(runDir, loaded.run.state)
        : null;
      const integrate = index === null
        ? []
        : await openTaskWorktrees(runDir, loaded.run, index.tasks.map((task) => task.id));
      const next = nextStep(
        loaded.run.id,
        loaded.run.state,
        loaded.events,
        reviews,
        index,
        integrate,
      );
      const actions = nextActions(
        loaded.run.id,
        loaded.run.state,
        loaded.events,
        next,
        reviews,
        index,
        integrate,
      );
      runs.push(rowFrom({
        name,
        run: loaded.run,
        events: loaded.events,
        reviews,
        actors: runActors(loaded.events),
        mtimeMs: await cacheMtime(runDir),
        nowMs,
        index,
        next,
        actions,
      }));
    } catch (error) {
      if (!(error instanceof RelayError)) throw error;
      const warning = `${name}: ${error.message}`;
      warnings.push(warning);
      process.stderr.write(`warning: ${warning}\n`);
    }
  }
  const result: StatusList = { schema: schemaVersion, runs };
  if (warnings.length > 0) result.warnings = warnings;
  return result;
}

function appendReviewWarnings(warnings: string[], name: string, found: readonly string[]): void {
  for (const warning of found) {
    warnings.push(`${name}: ${warning}`);
    process.stderr.write(`warning: ${name}: ${warning}\n`);
  }
}

export async function statusDetail(runDir: string, nowMs: number): Promise<StatusDetail> {
  const loaded = await rebuildRun(runDir);
  const run = loaded.run;
  const integrity = await safeReviewIntegrity(runDir, run.base, loaded.events);
  const evidence = await statusReviews(runDir, loaded.events, integrity);
  const reviews = evidence.reviews;
  const warnings: string[] = [];
  if (loaded.warning !== null) warnings.push(loaded.warning);
  for (const warning of evidence.warnings) {
    warnings.push(warning);
    process.stderr.write(`warning: ${warning}\n`);
  }
  const index = run.state.lifecycle === "implementing"
    ? await indexForImplement(runDir, run.state)
    : null;
  const integrate = index === null
    ? []
    : await openTaskWorktrees(runDir, run, index.tasks.map((task) => task.id));
  const next = nextStep(run.id, run.state, loaded.events, reviews, index, integrate);
  const detail: StatusDetail = {
    schema: schemaVersion,
    name: basename(runDir),
    id: run.id,
    ymd: run.ymd,
    slug: run.slug,
    title: run.title,
    base: run.base,
    stage: run.state.stage,
    lifecycle: run.state.lifecycle,
    approved: run.state.approved,
    age: ageOf(loaded.events, await cacheMtime(runDir), nowMs),
    tasks: run.state.tasks,
    next,
    actions: nextActions(
      run.id,
      run.state,
      loaded.events,
      next,
      reviews,
      index,
      integrate,
    ),
    reviews,
    actors: runActors(loaded.events),
    drift: driftCount(loaded.events),
    findings: await latestFindingCounts(runDir),
  };
  if (run.from !== undefined) detail.from = run.from;
  if (warnings.length > 0) detail.warnings = warnings;
  return detail;
}

// Counts come from the latest review of each kind. An unreadable review counts as zero;
// `statusReviews` already reports it.
async function latestFindingCounts(runDir: string): Promise<{ open: number; highOpen: number }> {
  const counts = { open: 0, highOpen: 0 };
  for (const kind of reviewKinds) {
    const latest = (await listReviewPaths(runDir, kind)).at(-1);
    if (latest === undefined) continue;
    let review;
    try {
      review = await readReviewDocument(runDir, latest);
    } catch (error) {
      if (error instanceof RelayError) continue;
      throw error;
    }
    for (const finding of review.findings) {
      if (finding.status !== "open") continue;
      counts.open += 1;
      if (finding.severity === "high") counts.highOpen += 1;
    }
  }
  return counts;
}

async function safeReviewIntegrity(
  runDir: string,
  base: string,
  events: EventLine[],
): Promise<ReviewIntegrity> {
  try {
    return await reviewIntegrity(runDir, base, events);
  } catch (error) {
    if (
      error instanceof RelayError
      && (error.message === "could not read policy from base"
        || error.message === "git index not found")
    ) {
      const { done, latest } = reviewProgress(events);
      return {
        required: ["self"],
        done,
        treeMatch: null,
        ...(latest?.delta === undefined ? {} : { delta: latest.delta }),
        waived: events.some((event) => event.action === "waived"),
      };
    }
    throw error;
  }
}

async function statusReviews(
  runDir: string,
  events: readonly EventLine[],
  integrity: ReviewIntegrity,
): Promise<{ reviews: StatusReviews; warnings: string[] }> {
  const warnings: string[] = [];
  const reviews: StatusReviews = {
    ...integrity,
    self: await safeReviewEvidence(runDir, events, "self", warnings),
    cross: await safeReviewEvidence(runDir, events, "cross", warnings),
  };
  return { reviews, warnings };
}

// A review file the CLI cannot read is reported, not fatal: the rest of the run still renders.
async function safeReviewEvidence(
  runDir: string,
  events: readonly EventLine[],
  kind: "self" | "cross",
  warnings: string[],
): Promise<ReviewEvidence | null> {
  try {
    return await reviewEvidenceFor(runDir, events, kind);
  } catch (error) {
    if (!(error instanceof RelayError)) throw error;
    warnings.push(
      error.fieldPath.length === 0 ? error.message : `${error.fieldPath}: ${error.message}`,
    );
    return null;
  }
}

export function statusListText(result: StatusList): string {
  if (result.runs.length === 0) return "runs: none\n";
  return `${
    result.runs.map((run) =>
      `${run.name} ${run.stage} ${run.lifecycle} ${run.age}\nnext: ${run.next}\n${
        reviewsLine(run.reviews)
      }\nactions: ${run.actions.join(", ") || "none"}\n${actorsLine(run.actors)}`
    ).join("\n\n")
  }\n`;
}

export function statusDetailText(result: StatusDetail): string {
  const lines = [
    `run: ${result.name}`,
    `title: ${result.title}`,
    `stage: ${result.stage}`,
    `status: ${result.lifecycle}`,
    `approved: ${result.approved ? "yes" : "no"}`,
    `age: ${result.age}`,
    `tasks: ${taskLine(result.tasks)}`,
    `next: ${result.next}`,
    `actions: ${result.actions.join(", ") || "none"}`,
    reviewsLine(result.reviews),
    actorsLine(result.actors),
    `drift: ${result.drift}`,
    `findings: ${result.findings.open} open, ${result.findings.highOpen} high open`,
  ];
  return `${lines.join("\n")}\n`;
}

function reviewsLine(reviews: StatusReviews): string {
  const tree = reviews.treeMatch === null ? "unknown" : yesNo(reviews.treeMatch);
  const delta = reviews.delta === undefined
    ? "none"
    : `${reviews.delta.files} ${reviews.delta.added} ${reviews.delta.deleted}`;
  const base = `reviews required=${reviews.required.join(",") || "none"} done=${
    reviews.done.join(",") || "none"
  } tree-match=${tree} delta=${delta} waived=${reviews.waived ? "yes" : "no"}`;
  return [base, reviewEvidenceLine(reviews.self), reviewEvidenceLine(reviews.cross)]
    .filter((line) => line.length > 0).join("\n");
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function rowFrom(input: {
  name: string;
  run: RunJson;
  events: EventLine[];
  reviews: StatusReviews;
  actors: RunActors;
  mtimeMs: number;
  nowMs: number;
  index: PlanIndex | null;
  next: string;
  actions: string[];
}): StatusRow {
  const { name, run, events, reviews, actors, mtimeMs, nowMs, next, actions } = input;
  return {
    name,
    id: run.id,
    stage: run.state.stage,
    lifecycle: run.state.lifecycle,
    age: ageOf(events, mtimeMs, nowMs),
    next,
    actions,
    reviews,
    actors,
  };
}

export async function reviewEvidenceFor(
  runDir: string,
  events: readonly EventLine[],
  kind: "self" | "cross",
): Promise<ReviewEvidence | null> {
  const dirName = kind === "self" ? "30-self-review" : "40-cross-review";
  let names: string[];
  try {
    names = await readdir(join(runDir, dirName));
  } catch (error) {
    if (isEnoent(error)) return null;
    throw error;
  }
  const files = names.filter((name) => /^\d+\.json$/.test(name));
  files.sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10));
  const latest = files.at(-1);
  if (latest === undefined) return null;
  const path = `${dirName}/${latest}`;
  let value: unknown;
  try {
    value = await readJson(join(runDir, path));
  } catch {
    throw new RelayError("validation", "could not read review", path);
  }
  const parsed = reviewJsonSchema.safeParse(value);
  if (!parsed.success) {
    const issue = fromZod(parsed.error);
    const message = issue.fieldPath.length === 0
      ? issue.message
      : `${issue.fieldPath}: ${issue.message}`;
    throw new RelayError("validation", message, path);
  }
  const stage = kind === "self" ? "self-review" : "cross-review";
  const start = [...events].reverse().find((event) =>
    event.stage === stage && event.action === "started" && event.tree !== undefined
  );
  const completed = [...events].reverse().find((event) =>
    event.stage === stage && event.action === "completed" && event.ref === path
  );
  const decided = new Set(
    events.filter((event) =>
      event.action === "decided" && event.ref === path && event.question !== undefined
    ).map((event) => event.question),
  );
  const openQuestions = new Set(parsed.data.open.map((item) => item.q));
  return {
    path,
    kind,
    claimed: { tool: parsed.data.tool, model: parsed.data.model, open: parsed.data.open.length },
    measured: {
      detected: start?.detected ?? null,
      tests: completed?.tests ?? null,
      delta: completed?.delta ?? null,
      decided:
        [...decided].filter((question): question is string =>
          question !== undefined && openQuestions.has(question)
        ).length,
    },
  };
}

function measuredTests(tests: ReviewEvidence["measured"]["tests"]): string {
  if (tests === null) return "unknown";
  if (typeof tests === "string") return tests;
  return `exit=${tests.exit} ms=${tests.ms}`;
}

function reviewEvidenceLine(evidence: ReviewEvidence | null): string {
  if (evidence === null) return "";
  const tests = measuredTests(evidence.measured.tests);
  const delta = evidence.measured.delta === null
    ? "none"
    : `${evidence.measured.delta.files} ${evidence.measured.delta.added} ${evidence.measured.delta.deleted}`;
  return `review ${evidence.kind} tool=${evidence.claimed.tool} (claimed) model=${evidence.claimed.model} (claimed) detected=${
    evidence.measured.detected ?? "none"
  } (measured) tests=${tests} (measured) delta=${delta} (measured) open=${evidence.claimed.open} (claimed) decided=${evidence.measured.decided} (measured)`;
}

function runActors(events: readonly EventLine[]): RunActors {
  const approved = [...events].reverse().find((event) => event.action === "approved");
  const closed = [...events].reverse().find((event) =>
    event.action === "closed" || event.action === "abandoned"
  );
  const actors: RunActors = {};
  if (approved?.actor !== undefined) actors.approve = approved.actor;
  if (closed?.actor !== undefined) actors.close = closed.actor;
  return actors;
}

function actorsLine(actors: RunActors): string {
  return `actors approve=${actors.approve ?? "unknown"} close=${actors.close ?? "unknown"}`;
}

function ageOf(events: readonly { ts: string }[], mtimeMs: number, nowMs: number): string {
  const from = events[0] !== undefined ? Date.parse(events[0].ts) : mtimeMs;
  return formatAge(from, nowMs);
}

function taskLine(tasks: RunState["tasks"]): string {
  if (tasks.length === 0) return "none";
  return tasks.map((task) => `${task.id} ${task.status}`).join(", ");
}

async function hasCache(runDir: string): Promise<boolean> {
  try {
    await stat(join(runDir, "run.json"));
    return true;
  } catch (error) {
    if (isEnoent(error)) return false;
    throw error;
  }
}

async function cacheMtime(runDir: string): Promise<number> {
  const info = await stat(join(runDir, "run.json"));
  return info.mtimeMs;
}

export function driftCount(events: readonly EventLine[]): number {
  return events.filter((event) => event.stage === "run" && event.action === "drifted").length;
}
