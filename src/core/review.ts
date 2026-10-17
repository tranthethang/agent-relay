import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { fromZod, RelayError } from "./error.js";
import { type EventLine } from "./event.js";
import { atomicWrite, isEnoent, readJson } from "./files.js";
import { diffSize, gitHead } from "./git.js";
import { appendEvent, openRun } from "./mutate.js";
import { type RunState } from "./reduce.js";
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

const reviewPlaces = {
  self: { dir: "30-self-review", stage: "self-review" },
  cross: { dir: "40-cross-review", stage: "cross-review" },
} as const;

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
    fixed: 0,
    tests: "not-run",
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
  const model = input.model === undefined ? "unknown" : parseModel(input.model);
  const scaffold = reviewScaffold(kind, input.tool, model);
  const place = reviewPlaces[kind];
  const loaded = await openRun(input.runDir);
  if (loaded.run.state.lifecycle !== "reviewing") {
    throw new RelayError(
      "gate",
      `review refused: run is ${loaded.run.state.lifecycle}`,
      "state.lifecycle",
    );
  }
  const dir = join(input.runDir, place.dir);
  await mkdir(dir, { recursive: true });
  const label = await nextLabel(dir);
  const markdown = join(dir, `${label}.md`);
  const json = join(dir, `${label}.json`);
  await atomicWrite(markdown, reviewMarkdown(kind));
  await atomicWrite(json, `${JSON.stringify(scaffold)}\n`);
  const saved = await appendEvent(loaded, input.runDir, {
    stage: place.stage,
    action: "started",
    tool: scaffold.tool,
    model: scaffold.model,
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
}

export async function reviewDone(input: {
  runDir: string;
  kind: string;
}): Promise<ReviewDoneResult & { warnings: string[] }> {
  const kind = parseKind(input.kind);
  const place = reviewPlaces[kind];
  const loaded = await openRun(input.runDir);
  if (loaded.run.state.lifecycle !== "reviewing") {
    throw new RelayError(
      "gate",
      `review refused: run is ${loaded.run.state.lifecycle}`,
      "state.lifecycle",
    );
  }
  const review = await readLatestReview(input.runDir, place.dir, kind);
  const warnings = kind === "cross"
    ? diversityWarnings(
      review.value,
      lastProvenance(loaded.events, "implement"),
      lastProvenance(loaded.events, "self-review"),
    )
    : [];
  const head = await gitHead(input.runDir);
  const size = await diffSize(input.runDir, loaded.run.base, head);
  const saved = await appendEvent(loaded, input.runDir, {
    stage: place.stage,
    action: "completed",
    tool: review.value.tool,
    model: review.value.model,
    head,
    size,
    ref: review.rel,
  });
  return {
    schema: schemaVersion,
    path: input.runDir,
    review: review.rel,
    stage: place.stage,
    action: "completed",
    lifecycle: saved.run.state.lifecycle,
    head,
    size,
    warnings,
  };
}

export function modelFamily(model: string): string {
  const index = model.search(/[0-9]/);
  if (index <= 0) return model;
  return model.slice(0, index);
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
  const family = modelFamily(review.model);
  if (implement?.model !== undefined && family === modelFamily(implement.model)) {
    warnings.push("cross model family matches implement model");
  }
  if (selfReview?.model !== undefined && family === modelFamily(selfReview.model)) {
    warnings.push("cross model family matches self-review model");
  }
  return warnings;
}

function lastProvenance(
  events: readonly EventLine[],
  stage: EventLine["stage"],
): { tool?: string; model?: string } | undefined {
  let found: { tool?: string; model?: string } | undefined;
  for (const event of events) {
    if (event.stage !== stage) continue;
    if (event.tool === undefined && event.model === undefined) continue;
    found = { tool: event.tool, model: event.model };
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
  const files = names.filter((name) => /^[0-9]+\.json$/.test(name));
  files.sort((left, right) => reviewNumber(left) - reviewNumber(right));
  const latest = files[files.length - 1];
  if (latest === undefined) throw new RelayError("not_found", "review not found", dirName);
  const rel = `${dirName}/${latest}`;
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
  if (parsed.data.kind !== kind) {
    throw new RelayError("validation", "kind does not match", `${rel}:kind`);
  }
  return { rel, value: parsed.data };
}

function reviewNumber(name: string): number {
  return Number(name.slice(0, name.length - ".json".length));
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
    const match = /^([0-9]+)\.(?:md|json)$/.exec(name);
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

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isEnoent(error)) return false;
    throw error;
  }
}
