import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { statusDetail, statusList } from "../src/core/status.js";
import { runCli, withTempDir } from "./helper.js";
import { createdEvent, plannedState, runCache, runName, seedRelay, seedRun } from "./seed.js";

const now = Date.parse("2026-10-17T02:00:00.000Z");

test("statusList skips a directory that has no run.json", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    await seedRun(relay, runName, runCache(plannedState), [createdEvent]);
    await mkdir(join(relay, "20261018-1792208726-other-run"), { recursive: true });
    const list = await statusList(relay, now);
    expect(list.runs).toHaveLength(1);
    expect(list.runs[0]).toMatchObject({
      name: runName,
      id: "1792208725",
      stage: "plan",
      lifecycle: "planned",
      age: "2h",
      next: "atry approve 1792208725",
    });
  });
});

test("statusList skips a run with invalid events and warns", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    await seedRun(relay, runName, runCache(plannedState), [createdEvent]);
    const bad = await seedRun(relay, "20261018-1792208726-other-run", runCache(plannedState), []);
    await writeFile(join(bad, "events.jsonl"), "not json\n", "utf8");
    const list = await statusList(relay, now);
    expect(list.runs.map((run) => run.name)).toEqual([runName]);
    expect(list.warnings).toHaveLength(1);
    expect(list.warnings?.[0]).toContain("20261018-1792208726-other-run");
  });
});

test("statusDetail rebuilds a stale cache", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    const runDir = await seedRun(relay, runName, runCache(plannedState), [
      createdEvent,
      { schema: 1, ts: "2026-10-17T01:00:00.000Z", stage: "plan", action: "approved" },
    ]);
    const detail = await statusDetail(runDir, now);
    expect(detail.lifecycle).toBe("approved");
    expect(detail.approved).toBe(true);
    expect(detail.warnings).toEqual(["run.json disagreed with events.jsonl; rebuilt"]);
    expect(detail.next).toBe("atry stage start 1792208725 implement");
    const stored = JSON.parse(await readFile(join(runDir, "run.json"), "utf8")) as {
      state: { approved: boolean };
    };
    expect(stored.state.approved).toBe(true);
  });
});

test("atry status prints the list and one run", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    await seedRun(relay, runName, runCache(plannedState), [createdEvent]);
    const list = await runCli(["status"], root);
    expect(list.code).toBe(0);
    expect(list.stdout).toContain(`${runName} plan planned`);
    expect(list.stdout).toContain("next: atry approve 1792208725");
    const one = await runCli(["status", "--json", "--run", "1792208725"], root);
    expect(one.code).toBe(0);
    expect(JSON.parse(one.stdout)).toMatchObject({
      schema: 1,
      id: "1792208725",
      lifecycle: "planned",
      approved: false,
    });
  });
});

test("statusList names the run in a cache rebuild warning", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    await seedRun(relay, runName, runCache(plannedState), [
      createdEvent,
      { ...createdEvent, stage: "plan", action: "approved" },
    ]);
    const list = await statusList(relay, now);
    expect(list.warnings).toEqual([`${runName}: run.json disagreed with events.jsonl; rebuilt`]);
  });
});
