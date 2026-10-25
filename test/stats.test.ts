import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parseStatsSince, statsForRelay, statsForRun, statsText } from "../src/core/stats.js";
import { runCli, withTempDir } from "./helper.js";
import { plannedState, runCache, runName, seedRelay, seedRun } from "./seed.js";

const tree = "a".repeat(40);

function reviewJson(kind: string, findings: unknown[] | undefined): string {
  return `${
    JSON.stringify({
      schema: 1,
      kind,
      tool: "cursor",
      model: "unknown",
      ...(findings === undefined ? { fixed: 2 } : { findings }),
      open: [],
    })
  }\n`;
}

function finding(id: string, severity: string, status: string): Record<string, unknown> {
  return { id, severity, status, file: null, line: null, evidence: "e" };
}

async function seedReviews(runDir: string): Promise<void> {
  await mkdir(join(runDir, "30-self-review"), { recursive: true });
  await mkdir(join(runDir, "40-cross-review"), { recursive: true });
  await writeFile(
    join(runDir, "30-self-review", "01.json"),
    reviewJson("self", [finding("F1", "high", "open"), finding("F2", "low", "fixed")]),
  );
  await writeFile(join(runDir, "30-self-review", "02.json"), reviewJson("self", undefined));
  await writeFile(
    join(runDir, "40-cross-review", "01.json"),
    reviewJson("cross", [finding("F1", "medium", "open")]),
  );
}

function at(second: number, fields: Record<string, unknown>): Record<string, unknown> {
  const ts = new Date(Date.parse("2026-10-17T00:00:00.000Z") + second * 1000).toISOString();
  return { schema: 1, ts, ...fields };
}

test("atry stats prints no rows for an empty relay", async () => {
  await withTempDir(async (root) => {
    await seedRelay(root);
    const json = await runCli(["stats", "--json"], root);
    expect(json.code).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual({ schema: 1, runs: [] });
    const text = await runCli(["stats"], root);
    expect(text.stdout).toBe("runs: none\n");
    expect(statsText({ schema: 1, runs: [] })).toBe("runs: none\n");
  });
});

test("atry stats reads one run and does not write an event", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    const events = [
      at(0, { stage: "plan", action: "started" }),
      at(60, { stage: "plan", action: "completed" }),
      at(60, { stage: "implement", action: "started" }),
      at(180, { stage: "implement", action: "completed" }),
      at(180, { stage: "self-review", action: "completed", tests: { exit: 1, ms: 5, tree } }),
      at(181, { stage: "cross-review", action: "completed", tests: "not-configured" }),
      at(182, { stage: "run", action: "waived", reason: "skip" }),
      at(183, { stage: "run", action: "drifted" }),
      at(184, { stage: "implement", action: "drifted" }),
      at(185, { stage: "self-review", action: "completed", tests: { exit: 0, ms: 1, tree } }),
    ];
    const runDir = await seedRun(relay, runName, runCache(plannedState), events);
    const before = await readFile(join(runDir, "events.jsonl"), "utf8");
    const result = await statsForRun(runDir);
    expect(await readFile(join(runDir, "events.jsonl"), "utf8")).toBe(before);
    expect(result).toMatchObject({
      schema: 1,
      runs: [{
        name: runName,
        id: "1792208725",
        stages: { plan: 60000, implement: 120000 },
        rounds: 3,
        waivers: 1,
        failedTests: 1,
        drift: 1,
      }],
    });
    const cli = await runCli(["stats", "--json", runName], root);
    expect(cli.code).toBe(0);
    expect(JSON.parse(cli.stdout)).toMatchObject({ schema: 1, runs: [{ id: "1792208725" }] });
    const text = await runCli(["stats", "1792208725"], root);
    expect(text.stdout).toContain(`${runName} plan=60000ms implement=120000ms`);
    expect(text.stdout).toContain("rounds=3 waivers=1 failed-tests=1 drift=1");
  });
});

test("stats sums stage gaps and ignores an open stage", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    const events = [
      at(0, { stage: "implement", action: "started" }),
      at(10, { stage: "implement", action: "completed" }),
      at(20, { stage: "implement", action: "started" }),
      at(50, { stage: "implement", action: "completed" }),
      at(0, { stage: "plan", action: "started" }),
      at(10, { stage: "plan", action: "started" }),
      at(40, { stage: "plan", action: "completed" }),
      at(10, { stage: "distill", action: "started" }),
      at(0, { stage: "distill", action: "completed" }),
      at(0, { stage: "run", action: "completed" }),
      at(5, { stage: "brainstorm", action: "started" }),
    ];
    const runDir = await seedRun(relay, runName, runCache(plannedState), events);
    const result = await statsForRun(runDir);
    expect(result.runs[0]?.stages).toEqual({
      implement: 40000,
      plan: 30000,
      distill: 0,
    });
    expect(statsText(result)).toContain("distill=0ms");
    expect(statsText(result)).not.toContain("brainstorm");
  });
});

test("stats warns and skips a run whose events cannot be read", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    await seedRun(relay, runName, runCache(plannedState), [
      at(0, { stage: "run", action: "created" }),
    ]);
    const missing = join(relay, "20261018-1792208726-other-run");
    await mkdir(missing);
    const bad = join(relay, "20261018-1792208727-bad-events");
    await mkdir(bad);
    await writeFile(join(bad, "events.jsonl"), "{\"schema\":1}\n", "utf8");
    const broken = join(relay, "20261018-1792208728-not-json");
    await mkdir(broken);
    await writeFile(join(broken, "events.jsonl"), "not json\n", "utf8");
    const list = await statsForRelay(root);
    expect(list.runs.map((run) => run.name)).toEqual([runName]);
    expect(list.warnings).toHaveLength(3);
    expect(statsText(list)).toContain("stages=none");
    await expect(statsForRun(missing)).rejects.toMatchObject({ message: "events.jsonl not found" });
    await expect(statsForRun(bad)).rejects.toMatchObject({ message: "invalid event" });
  });
});

test("stats rethrows a read error that is not a relay error", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    const runDir = join(relay, runName);
    await mkdir(join(runDir, "events.jsonl"), { recursive: true });
    await expect(statsForRelay(root)).rejects.toThrow();
  });
});

test("stats --since and --failed keep matching runs and can combine", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    const olderName = "20261001-1792208726-older-run";
    const newerName = "20261020-1792208727-newer-run";
    await seedRun(relay, olderName, runCache(plannedState), [
      { schema: 1, ts: "2026-10-01T00:00:00.000Z", stage: "run", action: "created" },
    ]);
    await seedRun(relay, newerName, runCache(plannedState), [
      { schema: 1, ts: "2026-10-20T00:00:00.000Z", stage: "run", action: "created" },
      {
        schema: 1,
        ts: "2026-10-20T00:01:00.000Z",
        stage: "self-review",
        action: "completed",
        tests: { exit: 1, ms: 1, tree },
      },
    ]);

    const since = await runCli(["stats", "--since", "2026-10-10", "--json"], root);
    expect(since.code, since.stderr).toBe(0);
    expect((JSON.parse(since.stdout) as { runs: { name: string }[] }).runs.map((run) => run.name))
      .toEqual([newerName]);

    const failed = await runCli(["stats", "--failed", "--json"], root);
    expect(failed.code, failed.stderr).toBe(0);
    expect((JSON.parse(failed.stdout) as { runs: { name: string }[] }).runs.map((run) => run.name))
      .toEqual([newerName]);

    const both = await runCli(
      ["stats", "--since", "2026-10-10", "--failed", "--json"],
      root,
    );
    expect(both.code, both.stderr).toBe(0);
    expect((JSON.parse(both.stdout) as { runs: { name: string }[] }).runs.map((run) => run.name))
      .toEqual([newerName]);

    const none = await runCli(["stats", "--since", "2026-10-25"], root);
    expect(none.stdout).toBe("runs: none\n");

    const oneRun = await runCli(["stats", olderName, "--since", "2026-10-10"], root);
    expect(oneRun.stdout).toBe("runs: none\n");

    const direct = await statsForRelay(root, { since: new Date("2026-10-10") });
    expect(direct.runs.map((run) => run.name)).toEqual([newerName]);
    const directFailed = await statsForRun(join(relay, olderName), { failed: true });
    expect(directFailed.runs).toEqual([]);
  });
});

test("stats rejects an invalid --since date with exit 2", async () => {
  await withTempDir(async (root) => {
    await seedRelay(root);
    const result = await runCli(["stats", "--since", "not-a-date"], root);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("invalid --since date: not-a-date");
    expect(() => parseStatsSince("2026-13-01")).toThrow("invalid --since date");
    expect(parseStatsSince("2026-10-01").toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});

test("stats sums findings over every review of the run", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    const runDir = await seedRun(relay, runName, runCache(plannedState), [
      at(0, { stage: "run", action: "created" }),
    ]);
    await seedReviews(runDir);
    const result = await statsForRun(runDir);
    expect(result.runs[0]?.findings).toEqual({
      high: 1,
      medium: 1,
      low: 1,
      open: 2,
      fixed: 1,
      rejected: 0,
      highOpen: 1,
    });
    expect(statsText(result)).toMatch(/drift=0 findings=3 high-open=1 fixed=1\n$/);
    const keys = Object.keys(result.runs[0] ?? {});
    expect(keys.at(-1)).toBe("findings");
  });
});

test("stats counts zero findings when there are no reviews", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    const runDir = await seedRun(relay, runName, runCache(plannedState), [
      at(0, { stage: "run", action: "created" }),
    ]);
    expect((await statsForRun(runDir)).runs[0]?.findings).toMatchObject({ open: 0, highOpen: 0 });
  });
});
