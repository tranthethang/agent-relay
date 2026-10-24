import { createHash } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { z } from "zod";
import { fromZod, RelayError } from "./error.js";
import { parseEventLine } from "./event.js";
import { atomicWrite, isEnoent, joinUnder, readJson, readJsonl } from "./files.js";
import { gitHead } from "./git.js";
import { parseRunJson, type RunJson } from "./run.js";
import { lifecycleSchema, schemaVersion, stageSchema } from "./vocab.js";

const manifestRel = "90-distill/manifest.json";

export const distillFileSchema = z.object({
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export const distillRunSchema = z.object({
  name: z.string().min(1),
  id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
  base: z.string().min(1),
  head: z.string().min(1).nullable(),
  lifecycle: lifecycleSchema,
  stage: stageSchema,
  closedAt: z.string().min(1).nullable(),
  stages: z.array(
    z.object({
      stage: stageSchema,
      tool: z.string().min(1).nullable(),
      model: z.string().min(1).nullable(),
    }).strict(),
  ),
}).strict();

export const distillManifestSchema = z.object({
  schema: z.literal(schemaVersion),
  run: distillRunSchema.optional(),
  files: z.array(distillFileSchema),
}).strict();

export type DistillManifest = z.infer<typeof distillManifestSchema>;

export type DistillResult = {
  schema: 1;
  path: string;
  files: number;
};

export type DistillOptions = {
  includeTestLogs?: boolean;
};

export type DistillVerifyResult = {
  schema: 1;
  ok: boolean;
  files: number;
  missing: string[];
  mismatched: string[];
  extra: string[];
};

export function distillText(result: DistillResult): string {
  return `${result.path}\nfiles: ${result.files}\n`;
}

export function distillVerifyText(result: DistillVerifyResult): string {
  const lines = [`ok: ${result.ok ? "yes" : "no"}`, `files: ${result.files}`];
  for (const path of result.missing) lines.push(`missing: ${path}`);
  for (const path of result.mismatched) lines.push(`mismatched: ${path}`);
  for (const path of result.extra) lines.push(`extra: ${path}`);
  return `${lines.join("\n")}\n`;
}

export async function verifyDistill(runDir: string): Promise<DistillVerifyResult> {
  const manifest = await readManifest(runDir);
  const missing: string[] = [];
  const mismatched: string[] = [];
  for (const file of manifest.files) {
    const full = joinUnder(runDir, file.path);
    let data: Buffer;
    try {
      data = await readFile(full);
    } catch (error) {
      if (isEnoent(error)) {
        missing.push(file.path);
        continue;
      }
      throw error;
    }
    const sha256 = createHash("sha256").update(data).digest("hex");
    if (data.byteLength !== file.size || sha256 !== file.sha256) mismatched.push(file.path);
  }
  const extra = await extraFiles(runDir, new Set(manifest.files.map((file) => file.path)));
  return {
    schema: schemaVersion,
    ok: missing.length === 0 && mismatched.length === 0 && extra.length === 0,
    files: manifest.files.length,
    missing,
    mismatched,
    extra,
  };
}

// Files under the run directory that the manifest does not name. The manifest
// itself never counts. A test log counts only when the manifest names it.
async function extraFiles(runDir: string, listed: Set<string>): Promise<string[]> {
  const extra: string[] = [];
  for (const file of await listFiles(runDir)) {
    const path = relative(runDir, file).split(sep).join("/");
    if (path === manifestRel) continue;
    if (listed.has(path)) continue;
    if (path.endsWith(".test.log")) continue;
    extra.push(path);
  }
  return extra.sort(comparePath);
}

async function readManifest(runDir: string): Promise<DistillManifest> {
  const path = join(runDir, manifestRel);
  let value: unknown;
  try {
    value = await readJson(path);
  } catch (error) {
    if (isEnoent(error)) throw new RelayError("not_found", "manifest not found", manifestRel);
    throw error;
  }
  const parsed = distillManifestSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = fromZod(parsed.error);
  throw new RelayError(
    "validation",
    issue.message,
    issue.fieldPath.length === 0 ? manifestRel : `${manifestRel}:${issue.fieldPath}`,
  );
}

export async function distillRun(
  runDir: string,
  options: DistillOptions = {},
): Promise<DistillResult> {
  const listed = await listFiles(runDir);
  const files: DistillManifest["files"] = [];
  for (const file of listed) {
    const path = relative(runDir, file).split(sep).join("/");
    if (path === manifestRel) continue;
    if (options.includeTestLogs !== true && path.endsWith(".test.log")) continue;
    const data = await readFile(file);
    files.push({
      path,
      size: data.byteLength,
      sha256: createHash("sha256").update(data).digest("hex"),
    });
  }
  files.sort((left, right) => comparePath(left.path, right.path));
  const run = await runHeader(runDir);
  const manifest = distillManifestSchema.parse({ schema: schemaVersion, run, files });
  const path = join(runDir, manifestRel);
  await mkdir(join(runDir, "90-distill"), { recursive: true });
  await atomicWrite(path, `${JSON.stringify(manifest)}\n`);
  return { schema: schemaVersion, path, files: files.length };
}

async function runHeader(runDir: string): Promise<z.infer<typeof distillRunSchema>> {
  const runJson: RunJson = parseRunJson(await readJson(join(runDir, "run.json")));
  const events = (await readJsonl(join(runDir, "events.jsonl"))).map(parseEventLine);
  const repoRoot = dirname(dirname(runDir));
  let head: string | null;
  try {
    head = await gitHead(runJson.worktree?.path ?? repoRoot);
  } catch {
    head = null;
  }
  return {
    name: basename(runDir),
    id: runJson.id,
    slug: runJson.slug,
    title: runJson.title,
    base: runJson.base,
    head,
    lifecycle: runJson.state.lifecycle,
    stage: runJson.state.stage,
    closedAt: events.find((event) => event.action === "closed")?.ts ?? null,
    stages: events
      .filter((event) => event.action === "started")
      .map((event) => ({
        stage: event.stage,
        tool: event.tool ?? null,
        model: event.model ?? null,
      })),
  };
}

function comparePath(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  await walk(root, root, out);
  return out;
}

async function walk(root: string, dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dir === root && entry.name === "locks") continue;
      await walk(root, path, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.startsWith(".") && entry.name.endsWith(".tmp")) continue;
    out.push(path);
  }
}
