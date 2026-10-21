import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { appendChained, lineHash, rebuildRun } from "../src/core/cache.js";
import { withTempDir } from "./helper.js";

const run = {
  schema: 1,
  id: "1792208725",
  ymd: "20261017",
  slug: "event-chain",
  title: "chain",
  base: "abc",
  state: { lifecycle: "planned", stage: "plan", approved: false, tasks: [] },
};

const created = { schema: 1, ts: "2026-10-17T00:00:00.000Z", stage: "run", action: "created" };
const plan = { schema: 1, ts: "2026-10-17T00:01:00.000Z", stage: "plan", action: "started" };

async function seed(dir: string, lines: string[]): Promise<string> {
  const runDir = join(dir, "20261017-1792208725-event-chain");
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "run.json"), `${JSON.stringify(run)}\n`, "utf8");
  await writeFile(join(runDir, "events.jsonl"), `${lines.join("\n")}\n`, "utf8");
  return runDir;
}

async function rawLines(runDir: string): Promise<string[]> {
  return (await readFile(join(runDir, "events.jsonl"), "utf8")).trim().split("\n");
}

test("appendChained links each new line to the previous raw line", async () => {
  await withTempDir(async (dir) => {
    const runDir = await seed(dir, [JSON.stringify(created)]);
    const event = await appendChained(runDir, plan as Parameters<typeof appendChained>[1]);
    const lines = await rawLines(runDir);
    expect(event.prev).toBe(lineHash(lines[0] ?? ""));
    expect(JSON.parse(lines[1] ?? "{}")).toMatchObject({ prev: event.prev });
    const loaded = await rebuildRun(runDir);
    expect(loaded.events).toHaveLength(2);
  });
});

test("appendChained writes the first line without prev", async () => {
  await withTempDir(async (dir) => {
    const runDir = join(dir, "run");
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "events.jsonl"), "", "utf8");
    const event = await appendChained(runDir, created as Parameters<typeof appendChained>[1]);
    expect(event.prev).toBeUndefined();
  });
});

test("rebuildRun accepts an old run without prev", async () => {
  await withTempDir(async (dir) => {
    const runDir = await seed(dir, [JSON.stringify(created), JSON.stringify(plan)]);
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await expect(rebuildRun(runDir)).resolves.toMatchObject({ events: expect.any(Array) });
    spy.mockRestore();
  });
});

test("rebuildRun rejects a changed line before a chained line", async () => {
  await withTempDir(async (dir) => {
    const first = JSON.stringify(created);
    const second = JSON.stringify({ ...plan, prev: lineHash(first) });
    const changed = JSON.stringify({ ...created, ts: "2026-10-17T00:00:01.000Z" });
    const runDir = await seed(dir, [changed, second]);
    await expect(rebuildRun(runDir)).rejects.toMatchObject({
      code: "validation",
      message: "prev does not match the previous line",
      fieldPath: "events.jsonl:lines[1].prev",
    });
  });
});

test("rebuildRun rejects a line without prev after the chain starts", async () => {
  await withTempDir(async (dir) => {
    const first = JSON.stringify(created);
    const second = JSON.stringify({ ...plan, prev: lineHash(first) });
    const runDir = await seed(dir, [first, second, JSON.stringify(plan)]);
    await expect(rebuildRun(runDir)).rejects.toMatchObject({
      code: "validation",
      message: "prev is missing",
      fieldPath: "events.jsonl:lines[2].prev",
    });
  });
});

test("rebuildRun rejects prev on the first line", async () => {
  await withTempDir(async (dir) => {
    const runDir = await seed(dir, [JSON.stringify({ ...created, prev: lineHash("x") })]);
    await expect(rebuildRun(runDir)).rejects.toMatchObject({
      fieldPath: "events.jsonl:lines[0].prev",
    });
  });
});
