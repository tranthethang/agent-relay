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
