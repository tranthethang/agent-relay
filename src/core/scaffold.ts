import { mkdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { findRelayDir, listRunNames, runIdFromName } from "./discover.js";
import { RelayError } from "./error.js";
import { type EventLine, eventLineSchema } from "./event.js";
import { atomicWrite, isEnoent } from "./files.js";
import { gitHead, gitRoot } from "./git.js";
import { reduceEvents } from "./reduce.js";
import { runJsonSchema } from "./run.js";
import {
  brainstormDirNamePattern,
  runIdSchema,
  schemaVersion,
  slugSchema,
  ymdSchema,
} from "./vocab.js";

const stageDirs = ["10-plan", "20-implement", "30-self-review", "40-cross-review"] as const;

const brainstormSlugSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

export const brainstormOpenSchema = z.object({
  schema: z.literal(schemaVersion),
  open: z.array(z.union([
    z.object({ q: z.string().min(1), a: z.string().min(1), b: z.string().min(1) }).strict(),
    z.object({ q: z.string().min(1), need: z.string().min(1) }).strict(),
  ])),
}).strict();

export type RunNewResult = {
  schema: 1;
  path: string;
  name: string;
  id: string;
  ymd: string;
  slug: string;
  title: string;
  base: string;
  from?: string;
};

export type BrainstormNewResult = {
  schema: 1;
  path: string;
  notes: string;
  open: string;
};

export function runNewText(result: RunNewResult): string {
  return `${result.path}\n`;
}

export function brainstormNewText(result: BrainstormNewResult): string {
  return `${result.path}\n`;
}

export async function createRun(input: {
  cwd: string;
  slug: string;
  title: string;
  from?: string;
  nowMs?: number;
}): Promise<RunNewResult> {
  const slug = requireMatch(slugSchema, input.slug, "slug", "invalid slug");
  const title = input.title.trim();
  if (title.length === 0) throw new RelayError("validation", "title is empty", "title");
  const nowMs = input.nowMs ?? Date.now();
  const ymd = utcYmd(nowMs);
  requireMatch(ymdSchema, ymd, "ymd", "invalid ymd");
  const head = await gitHead(input.cwd);
  const relayDir = await ensureRelay(input.cwd);
  const from = input.from === undefined ? undefined : await resolveBrainstorm(relayDir, input.from);
  const id = await allocateId(relayDir, nowMs);
  const name = `${ymd}-${id}-${slug}`;
  const runDir = join(relayDir, name);
  await mkdir(runDir, { recursive: true });
  for (const dir of stageDirs) await mkdir(join(runDir, dir));
  const event: EventLine = eventLineSchema.parse({
    schema: schemaVersion,
    ts: new Date(nowMs).toISOString(),
    stage: "run" as const,
    action: "created" as const,
    ...(from === undefined ? {} : { ref: from }),
  });
  const run = runJsonSchema.parse({
    schema: schemaVersion,
    id,
    ymd,
    slug,
    title,
    base: head,
    ...(from === undefined ? {} : { from }),
    state: reduceEvents([event]),
  });
  await atomicWrite(join(runDir, "run.json"), `${JSON.stringify(run)}\n`);
  await atomicWrite(join(runDir, "events.jsonl"), `${JSON.stringify(event)}\n`);
  const result: RunNewResult = {
    schema: schemaVersion,
    path: runDir,
    name,
    id,
    ymd,
    slug,
    title,
    base: head,
  };
  if (from !== undefined) result.from = from;
  return result;
}

export async function createBrainstorm(input: {
  cwd: string;
  slug: string;
  nowMs?: number;
}): Promise<BrainstormNewResult> {
  const slug = requireMatch(brainstormSlugSchema, input.slug, "slug", "invalid slug");
  const ymd = utcYmd(input.nowMs ?? Date.now());
  const relayDir = await ensureRelay(input.cwd);
  const name = `${ymd}-${slug}`;
  if (!brainstormDirNamePattern.test(name)) {
    throw new RelayError("validation", "invalid brainstorm name", "slug");
  }
  await mkdir(join(relayDir, "brainstorms"), { recursive: true });
  const path = join(relayDir, "brainstorms", name);
  try {
    await mkdir(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new RelayError("validation", "brainstorm already exists", "slug");
    }
    throw error;
  }
  const notes = join(path, "notes.md");
  const open = join(path, "open.json");
  await atomicWrite(notes, `# ${slug}\n`);
  await atomicWrite(open, `${JSON.stringify({ schema: schemaVersion, open: [] })}\n`);
  return { schema: schemaVersion, path, notes, open };
}

export function utcYmd(nowMs: number): string {
  const date = new Date(nowMs);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}${month}${day}`;
}

async function ensureRelay(cwd: string): Promise<string> {
  try {
    return await findRelayDir(cwd);
  } catch (error) {
    if (!(error instanceof RelayError) || error.code !== "not_found") throw error;
    const dir = join(await gitRoot(cwd), ".agent-relay");
    await mkdir(dir, { recursive: true });
    return dir;
  }
}

async function allocateId(relayDir: string, nowMs: number): Promise<string> {
  const used = new Set((await listRunNames(relayDir)).map((name) => runIdFromName(name)));
  let id = Math.floor(nowMs / 1000);
  while (used.has(String(id))) id += 1;
  const text = String(id);
  requireMatch(runIdSchema, text, "id", "run id overflow");
  return text;
}

export async function resolveBrainstorm(relayDir: string, token: string): Promise<string> {
  const name = basename(token);
  if (!brainstormDirNamePattern.test(name)) {
    throw new RelayError("validation", "invalid brainstorm name", "from");
  }
  const dir = join(relayDir, "brainstorms", name);
  try {
    const info = await stat(dir);
    if (!info.isDirectory()) throw new RelayError("not_found", "brainstorm not found", "from");
  } catch (error) {
    if (error instanceof RelayError) throw error;
    if (isEnoent(error)) throw new RelayError("not_found", "brainstorm not found", "from");
    throw error;
  }
  return `brainstorms/${name}`;
}

function requireMatch<T extends string>(
  schema: z.ZodType<T>,
  value: string,
  fieldPath: string,
  message: string,
): T {
  if (!schema.safeParse(value).success) throw new RelayError("validation", message, fieldPath);
  return value as T;
}
