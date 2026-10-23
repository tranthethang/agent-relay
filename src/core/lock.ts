import { mkdir, open, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { z } from "zod";
import { fromZod, RelayError } from "./error.js";
import { isEnoent, joinUnder, readText } from "./files.js";
import { schemaVersion, taskIdSchema, utcTimestampSchema } from "./vocab.js";

export const lockFileSchema = z.object({
  schema: z.literal(schemaVersion),
  session: z.string().min(1),
  pid: z.number().int().positive(),
  host: z.string().min(1),
  ts: utcTimestampSchema,
  path: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
}).strict();

export type LockFile = z.infer<typeof lockFileSchema>;

function taskName(task: string): string {
  const parsed = taskIdSchema.safeParse(task);
  if (!parsed.success) throw fromZod(parsed.error);
  return parsed.data;
}

function lockFilePath(runDir: string, task: string): string {
  return joinUnder(runDir, "locks", `${taskName(task)}.lock`);
}

export function isStale(lock: LockFile, ttlMs: number, nowMs = Date.now()): boolean {
  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    throw new RelayError("usage", "ttl must be a non-negative number", "ttl");
  }
  return nowMs - Date.parse(lock.ts) >= ttlMs;
}

export async function readOwner(runDir: string, task: string): Promise<LockFile> {
  const filePath = lockFilePath(runDir, task);
  let text: string;
  try {
    text = await readText(filePath);
  } catch (error) {
    if (isEnoent(error)) {
      throw new RelayError("not_found", "lock not found", `locks/${taskName(task)}.lock`);
    }
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new RelayError("validation", "invalid JSON", `locks/${taskName(task)}.lock`);
  }
  const parsed = lockFileSchema.safeParse(value);
  if (!parsed.success) throw fromZod(parsed.error);
  return parsed.data;
}

export async function acquireLock(
  runDir: string,
  task: string,
  session: string,
): Promise<LockFile> {
  if (session.length === 0) {
    throw new RelayError("usage", "session is empty", "session");
  }
  const name = taskName(task);
  const filePath = joinUnder(runDir, "locks", `${name}.lock`);
  await mkdir(joinUnder(runDir, "locks"), { recursive: true });
  let handle;
  try {
    handle = await open(filePath, "wx");
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : "";
    if (code !== "EEXIST") throw error;
    let owner = "unknown";
    try {
      owner = (await readOwner(runDir, name)).session;
    } catch {
      owner = "unknown";
    }
    throw new RelayError("lock", `lock held by ${owner}`, `locks/${name}.lock`);
  }
  const body: LockFile = {
    schema: schemaVersion,
    session,
    pid: process.pid,
    host: hostname() || "unknown",
    ts: new Date().toISOString(),
  };
  try {
    await handle.writeFile(`${JSON.stringify(lockFileSchema.parse(body))}\n`, "utf8");
  } catch (error) {
    await handle.close();
    await rm(filePath, { force: true });
    throw error;
  }
  await handle.close();
  return body;
}

export async function recordLockWorktree(
  runDir: string,
  task: string,
  session: string,
  worktree: { path: string; branch: string },
): Promise<void> {
  const name = taskName(task);
  const owner = await readOwner(runDir, name);
  if (owner.session !== session) {
    throw new RelayError("lock", `lock held by ${owner.session}`, `locks/${name}.lock`);
  }
  const next = lockFileSchema.parse({ ...owner, path: worktree.path, branch: worktree.branch });
  await writeFile(lockFilePath(runDir, name), `${JSON.stringify(next)}\n`);
}

export async function releaseLock(runDir: string, task: string, session: string): Promise<void> {
  const name = taskName(task);
  const owner = await readOwner(runDir, name);
  if (owner.session !== session) {
    throw new RelayError("lock", `lock held by ${owner.session}`, `locks/${name}.lock`);
  }
  await rm(lockFilePath(runDir, name));
}

export async function removeLock(runDir: string, task: string): Promise<LockFile> {
  const name = taskName(task);
  const owner = await readOwner(runDir, name);
  await rm(lockFilePath(runDir, name));
  return owner;
}

export async function createStealGuard(
  runDir: string,
  task: string,
  session: string,
): Promise<void> {
  const name = taskName(task);
  const rel = `locks/${name}.steal`;
  const filePath = joinUnder(runDir, "locks", `${name}.steal`);
  await mkdir(joinUnder(runDir, "locks"), { recursive: true });
  let handle;
  try {
    handle = await open(filePath, "wx");
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : "";
    if (code === "EEXIST") throw new RelayError("lock", `steal guard exists: ${rel}`, rel);
    throw error;
  }
  const body = { session, ts: new Date().toISOString() };
  try {
    await handle.writeFile(`${JSON.stringify(body)}\n`, "utf8");
  } catch (error) {
    await handle.close();
    await rm(filePath, { force: true });
    throw error;
  }
  await handle.close();
}

export async function removeStealGuard(runDir: string, task: string): Promise<void> {
  const name = taskName(task);
  await rm(joinUnder(runDir, "locks", `${name}.steal`), { force: true });
}

export async function stealLock(
  runDir: string,
  task: string,
  session: string,
  ttlMs: number,
): Promise<LockFile> {
  if (session.length === 0) {
    throw new RelayError("usage", "session is empty", "session");
  }
  const name = taskName(task);
  const owner = await readOwner(runDir, name);
  if (!isStale(owner, ttlMs)) {
    throw new RelayError("lock", `lock held by ${owner.session}`, `locks/${name}.lock`);
  }
  const previous = owner;
  await rm(lockFilePath(runDir, name));
  const next = await acquireLock(runDir, name, session);
  if (previous.path === undefined || previous.branch === undefined) return next;
  await recordLockWorktree(runDir, name, session, {
    path: previous.path,
    branch: previous.branch,
  });
  return { ...next, path: previous.path, branch: previous.branch };
}
