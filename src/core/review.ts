import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { type RebuildResult } from "./cache.js";
import { exists } from "./claim.js";
import { detectTool } from "./detect.js";
import { fromZod, RelayError } from "./error.js";
import { type EventLine } from "./event.js";
import { atomicWrite, isEnoent, readJson } from "./files.js";
import { gitHead, gitRoot, treeDiffSize, workTree } from "./git.js";
import { modelLine, modelVendor } from "./model.js";
import { appendEvent, withRunLock } from "./mutate.js";
import { readPolicy } from "./policy.js";
import { type RunState } from "./reduce.js";
import { runTestCommand, type TestExecution } from "./testrun.js";
import { schemaVersion, toolSchema } from "./vocab.js";
import { runGitCwd } from "./worktree.js";

export const reviewKinds = ["self", "cross"] as const;

const openChoiceSchema = z.object({
  q: z.string().min(1),
  a: z.string().min(1),
  b: z.string().min(1),
}).strict();

const openNeedSchema = z.object({
  q: z.string().min(1),
  need: z.string().min(1),
}).strict();

export const findingSchema = z.object({
  id: z.string().regex(/^F[1-9]\d*$/),
  severity: z.enum(["high", "medium", "low"]),
  file: z.string().min(1).nullable(),
  line: z.number().int().positive().nullable(),
  status: z.enum(["fixed", "open", "rejected"]),
  evidence: z.string().min(1),
}).strict();

export type Finding = z.infer<typeof findingSchema>;

export const reviewJsonSchema = z.object({
  schema: z.literal(schemaVersion),
  kind: z.enum(reviewKinds),
  tool: toolSchema,
  model: z.string().min(1),
  // Legacy count. A file with `fixed` and no `findings` parses as no findings.
  fixed: z.number().int().nonnegative().optional(),
  findings: z.array(findingSchema).optional(),
  // Removed from new review JSON. A legacy file may still carry it; ignore the value.
  tests: z.unknown().optional(),
  open: z.array(z.union([openChoiceSchema, openNeedSchema])),
}).strict().superRefine((value, context) => {
  if (value.fixed !== undefined && value.findings !== undefined) {
    context.addIssue({
      code: "custom",
      message: "fixed cannot be combined with findings",
      path: ["fixed"],
    });
  }
  const seen = new Set<string>();
  value.findings?.forEach((finding, index) => {
    if (seen.has(finding.id)) {
      context.addIssue({
        code: "custom",
        message: "duplicate finding id",
        path: ["findings", index, "id"],
      });
    }
    seen.add(finding.id);
  });
}).transform(({ fixed: _fixed, findings, ...rest }) => ({ ...rest, findings: findings ?? [] }));

export type ReviewJson = z.infer<typeof reviewJsonSchema>;

export function parseReviewJson(value: unknown): ReviewJson {
  return reviewJsonSchema.parse(value);
}

export const reviewPlaces = {
  self: { dir: "30-self-review", stage: "self-review" },
  cross: { dir: "40-cross-review", stage: "cross-review" },
} as const;

// A cross-review can edit code after the earlier self-review passed. The new code
// needs a self-review recorded after that delta before `close` accepts the run.
export function crossDeltaNeedsSelfReview(events: readonly EventLine[]): boolean {
  let deltaAt = -1;
  events.forEach((event, index) => {
    if (event.stage === reviewPlaces.cross.stage && event.action === "completed") {
      if (event.delta !== undefined) deltaAt = index;
    }
  });
  if (deltaAt === -1) return false;
  return !events.slice(deltaAt + 1).some((event) =>
    event.stage === reviewPlaces.self.stage && event.action === "completed"
  );
}

type ReviewKind = (typeof reviewKinds)[number];
type ReviewStage = (typeof reviewPlaces)[ReviewKind]["stage"];

export type ReviewNewResult = {
  schema: 1;
  path: string;
  markdown: string;
  json: string;
  stage: ReviewStage;
  action: "started";
  lifecycle: RunState["lifecycle"];
};

export function reviewNewText(result: ReviewNewResult): string {
  return `${result.markdown}\n${result.json}\n`;
}

export type ReviewDoneResult = {
  schema: 1;
  path: string;
  review: string;
  stage: ReviewStage;
  action: "completed";
  lifecycle: RunState["lifecycle"];
  head: string;
  size: { files: number; added: number; deleted: number };
};

export function reviewDoneText(result: ReviewDoneResult): string {
  const lines = [
    `review: ${result.review}`,
    `stage: ${result.stage}`,
    `action: ${result.action}`,
    `lifecycle: ${result.lifecycle}`,
    `head: ${result.head}`,
    `size: ${result.size.files} ${result.size.added} ${result.size.deleted}`,
  ];
  return `${lines.join("\n")}\n`;
}

export function reviewScaffold(kind: ReviewKind, tool: string, model: string): ReviewJson {
  const parsed = reviewJsonSchema.safeParse({
    schema: schemaVersion,
    kind,
    tool,
    model,
    findings: [],
    open: [],
  });
  if (!parsed.success) throw new RelayError("validation", "invalid tool", "tool");
  return parsed.data;
}

export function reviewMarkdown(kind: ReviewKind): string {
  return `# ${kind}\n\n## Findings\n`;
}

export async function reviewNew(input: {
  runDir: string;
  kind: string;
  tool: string;
  model?: string;
}): Promise<ReviewNewResult> {
  const kind = parseKind(input.kind);
  const place = reviewPlaces[kind];
  return withRunLock(input.runDir, async (loaded) => {
    if (loaded.run.state.lifecycle !== "reviewing") {
      throw new RelayError(
        "gate",
        `review refused: run is ${loaded.run.state.lifecycle}`,
        "state.lifecycle",
      );
    }
    if (kind === "cross" && (input.model === undefined || input.model.trim().length === 0)) {
      throw new RelayError("usage", "cross review requires --model", "model");
    }
    const model = input.model === undefined ? "unknown" : parseModel(input.model);
    const scaffold = reviewScaffold(kind, input.tool, model);
    const detected = detectTool(process.env);
    if (detected !== undefined && detected !== scaffold.tool) {
      process.stderr.write(
        `warning: detected tool ${detected} differs from declared ${scaffold.tool}\n`,
      );
    }
    const dir = join(input.runDir, place.dir);
    await mkdir(dir, { recursive: true });
    const label = await nextLabel(dir);
    const tree = await workTree(await runGitCwd(input.runDir, loaded.run));
    const markdown = join(dir, `${label}.md`);
    const json = join(dir, `${label}.json`);
    await atomicWrite(markdown, reviewMarkdown(kind));
    await atomicWrite(json, `${JSON.stringify(scaffold)}\n`);
    const saved = await appendEvent(loaded, input.runDir, {
      stage: place.stage,
      action: "started",
      tree,
      tool: scaffold.tool,
      model: scaffold.model,
      ...(detected === undefined ? {} : { detected }),
    });
    return {
      schema: schemaVersion,
      path: input.runDir,
      markdown,
      json,
      stage: place.stage,
      action: "started",
      lifecycle: saved.run.state.lifecycle,
    };
  });
}

export async function reviewDone(input: {
  runDir: string;
  kind: string;
  testTimeoutMs?: number;
  runTests?: boolean;
}): Promise<ReviewDoneResult & { warnings: string[] }> {
  const kind = parseKind(input.kind);
  // Tests can outlast the stale-lock age, so they run between two lock holds.
  const first = await withRunLock(input.runDir, async (loaded) => {
    const checked = await checkReviewDone(input.runDir, kind, loaded);
    if (checked.testCommand !== undefined) {
      if (input.runTests !== true) {
        throw new RelayError(
          "gate",
          `test command: ${checked.testCommand}; pass --run-tests to run it`,
          "run-tests",
        );
      }
      process.stderr.write(`test command: ${checked.testCommand}\n`);
      return { checked };
    }
    const execution = await runTestCommand(checked.root, undefined);
    return { done: await recordReviewDone(input.runDir, loaded, checked, execution) };
  });
  if (first.done !== undefined) return first.done;
  const checked = first.checked;
  const execution = await runTestCommand(checked.root, checked.testCommand, input.testTimeoutMs);
  return withRunLock(input.runDir, async (loaded) => {
    assertReviewingLifecycle(loaded.run.state);
    if (stageEventCount(loaded.events, checked.place.stage) !== checked.stageEvents) {
      throw new RelayError(
        "gate",
        "review refused: the review stage changed while tests ran",
        "events.jsonl",
      );
    }
    return recordReviewDone(input.runDir, loaded, checked, execution);
  });
}

type CheckedReview = {
  place: (typeof reviewPlaces)[ReviewKind];
  review: { rel: string; value: ReviewJson };
  warnings: string[];
  cwd: string;
  root: string;
  testCommand: string | undefined;
  testTree: string | undefined;
  stageEvents: number;
};

async function checkReviewDone(
  runDir: string,
  kind: ReviewKind,
  loaded: RebuildResult,
): Promise<CheckedReview> {
  const place = reviewPlaces[kind];
  assertReviewingLifecycle(loaded.run.state);
  const review = await readLatestReview(runDir, place.dir, kind);
  const started = lastReviewStart(loaded.events, place.stage);
  assertReviewMatchesStart(review, started);
  await assertQuestionCards(runDir, review);
  await assertFindingIds(runDir, review);
  await assertPriorQuestionsDecided(runDir, loaded.events, review);
  const warnings = kind === "cross"
    ? diversityWarnings(
      review.value,
      lastProvenance(loaded.events, "implement"),
      lastProvenance(loaded.events, "self-review"),
    )
    : [];
  const cwd = await runGitCwd(runDir, loaded.run);
  const policy = await readPolicy(cwd, loaded.run.base);
  return {
    place,
    review,
    warnings,
    cwd,
    root: await gitRoot(cwd),
    testCommand: policy.testCommand,
    testTree: policy.testCommand === undefined ? undefined : await workTree(cwd),
    stageEvents: stageEventCount(loaded.events, place.stage),
  };
}

async function recordReviewDone(
  runDir: string,
  loaded: RebuildResult,
  checked: CheckedReview,
  execution: TestExecution,
): Promise<ReviewDoneResult & { warnings: string[] }> {
  const { place, review, cwd } = checked;
  const head = await gitHead(cwd);
  const tree = await workTree(cwd);
  const size = await treeDiffSize(cwd, loaded.run.base, tree);
  const startedTree = lastReviewStartTree(loaded.events, place.stage);
  const delta = startedTree !== undefined && startedTree !== tree
    ? await treeDiffSize(cwd, startedTree, tree)
    : undefined;
  const label = String(reviewNumber(review.rel)).padStart(2, "0");
  const logPath = join(runDir, place.dir, `${label}.test.log`);
  const log = execution.tests === "not-configured"
    ? "test command not configured\n"
    : `stdout (last 200 lines):\n${tailLines(execution.stdout)}\n\nstderr (last 200 lines):\n${
      tailLines(execution.stderr)
    }\n`;
  await atomicWrite(logPath, log);
  const saved = await appendEvent(loaded, runDir, {
    stage: place.stage,
    action: "completed",
    tool: review.value.tool,
    model: review.value.model,
    head,
    tree,
    size,
    ...(delta === undefined ? {} : { delta }),
    tests: execution.tests === "not-configured"
      ? execution.tests
      : { ...execution.tests, tree: checked.testTree ?? tree },
    ref: review.rel,
  });
  return {
    schema: schemaVersion,
    path: runDir,
    review: review.rel,
    stage: place.stage,
    action: "completed",
    lifecycle: saved.run.state.lifecycle,
    head,
    size,
    warnings: checked.warnings,
  };
}

function assertReviewingLifecycle(state: RunState): void {
  if (state.lifecycle !== "reviewing") {
    throw new RelayError("gate", `review refused: run is ${state.lifecycle}`, "state.lifecycle");
  }
}

function stageEventCount(events: readonly EventLine[], stage: ReviewStage): number {
  return events.filter((event) => event.stage === stage).length;
}

function assertReviewMatchesStart(
  review: { rel: string; value: ReviewJson },
  started: { tool?: string; model?: string } | undefined,
): void {
  if (started?.tool !== review.value.tool) {
    throw new RelayError("validation", "tool differs from review start", `${review.rel}:tool`);
  }
  if (started?.model !== review.value.model) {
    throw new RelayError("validation", "model differs from review start", `${review.rel}:model`);
  }
}

async function assertQuestionCards(
  runDir: string,
  review: { rel: string; value: ReviewJson },
): Promise<void> {
  const markdownRel = review.rel.replace(/\.json$/, ".md");
  const markdown = await readFile(join(runDir, markdownRel), "utf8");
  const cardCount = markdown.match(/^- Q\d+: /gm)?.length ?? 0;
  if (cardCount !== review.value.open.length) {
    throw new RelayError(
      "validation",
      `review Markdown has ${cardCount} question cards but JSON has ${review.value.open.length} open items`,
      `${review.rel}:open`,
    );
  }
}

async function assertFindingIds(
  runDir: string,
  review: { rel: string; value: ReviewJson },
): Promise<void> {
  const markdownRel = review.rel.replace(/\.json$/, ".md");
  const markdown = await readFile(join(runDir, markdownRel), "utf8");
  review.value.findings.forEach((finding, index) => {
    if (!markdown.includes(finding.id)) {
      throw new RelayError(
        "validation",
        `finding ${finding.id} is missing from the review Markdown`,
        `${review.rel}:findings[${index}].id`,
      );
    }
  });
}

async function assertPriorQuestionsDecided(
  runDir: string,
  events: readonly EventLine[],
  review: { rel: string; value: ReviewJson },
): Promise<void> {
  const previous = latestCompletedReview(events);
  if (previous?.ref === undefined) return;
  const previousReview = await readReviewAt(runDir, previous.stage, previous.ref);
  for (const item of previousReview.open) {
    if (review.value.open.some((next) => next.q === item.q)) continue;
    const decided = events.some((event) =>
      event.action === "decided" && event.ref === previous.ref && event.question === item.q
    );
    if (!decided) {
      throw new RelayError(
        "validation",
        `open question was dropped without a decision: ${item.q}`,
        `${review.rel}:open`,
      );
    }
  }
}

function lastReviewStartTree(
  events: readonly EventLine[],
  stage: ReviewStage,
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.stage === stage && event.action === "started" && event.tree !== undefined) {
      return event.tree;
    }
  }
  return undefined;
}

function lastReviewStart(
  events: readonly EventLine[],
  stage: ReviewStage,
): EventLine | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event?.stage === stage
      && event.action === "started"
      && event.tool !== undefined
      && event.model !== undefined
    ) return event;
  }
  return undefined;
}

export function diversityWarnings(
  review: ReviewJson,
  implement: { tool?: string; model?: string } | undefined,
  selfReview: { tool?: string; model?: string } | undefined,
): string[] {
  const warnings: string[] = [];
  if (implement?.tool !== undefined && review.tool === implement.tool) {
    warnings.push("cross tool matches implement tool");
  }
  if (selfReview?.tool !== undefined && review.tool === selfReview.tool) {
    warnings.push("cross tool matches self-review tool");
  }
  addModelWarnings(warnings, review.model, implement?.model, "implement");
  addModelWarnings(warnings, review.model, selfReview?.model, "self-review");
  return warnings;
}

function addModelWarnings(
  warnings: string[],
  reviewModel: string,
  earlierModel: string | undefined,
  earlierStage: "implement" | "self-review",
): void {
  if (earlierModel === undefined) return;
  const reviewVendor = modelVendor(reviewModel);
  const earlierVendor = modelVendor(earlierModel);
  if (reviewVendor === "unknown" || earlierVendor === "unknown") {
    warnings.push(`cross model vendor unknown for ${earlierStage} model`);
  } else if (reviewVendor === earlierVendor) {
    warnings.push(`cross model vendor matches ${earlierStage} model`);
  }
  if (modelLine(reviewModel) === modelLine(earlierModel)) {
    warnings.push(`cross model line matches ${earlierStage} model`);
  }
}

function lastProvenance(
  events: readonly EventLine[],
  stage: EventLine["stage"],
): { tool?: string; model?: string } | undefined {
  let found: { tool?: string; model?: string } | undefined;
  for (const event of events) {
    if (event.stage !== stage) continue;
    if (event.tool === undefined && event.model === undefined) continue;
    // `stage done` may omit --model; keep the model from the start event.
    found = { tool: event.tool ?? found?.tool, model: event.model ?? found?.model };
  }
  return found;
}

async function readLatestReview(
  runDir: string,
  dirName: string,
  kind: ReviewKind,
): Promise<{ rel: string; value: ReviewJson }> {
  let names: string[];
  try {
    names = await readdir(join(runDir, dirName));
  } catch (error) {
    if (isEnoent(error)) throw new RelayError("not_found", "review not found", dirName);
    throw error;
  }
  const files = names.filter((name) => /^\d+\.json$/.test(name));
  files.sort((left, right) => reviewNumber(left) - reviewNumber(right));
  const latest = files.at(-1);
  if (latest === undefined) throw new RelayError("not_found", "review not found", dirName);
  const rel = `${dirName}/${latest}`;
  const value = await readReviewDocument(runDir, rel);
  if (value.kind !== kind) {
    throw new RelayError("validation", "kind does not match", `${rel}:kind`);
  }
  return { rel, value };
}

// Review JSON paths of one kind, oldest first. A missing folder has none.
export async function listReviewPaths(runDir: string, kind: ReviewKind): Promise<string[]> {
  const dirName = reviewPlaces[kind].dir;
  let names: string[];
  try {
    names = await readdir(join(runDir, dirName));
  } catch (error) {
    if (isEnoent(error)) return [];
    throw error;
  }
  return names.filter((name) => /^\d+\.json$/.test(name))
    .sort((left, right) => reviewNumber(left) - reviewNumber(right))
    .map((name) => `${dirName}/${name}`);
}

export async function readReviewDocument(runDir: string, rel: string): Promise<ReviewJson> {
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
  return parsed.data;
}

function reviewNumber(name: string): number {
  const basename = name.slice(name.lastIndexOf("/") + 1);
  return Number(basename.slice(0, basename.length - ".json".length));
}

function tailLines(text: string): string {
  const lines = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.slice(-200).join("\n");
}

function latestCompletedReview(events: readonly EventLine[]): EventLine | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event?.action === "completed"
      && (event.stage === "self-review" || event.stage === "cross-review")
    ) return event;
  }
  return undefined;
}

export async function readReviewAt(
  runDir: string,
  stage: EventLine["stage"],
  rel: string,
): Promise<ReviewJson> {
  const dir = stage === "self-review" ? reviewPlaces.self.dir : reviewPlaces.cross.dir;
  if (!new RegExp(String.raw`^${dir}/\d+\.json$`).test(rel)) {
    throw new RelayError("validation", "invalid review ref", rel);
  }
  let value: unknown;
  try {
    value = await readJson(join(runDir, rel));
  } catch {
    throw new RelayError("validation", "could not read completed review", rel);
  }
  const parsed = reviewJsonSchema.safeParse(value);
  if (!parsed.success) {
    const issue = fromZod(parsed.error);
    throw new RelayError("validation", issue.message, `${rel}:${issue.fieldPath}`);
  }
  return parsed.data;
}

async function nextLabel(dir: string): Promise<string> {
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (!isEnoent(error)) throw error;
  }
  let max = 0;
  for (const name of names) {
    const match = /^(\d+)\.(?:md|json)$/.exec(name);
    if (match?.[1] !== undefined) max = Math.max(max, Number(match[1]));
  }
  let number = max + 1;
  for (;;) {
    const label = String(number).padStart(2, "0");
    if (!await exists(join(dir, `${label}.md`)) && !await exists(join(dir, `${label}.json`))) {
      return label;
    }
    number += 1;
  }
}

function parseKind(value: string): ReviewKind {
  const parsed = z.enum(reviewKinds).safeParse(value);
  if (!parsed.success) throw new RelayError("validation", "invalid kind", "kind");
  return parsed.data;
}

function parseModel(value: string): string {
  if (value.trim().length === 0) throw new RelayError("validation", "model is empty", "model");
  return value;
}
