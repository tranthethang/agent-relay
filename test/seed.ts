import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const runName = "20261017-1792208725-next-state-cli-base";

export const createdEvent = {
  schema: 1,
  ts: "2026-10-17T00:00:00.000Z",
  stage: "run",
  action: "created",
};

export function runCache(state: {
  lifecycle: string;
  stage: string;
  approved: boolean;
  tasks: unknown[];
}): unknown {
  return {
    schema: 1,
    id: "1792208725",
    ymd: "20261017",
    slug: "next-state-cli-base",
    title: "v2 P3",
    base: "abc",
    from: "brainstorms/20261017-agent-relay-v2",
    state,
  };
}

export const plannedState = {
  lifecycle: "planned",
  stage: "plan",
  approved: false,
  tasks: [],
};

export async function seedRelay(root: string): Promise<string> {
  const relay = join(root, ".agent-relay");
  await mkdir(relay, { recursive: true });
  return relay;
}

export async function seedRun(
  relay: string,
  name: string,
  cache: unknown,
  events: unknown[],
): Promise<string> {
  const runDir = join(relay, name);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "run.json"), `${JSON.stringify(cache)}\n`, "utf8");
  const body = events.length === 0
    ? ""
    : `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
  await writeFile(join(runDir, "events.jsonl"), body, "utf8");
  return runDir;
}
