import { basename, join } from "node:path";
import { findRelayDir, listRunNames, runIdFromName } from "./discover.js";
import { RelayError } from "./error.js";
import { type EventLine, eventLineSchema } from "./event.js";
import { isEnoent, readJsonlLines } from "./files.js";
import { listReviewPaths, readReviewDocument, reviewKinds } from "./review.js";
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
  findings: FindingCounts;
};

export type FindingCounts = {
  high: number;
  medium: number;
  low: number;
  open: number;
  fixed: number;
  rejected: number;
  // Not in the plan's key list; the text row needs it.
  highOpen: number;
};

export type StatsResult = {
  schema: 1;
  runs: StatsRow[];
  warnings?: string[];
};

export type StatsFilter = {
  since?: Date;
  failed?: boolean;
};

export function parseStatsSince(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RelayError("validation", `invalid --since date: ${value}`, "since");
  }
  return date;
}

export function statsText(result: StatsResult): string {
  if (result.runs.length === 0) return "runs: none\n";
  return `${result.runs.map(rowText).join("\n")}\n`;
}

export async function statsForRelay(cwd: string, filter: StatsFilter = {}): Promise<StatsResult> {
  const relayDir = await findRelayDir(cwd);
  const runs: StatsRow[] = [];
  const warnings: string[] = [];
  for (const name of await listRunNames(relayDir)) {
    try {
      const row = await statsRow(join(relayDir, name), filter);
      if (row !== undefined) runs.push(row);
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

export async function statsForRun(runDir: string, filter: StatsFilter = {}): Promise<StatsResult> {
  const row = await statsRow(runDir, filter);
  return { schema: schemaVersion, runs: row === undefined ? [] : [row] };
}

function matchesFilter(events: readonly EventLine[], filter: StatsFilter): boolean {
  if (filter.failed === true && !events.some((event) => failedTest(event))) return false;
  if (filter.since !== undefined) {
    const since = filter.since.getTime();
    if (!events.some((event) => Date.parse(event.ts) >= since)) return false;
  }
  return true;
}

async function statsRow(runDir: string, filter: StatsFilter): Promise<StatsRow | undefined> {
  const name = basename(runDir);
  const events = await readEvents(runDir);
  if (!matchesFilter(events, filter)) return undefined;
  return {
    name,
    id: runIdFromName(name),
    stages: stageTimes(events),
    rounds: events.filter((event) => event.action === "completed" && reviewStages.has(event.stage))
      .length,
    waivers: events.filter((event) => event.action === "waived").length,
    failedTests: events.filter((event) => failedTest(event)).length,
    drift: driftCount(events),
    findings: await findingCounts(runDir),
  };
}

// Sums every review of the run. An old review with no findings counts as zero.
async function findingCounts(runDir: string): Promise<FindingCounts> {
  const counts: FindingCounts = {
    high: 0,
    medium: 0,
    low: 0,
    open: 0,
    fixed: 0,
    rejected: 0,
    highOpen: 0,
  };
  for (const kind of reviewKinds) {
    for (const rel of await listReviewPaths(runDir, kind)) {
      for (const finding of (await readReviewDocument(runDir, rel)).findings) {
        counts[finding.severity] += 1;
        counts[finding.status] += 1;
        if (finding.severity === "high" && finding.status === "open") counts.highOpen += 1;
      }
    }
  }
  return counts;
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
  return `${row.name} ${stagePart} rounds=${row.rounds} waivers=${row.waivers} failed-tests=${row.failedTests} drift=${row.drift} findings=${
    row.findings.high + row.findings.medium + row.findings.low
  } high-open=${row.findings.highOpen} fixed=${row.findings.fixed}`;
}
