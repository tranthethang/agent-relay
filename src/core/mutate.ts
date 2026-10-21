import {
  appendChained,
  commitState,
  type RebuildResult,
  rebuildRun,
  rebuildRunLocked,
} from "./cache.js";
import { RelayError } from "./error.js";
import { type EventLine } from "./event.js";
import { reduceEvents, type RunState } from "./reduce.js";
import { type RunJson } from "./run.js";
import { acquireRunLock, releaseRunLock } from "./runlock.js";
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
  const lock = await acquireRunLock(runDir);
  try {
    const loaded = await rebuildRunLocked(runDir);
    assertWritable(loaded.run.state);
    return await fn(loaded);
  } finally {
    await releaseRunLock(lock);
  }
}

export async function appendEvent(
  loaded: RebuildResult,
  runDir: string,
  input: Omit<EventLine, "schema" | "ts">,
): Promise<{ run: RunJson; event: EventLine }> {
  const event = await appendChained(runDir, {
    schema: schemaVersion,
    ts: new Date().toISOString(),
    ...input,
  });
  const run = await commitState(
    runDir,
    loaded.run,
    reduceEvents([...loaded.events, event]),
  );
  return { run, event };
}
