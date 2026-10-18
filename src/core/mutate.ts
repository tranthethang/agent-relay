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
  const deadline = Date.now() + 10_000;
  await mkdir(lockDir, { recursive: true });
  for (;;) {
    let handle;
    let created = false;
    try {
      handle = await open(lockPath, "wx");
      created = true;
      await handle.writeFile(
        JSON.stringify({
          pid: process.pid,
          host: hostname() || "unknown",
          ts: new Date().toISOString(),
        }) + "\n",
      );
      await handle.close();
      break;
    } catch (error) {
      await handle?.close().catch(() => undefined);
      const code = error instanceof Error && "code" in error ? error.code : "";
      // Only remove a lock file this call created. Windows reports EPERM while
      // another holder's lock file is pending delete, so treat it as busy.
      if (created) await rm(lockPath, { force: true });
      if (created || (code !== "EEXIST" && code !== "EPERM")) throw error;
      if (Date.now() >= deadline) {
        throw new RelayError("lock", "run lock timed out", "locks/run.lock");
      }
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs >= 30_000) {
          await rm(lockPath, { force: true });
          continue;
        }
      } catch (staleError) {
        if (staleError instanceof Error && "code" in staleError && staleError.code === "ENOENT") {
          continue;
        }
        throw staleError;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    return await fn(await openRun(runDir));
  } finally {
    await rm(lockPath, { force: true });
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
