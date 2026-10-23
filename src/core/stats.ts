import { basename, join } from "node:path";
import { findRelayDir, listRunNames, runIdFromName } from "./discover.js";
import { RelayError } from "./error.js";
import { type EventLine, eventLineSchema } from "./event.js";
import { isEnoent, readJsonlLines } from "./files.js";
import { driftCount } from "./status.js";
import { schemaVersion, stages } from "./vocab.js";

const reviewStages = new Set<EventLine["stage"]>(["self-review", "cross-review"]);

export type StatsRow = {
  name: string;
  id: string;
  stages: Partial<Record<(typeof stages)[number], number>>;
  rounds: number;
  waivers: number;
  failedTests: number;
  drift: number;
};

export type StatsResult = {
  schema: 1;
  runs: StatsRow[];
  warnings?: string[];
};

export function statsText(result: StatsResult): string {
  if (result.runs.length === 0) return "runs: none\n";
  return `${result.runs.map(rowText).join("\n")}\n`;
}

export async function statsForRelay(cwd: string): Promise<StatsResult> {
  const relayDir = await findRelayDir(cwd);
  const runs: StatsRow[] = [];
  const warnings: string[] = [];
  for (const name of await listRunNames(relayDir)) {
    try {
      runs.push(await statsRow(join(relayDir, name)));
    } catch (error) {
      if (!(error instanceof RelayError)) throw error;
      const warning = `${name}: ${error.message}`;
      warnings.push(warning);
      process.stderr.write(`warning: ${warning}\n`);
    }
  }
  const result: StatsResult = { schema: schemaVersion, runs };
  if (warnings.length > 0) result.warnings = warnings;
  return result;
}

export async function statsForRun(runDir: string): Promise<StatsResult> {
  return { schema: schemaVersion, runs: [await statsRow(runDir)] };
}

async function statsRow(runDir: string): Promise<StatsRow> {
  const name = basename(runDir);
  const events = await readEvents(runDir);
  return {
    name,
    id: runIdFromName(name),
    stages: stageTimes(events),
    rounds: events.filter((event) => event.action === "completed" && reviewStages.has(event.stage))
      .length,
    waivers: events.filter((event) => event.action === "waived").length,
    failedTests: events.filter((event) => failedTest(event)).length,
    drift: driftCount(events),
  };
}

function failedTest(event: EventLine): boolean {
  return typeof event.tests === "object" && event.tests.exit !== 0;
}

// Time is the gap from the latest `started` to the next `completed` for that stage.
function stageTimes(events: readonly EventLine[]): StatsRow["stages"] {
  const open = new Map<EventLine["stage"], number>();
  const totals = new Map<EventLine["stage"], number>();
  for (const event of events) {
    if (event.action === "started") {
      open.set(event.stage, Date.parse(event.ts));
      continue;
    }
    if (event.action !== "completed") continue;
    const start = open.get(event.stage);
    if (start === undefined) continue;
    open.delete(event.stage);
    const ms = Date.parse(event.ts) - start;
    totals.set(event.stage, (totals.get(event.stage) ?? 0) + Math.max(0, ms));
  }
  const stagesOut: StatsRow["stages"] = {};
  for (const [stage, ms] of totals) stagesOut[stage] = ms;
  return stagesOut;
}

async function readEvents(runDir: string): Promise<EventLine[]> {
  const filePath = join(runDir, "events.jsonl");
  let rows: Array<{ value: unknown }>;
  try {
    rows = await readJsonlLines(filePath);
  } catch (error) {
    if (isEnoent(error)) {
      throw new RelayError("not_found", "events.jsonl not found", "events.jsonl");
    }
    throw error;
  }
  return rows.map((row, index) => {
    const parsed = eventLineSchema.safeParse(row.value);
    if (parsed.success) return parsed.data;
    throw new RelayError("validation", "invalid event", `events.jsonl:lines[${index}]`);
  });
}

function rowText(row: StatsRow): string {
  const times = stages.flatMap((stage) => {
    const ms = row.stages[stage];
    return ms === undefined ? [] : [`${stage}=${ms}ms`];
  });
  const stagePart = times.length === 0 ? "stages=none" : times.join(" ");
  return `${row.name} ${stagePart} rounds=${row.rounds} waivers=${row.waivers} failed-tests=${row.failedTests} drift=${row.drift}`;
}
