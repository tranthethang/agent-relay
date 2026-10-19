import { mkdir, open, rm, stat } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { commitState, type RebuildResult, rebuildRun } from "./cache.js";
import { RelayError } from "./error.js";
import { type EventLine, eventLineSchema } from "./event.js";
import { appendJsonl } from "./files.js";
import { reduceEvents, type RunState } from "./reduce.js";
import { type RunJson } from "./run.js";
import { schemaVersion } from "./vocab.js";

export function assertWritable(state: RunState): void {
  if (state.lifecycle === "closed") {
    throw new RelayError("gate", "run is closed", "state.lifecycle");
  }
  if (state.lifecycle === "abandoned") {
    throw new RelayError("gate", "run is abandoned", "state.lifecycle");
  }
}

export async function openRun(runDir: string): Promise<RebuildResult> {
  const loaded = await rebuildRun(runDir);
  assertWritable(loaded.run.state);
  return loaded;
}

export async function withRunLock<T>(
  runDir: string,
  fn: (loaded: RebuildResult) => Promise<T>,
): Promise<T> {
  const lockDir = join(runDir, "locks");
  const lockPath = join(lockDir, "run.lock");
  await mkdir(lockDir, { recursive: true });
  await acquireRunLock(lockPath, Date.now() + 10_000);
  try {
    return await fn(await openRun(runDir));
  } finally {
    await rm(lockPath, { force: true });
  }
}

function lockBody(): string {
  return JSON.stringify({
    pid: process.pid,
    host: hostname() || "unknown",
    ts: new Date().toISOString(),
  }) + "\n";
}

function lockCode(error: unknown): string {
  if (!(error instanceof Error) || !("code" in error)) return "";
  const code = error.code;
  return typeof code === "string" ? code : "";
}

async function tryCreateLock(lockPath: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(lockPath, "wx");
    await handle.writeFile(lockBody());
    await handle.close();
    return true;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (handle !== undefined) {
      await rm(lockPath, { force: true });
      throw error;
    }
    // Windows reports EPERM while another holder's lock file is pending delete.
    if (lockCode(error) !== "EEXIST" && lockCode(error) !== "EPERM") throw error;
    return false;
  }
}

async function waitForLock(lockPath: string, deadline: number): Promise<void> {
  if (Date.now() >= deadline) {
    throw new RelayError("lock", "run lock timed out", "locks/run.lock");
  }
  try {
    const info = await stat(lockPath);
    if (Date.now() - info.mtimeMs >= 30_000) {
      await rm(lockPath, { force: true });
      return;
    }
  } catch (staleError) {
    if (lockCode(staleError) !== "ENOENT") throw staleError;
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
}

async function acquireRunLock(lockPath: string, deadline: number): Promise<void> {
  for (;;) {
    if (await tryCreateLock(lockPath)) return;
    await waitForLock(lockPath, deadline);
  }
}

export async function appendEvent(
  loaded: RebuildResult,
  runDir: string,
  input: Omit<EventLine, "schema" | "ts">,
): Promise<{ run: RunJson; event: EventLine }> {
  const event = eventLineSchema.parse({
    schema: schemaVersion,
    ts: new Date().toISOString(),
    ...input,
  });
  await appendJsonl(join(runDir, "events.jsonl"), JSON.stringify(event));
  const run = await commitState(
    runDir,
    loaded.run,
    reduceEvents([...loaded.events, event]),
  );
  return { run, event };
}
