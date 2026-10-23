import { mkdir, rm, writeFile } from "node:fs/promises";
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
  open: [{ q: "Keep the path?", a: "Relative", b: "Absolute" }],
};

const crossReview = {
  schema: 1,
  kind: "cross",
  tool: "antigravity",
  model: "gemini-2.5",
  fixed: 0,
  open: [{ q: "Confirm metrics?", need: "sample data" }],
};

async function seedContext(root: string): Promise<string> {
  const relay = await seedRelay(root);
  const runDir = await seedRun(
    relay,
    runName,
    runCache({
      ...plannedState,
      lifecycle: "reviewing",
      stage: "cross-review",
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
      {
        schema: 1,
        ts: "2026-10-17T00:03:00.000Z",
        stage: "self-review",
        action: "started",
        tool: "cursor",
        model: "unknown",
        detected: "codex",
        tree: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      {
        schema: 1,
        ts: "2026-10-17T00:04:00.000Z",
        stage: "self-review",
        action: "completed",
        tool: "cursor",
        model: "unknown",
        tests: {
          exit: 0,
          ms: 14,
          tree: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
        delta: { files: 1, added: 2, deleted: 1 },
        ref: "30-self-review/02.json",
      },
      {
        schema: 1,
        ts: "2026-10-17T00:05:00.000Z",
        stage: "self-review",
        action: "decided",
        question: "Keep the path?",
        answer: "a",
        ref: "30-self-review/02.json",
      },
      {
        schema: 1,
        ts: "2026-10-17T00:06:00.000Z",
        stage: "cross-review",
        action: "started",
        tool: "antigravity",
        model: "gemini-2.5",
        detected: "codex",
        tree: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      {
        schema: 1,
        ts: "2026-10-17T00:07:00.000Z",
        stage: "cross-review",
        action: "completed",
        tool: "antigravity",
        model: "gemini-2.5",
        tests: "not-configured",
        ref: "40-cross-review/01.json",
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
  await mkdir(join(runDir, "40-cross-review"), { recursive: true });
  await writeFile(join(runDir, "40-cross-review", "01.json"), `${JSON.stringify(crossReview)}\n`);
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
      kind: "self",
      claimed: { tool: "cursor", model: "unknown", open: 1 },
      measured: {
        detected: "codex",
        tests: { exit: 0, ms: 14 },
        delta: { files: 1, added: 2, deleted: 1 },
        decided: 1,
      },
    });
    expect(result.reviews.cross).toMatchObject({
      path: "40-cross-review/01.json",
      claimed: { tool: "antigravity", model: "gemini-2.5", open: 1 },
      measured: { detected: "codex", tests: "not-configured", decided: 0 },
    });
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
      reviews: { self: { claimed: { open: number } }; cross: { claimed: { tool: string } } };
    };
    expect(body.task.plan).toBe("10-plan/T1.md");
    expect(body.reviews.self.claimed.open).toBe(1);
    expect(body.reviews.cross.claimed.tool).toBe("antigravity");
    const missing = await runCli(["context", "--json"], root);
    expect(missing.code).toBe(1);
    expect(JSON.parse(missing.stderr)).toMatchObject({ error: { code: "usage", path: "run" } });
    const bad = await runCli(["context", runName, "--task", "nope"], root);
    expect(bad.code).toBe(2);
    const unknown = await runCli(["context", runName, "--task", "T9"], root);
    expect(unknown.code).toBe(3);
  });
});

test("atry context outputs readable text and handles edge cases", async () => {
  await withTempDir(async (root) => {
    const runDir = await seedContext(root);
    const textCli = await runCli(["context", runName, "--task", "T1"], root);
    expect(textCli.code).toBe(0);
    expect(textCli.stdout).toContain(`run: ${runName}`);
    expect(textCli.stdout).toContain("stage: cross-review");
    expect(textCli.stdout).toContain("plan: 10-plan/T1.md");
    expect(textCli.stdout).toContain("implement: 20-implement/T1.md");

    // Test invalid JSON in index.json
    await writeFile(join(runDir, "10-plan", "index.json"), "{ invalid json");
    await expect(contextFor(runDir, undefined)).rejects.toThrow("invalid JSON");

    // Test invalid schema in index.json
    await writeFile(join(runDir, "10-plan", "index.json"), JSON.stringify({ schema: 99 }));
    await expect(contextFor(runDir, undefined)).rejects.toThrow();

    // Test run with worktree, reason, no brainstorm, and empty tasks
    await writeFile(
      join(runDir, "run.json"),
      JSON.stringify({
        schema: 1,
        id: "1792208725",
        ymd: "20261017",
        slug: "next-state-cli-base",
        title: "v2 P3",
        base: "abc",
        worktree: { path: "/tmp/wt", branch: "feat" },
        state: {
          lifecycle: "planned",
          stage: "plan",
          approved: false,
          tasks: [{ id: "T1", status: "skipped", reason: "not needed" }],
        },
      }),
    );
    await rm(join(runDir, "10-plan", "index.json"), { force: true });
    await writeFile(
      join(runDir, "events.jsonl"),
      JSON.stringify({
        schema: 1,
        ts: "2026-10-17T00:00:00.000Z",
        stage: "implement",
        action: "task-skipped",
        task: "T1",
        reason: "not needed",
      }) + "\n",
    );
    const emptyResult = await contextFor(runDir, undefined);
    expect(emptyResult.brainstorm).toBeNull();
    expect(emptyResult.run.worktree).toEqual({ path: "/tmp/wt", branch: "feat" });
    expect(emptyResult.tasks[0]?.reason).toBe("not needed");
  });
});

test("atry context reads a review JSON that keeps the removed tests key", async () => {
  await withTempDir(async (root) => {
    const runDir = await seedContext(root);
    await writeFile(
      join(runDir, "30-self-review", "02.json"),
      `${JSON.stringify({ ...selfReview, tests: "pass" })}\n`,
    );
    const cli = await runCli(["context", runName, "--json"], root);
    expect(cli.code).toBe(0);
    const body = JSON.parse(cli.stdout) as {
      schema: number;
      reviews: { self: { path: string } };
    };
    expect(body.schema).toBe(1);
    expect(body.reviews.self.path).toBe("30-self-review/02.json");
    expect(body.reviews.self).not.toHaveProperty("tests");
  });
});

test("atry context still refuses an unknown review key", async () => {
  await withTempDir(async (root) => {
    const runDir = await seedContext(root);
    await writeFile(
      join(runDir, "30-self-review", "02.json"),
      `${JSON.stringify({ ...selfReview, nope: true })}\n`,
    );
    const cli = await runCli(["context", runName], root);
    expect(cli.code).toBe(2);
    expect(cli.stderr).toContain("30-self-review/02.json");
  });
});
