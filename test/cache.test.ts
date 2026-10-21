import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { cacheWarning, rebuildRun, rebuildRunLocked } from "../src/core/cache.js";
import { acquireRunLock, releaseRunLock } from "../src/core/runlock.js";
import { withTempDir } from "./helper.js";

const run = {
  schema: 1,
  id: "1792208725",
  ymd: "20261017",
  slug: "next-state-cli-base",
  title: "v2 P3",
  base: "abc",
  from: "brainstorms/20261017-agent-relay-v2",
  state: {
    lifecycle: "planned",
    stage: "plan",
    approved: false,
    tasks: [],
  },
};

const created = {
  schema: 1,
  ts: "2026-10-17T00:00:00.000Z",
  stage: "run",
  action: "created",
};

async function seed(
  dir: string,
  state = run.state,
  events: unknown[] = [created],
): Promise<string> {
  const runDir = join(dir, "20261017-1792208725-next-state-cli-base");
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "run.json"), `${JSON.stringify({ ...run, state })}\n`, "utf8");
  const body = events.length === 0
    ? ""
    : `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
  await writeFile(join(runDir, "events.jsonl"), body, "utf8");
  return runDir;
}

test("rebuildRun keeps run.json when the state matches the events", async () => {
  await withTempDir(async (dir) => {
    const runDir = await seed(dir);
    const before = await readFile(join(runDir, "run.json"), "utf8");
    const result = await rebuildRun(runDir);
    expect(result.warning).toBeNull();
    expect(result.run.title).toBe("v2 P3");
    expect(await readFile(join(runDir, "run.json"), "utf8")).toBe(before);
  });
});

test("rebuildRun rewrites a stale state and warns once", async () => {
  await withTempDir(async (dir) => {
    const runDir = await seed(dir, run.state, [
      created,
      { schema: 1, ts: "2026-10-17T00:01:00.000Z", stage: "plan", action: "approved" },
    ]);
    const stderr: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
    const result = await rebuildRun(runDir);
    spy.mockRestore();
    expect(result.warning).toBe(cacheWarning);
    expect(stderr).toEqual([`warning: ${cacheWarning}\n`]);
    expect(result.run.state.lifecycle).toBe("approved");
    expect(result.run.state.approved).toBe(true);
    expect(result.run.from).toBe(run.from);
    const stored = JSON.parse(await readFile(join(runDir, "run.json"), "utf8")) as typeof run;
    expect(stored.state.approved).toBe(true);
    expect(stored.title).toBe("v2 P3");
  });
});

test("rebuildRun records one drifted event per detected drift", async () => {
  await withTempDir(async (dir) => {
    const runDir = await seed(dir, run.state, [
      created,
      { schema: 1, ts: "2026-10-17T00:01:00.000Z", stage: "plan", action: "approved" },
    ]);
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const first = await rebuildRun(runDir);
    const second = await rebuildRun(runDir);
    spy.mockRestore();
    expect(first.events.at(-1)).toMatchObject({ stage: "run", action: "drifted" });
    expect(second.warning).toBeNull();
    const lines = (await readFile(join(runDir, "events.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[2] ?? "")).toMatchObject({ stage: "run", action: "drifted" });
    expect(second.run.state.lifecycle).toBe("approved");
  });
});

test("rebuildRun reports a missing cache and a bad event line", async () => {
  await withTempDir(async (dir) => {
    const runDir = await seed(dir);
    await expect(rebuildRun(join(dir, "missing"))).rejects.toMatchObject({
      code: "not_found",
      exitCode: 3,
      fieldPath: "events.jsonl",
    });
    await writeFile(join(runDir, "events.jsonl"), `${JSON.stringify({ schema: 1 })}\n`, "utf8");
    await expect(rebuildRun(runDir)).rejects.toMatchObject({
      code: "validation",
      exitCode: 2,
      fieldPath: "events.jsonl:lines[0].ts",
    });
  });
});

test("rebuildRun names run.json in a cache field error", async () => {
  await withTempDir(async (dir) => {
    const runDir = await seed(dir);
    const bad = { ...run, state: { ...run.state, lifecycle: "bogus" } };
    await writeFile(join(runDir, "run.json"), `${JSON.stringify(bad)}\n`, "utf8");
    await expect(rebuildRun(runDir)).rejects.toMatchObject({
      code: "validation",
      fieldPath: "run.json:state.lifecycle",
    });
  });
});

test("rebuildRun rejects run.json identity that differs from the directory name", async () => {
  await withTempDir(async (dir) => {
    const runDir = await seed(dir);
    await writeFile(
      join(runDir, "run.json"),
      `${JSON.stringify({ ...run, id: "9999999999" })}\n`,
      "utf8",
    );
    await expect(rebuildRun(runDir)).rejects.toMatchObject({
      code: "validation",
      exitCode: 2,
      fieldPath: "run.json:id",
    });
  });
});

test("rebuildRun waits for the run lock before it writes a drift", async () => {
  await withTempDir(async (dir) => {
    const runDir = await seed(dir, run.state, [
      created,
      { schema: 1, ts: "2026-10-17T00:01:00.000Z", stage: "plan", action: "approved" },
    ]);
    const lock = await acquireRunLock(runDir);
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const pending = rebuildRun(runDir);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const before = (await readFile(join(runDir, "events.jsonl"), "utf8")).trim().split("\n");
    expect(before).toHaveLength(2);
    await releaseRunLock(lock);
    const result = await pending;
    spy.mockRestore();
    expect(result.warning).toBe(cacheWarning);
    expect(await exists(join(runDir, "locks", "run.lock"))).toBe(false);
  });
});

test("rebuildRunLocked skips the write when the drift is gone", async () => {
  await withTempDir(async (dir) => {
    const approved = {
      schema: 1,
      ts: "2026-10-17T00:01:00.000Z",
      stage: "plan",
      action: "approved",
    };
    const runDir = await seed(dir, run.state, [created, approved]);
    const lock = await acquireRunLock(runDir);
    const pending = rebuildRun(runDir);
    await new Promise((resolve) => setTimeout(resolve, 100));
    // The lock holder commits run.json before it releases the lock.
    const fixed = { ...run, state: { ...run.state, lifecycle: "approved", approved: true } };
    await writeFile(join(runDir, "run.json"), `${JSON.stringify(fixed)}\n`, "utf8");
    await releaseRunLock(lock);
    const result = await pending;
    expect(result.warning).toBeNull();
    const lines = (await readFile(join(runDir, "events.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    await expect(rebuildRunLocked(runDir)).resolves.toMatchObject({ warning: null });
  });
});

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
