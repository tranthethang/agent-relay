import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { contextFor } from "../src/core/context.js";
import { runCli, withTempDir } from "./helper.js";
import { createdEvent, plannedState, runCache, runName, seedRelay, seedRun } from "./seed.js";

const selfReview = {
  schema: 1,
  kind: "self",
  tool: "cursor",
  model: "unknown",
  fixed: 0,
  tests: "pass",
  open: [{ q: "Keep the path?", a: "Relative", b: "Absolute" }],
};

async function seedContext(root: string): Promise<string> {
  const relay = await seedRelay(root);
  const runDir = await seedRun(
    relay,
    runName,
    runCache({
      ...plannedState,
      tasks: [{ id: "T1", status: "done" }, { id: "T2", status: "in-progress", session: "s1" }],
    }),
    [
      createdEvent,
      {
        schema: 1,
        ts: "2026-10-17T00:01:00.000Z",
        stage: "implement",
        action: "task-done",
        task: "T1",
      },
      {
        schema: 1,
        ts: "2026-10-17T00:02:00.000Z",
        stage: "implement",
        action: "claimed",
        task: "T2",
        session: "s1",
      },
    ],
  );
  await mkdir(join(runDir, "10-plan"), { recursive: true });
  await writeFile(
    join(runDir, "10-plan", "index.json"),
    `${
      JSON.stringify({
        schema: 1,
        tasks: [{
          id: "T1",
          title: "Reducer",
          deps: [],
          files: ["src/core/reduce.ts"],
          path: "10-plan/T1.md",
        }],
      })
    }\n`,
    "utf8",
  );
  await mkdir(join(runDir, "30-self-review"), { recursive: true });
  await writeFile(
    join(runDir, "30-self-review", "01.json"),
    `${JSON.stringify({ ...selfReview, open: [] })}\n`,
  );
  await writeFile(join(runDir, "30-self-review", "02.json"), `${JSON.stringify(selfReview)}\n`);
  return runDir;
}

test("contextFor returns run fields, tasks, the latest review, and stage paths", async () => {
  await withTempDir(async (root) => {
    const runDir = await seedContext(root);
    const result = await contextFor(runDir, "T2");
    expect(result.run).toMatchObject({ id: "1792208725", title: "v2 P3", base: "abc" });
    expect(result.brainstorm).toBe("brainstorms/20261017-agent-relay-v2");
    expect(result.approved).toBe(false);
    expect(result.tasks.map((task) => task.id)).toEqual(["T1", "T2"]);
    expect(result.tasks[0]).toMatchObject({
      status: "done",
      path: "10-plan/T1.md",
      implement: "20-implement/T1.md",
      files: ["src/core/reduce.ts"],
    });
    expect(result.tasks[1]).toMatchObject({
      status: "in-progress",
      session: "s1",
      path: "10-plan/T2.md",
    });
    expect(result.reviews.self).toMatchObject({
      path: "30-self-review/02.json",
      open: selfReview.open,
    });
    expect(result.reviews.cross).toBeNull();
    expect(result.paths.plan).toContain("10-plan/overview.md");
    expect(result.paths.distill).toEqual(["90-distill/manifest.json"]);
    expect(result.paths.run).toEqual(["run.json", "events.jsonl"]);
    expect(result.task).toEqual({
      id: "T2",
      plan: "10-plan/T2.md",
      implement: "20-implement/T2.md",
    });
  });
});

test("atry context --json returns the same fields", async () => {
  await withTempDir(async (root) => {
    await seedContext(root);
    const result = await runCli(["context", runName, "--json", "--task", "T1"], root);
    expect(result.code).toBe(0);
    const body = JSON.parse(result.stdout) as {
      task: { plan: string };
      reviews: { self: { open: unknown[] } };
    };
    expect(body.task.plan).toBe("10-plan/T1.md");
    expect(body.reviews.self.open).toEqual(selfReview.open);
    const missing = await runCli(["context", "--json"], root);
    expect(missing.code).toBe(1);
    expect(JSON.parse(missing.stderr)).toMatchObject({ error: { code: "usage", path: "run" } });
    const bad = await runCli(["context", runName, "--task", "nope"], root);
    expect(bad.code).toBe(2);
    const unknown = await runCli(["context", runName, "--task", "T9"], root);
    expect(unknown.code).toBe(3);
  });
});
