import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { ensurePlanReady, gitCommit, runCli, withTempGitRepo } from "./helper.js";
import { createRun, writeTasks } from "./plan-helper.js";

const execFileAsync = promisify(execFile);

test("atry task start done and skip record events and check deps", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "task-verbs");
    await writeTasks(run, [
      { title: "First" },
      { title: "Second", deps: ["T1"] },
      { title: "Third", deps: ["T1"] },
      { title: "Fourth", deps: ["T3"] },
    ]);
    expect((await runCli(["plan", "done", run], dir)).code).toBe(0);
    const early = await runCli(["task", "start", run, "T1"], dir);
    expect(early.code).toBe(4);
    expect(early.stderr).toContain("task start refused: run is planned");
    await ensurePlanReady(run);
    expect((await runCli(["approve", run, "--via", "arg"], dir)).code).toBe(0);
    expect((await runCli(["stage", "start", run, "implement", "--tool", "cursor"], dir)).code)
      .toBe(0);
    const blocked = await runCli(["task", "start", run, "T2"], dir);
    expect(blocked.code).toBe(4);
    expect(blocked.stderr).toContain("T2.deps: task start refused: T1 is pending");
    const started = await runCli(["task", "start", run, "T1", "--json"], dir);
    expect(started.code).toBe(0);
    expect(JSON.parse(started.stdout)).toMatchObject({ task: "T1", status: "in-progress" });
    const pendingDone = await runCli(["task", "done", run, "T2"], dir);
    expect(pendingDone.code).toBe(4);
    const done = await runCli(["task", "done", run, "T1", "--json"], dir);
    expect(done.code).toBe(0);
    expect(JSON.parse(done.stdout)).toMatchObject({ task: "T1", status: "done" });
    const next = await runCli(["task", "start", run, "T2"], dir);
    expect(next.code).toBe(0);
    const skipped = await runCli([
      "task",
      "skip",
      run,
      "T3",
      "--reason",
      "not needed",
      "--json",
    ], dir);
    expect(skipped.code).toBe(0);
    expect(JSON.parse(skipped.stdout)).toMatchObject({
      task: "T3",
      status: "skipped",
      reason: "not needed",
    });
    const afterSkip = await runCli(["task", "start", run, "T4"], dir);
    expect(afterSkip.code).toBe(0);
    const missing = await runCli(["task", "start", run, "T9"], dir);
    expect(missing.code).toBe(3);
    const bad = await runCli(["task", "start", run, "nope"], dir);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("task: invalid task id");
    const events = await readFile(join(run, "events.jsonl"), "utf8");
    const startedEvents = events.trim().split("\n").map((line) =>
      JSON.parse(line) as { action: string; tree?: string }
    )
      .filter((event) => event.action === "task-started");
    expect(startedEvents.length).toBeGreaterThan(0);
    for (const event of startedEvents) expect(event.tree).toMatch(/^[0-9a-f]{40}$/);
    expect(events).toContain("\"action\":\"task-started\"");
    expect(events).toContain("\"action\":\"task-done\"");
    expect(events).toContain("\"action\":\"task-skipped\"");
    expect(events).toContain("\"reason\":\"not needed\"");
  });
});

test("task done checks edits against task files", async () => {
  await withTempGitRepo(async (dir) => {
    await writeFile(
      join(dir, ".agent-relay.json"),
      JSON.stringify({
        schema: 1,
        requireReviews: ["self", "cross"],
        smallChange: 20,
        strict: { scope: true },
      }),
    );
    await execFileAsync("git", ["add", ".agent-relay.json"], { cwd: dir });
    await gitCommit(dir);
    const run = await createRun(dir, "task-scope");
    await writeTasks(run, [
      { title: "Own file", files: ["src/own.ts"] },
      { title: "Directory", files: ["src/dir"] },
      { title: "Peer", files: ["src/peer.ts"] },
    ]);
    expect((await runCli(["plan", "done", run], dir)).code).toBe(0);
    await ensurePlanReady(run);
    expect((await runCli(["approve", run, "--via", "arg"], dir)).code).toBe(0);
    expect((await runCli(["stage", "start", run, "implement", "--tool", "cursor"], dir)).code)
      .toBe(0);
    await mkdir(join(dir, "src/dir"), { recursive: true });

    expect((await runCli(["task", "start", run, "T1"], dir)).code).toBe(0);
    await writeFile(join(dir, "src/own.ts"), "export const own = 1;\n");
    expect((await runCli(["task", "done", run, "T1"], dir)).code).toBe(0);

    expect((await runCli(["task", "start", run, "T2"], dir)).code).toBe(0);
    await writeFile(join(dir, "src/dir/nested.ts"), "export const nested = 1;\n");
    expect((await runCli(["task", "done", run, "T2"], dir)).code).toBe(0);

    await writeTasks(run, [
      { title: "Own file", files: ["src/own.ts"] },
      { title: "Directory", files: ["src/dir"] },
      { title: "Peer", files: ["src/peer.ts"] },
      { title: "Kept", files: ["src/kept.ts"] },
    ]);
    expect((await runCli(["plan", "amend", run], dir)).code).toBe(0);
    expect((await runCli(["task", "start", run, "T4"], dir)).code).toBe(0);
    await writeFile(join(dir, "src/outside.ts"), "export const outside = 1;\n");
    const refused = await runCli(["task", "done", run, "T4"], dir);
    expect(refused.code).toBe(4);
    expect(refused.stderr).toContain("src/outside.ts");
    await rm(join(dir, "src/outside.ts"));
    expect((await runCli(["claim", run, "T3", "--session", "bob"], dir)).code).toBe(0);
    await writeFile(join(dir, "src/peer.ts"), "export const peer = 1;\n");
    expect((await runCli(["task", "done", run, "T4"], dir)).code).toBe(0);
    // Implement starts only on a clean tree.
    await rm(join(dir, "src"), { recursive: true });

    const many = await createRun(dir, "task-scope-extra");
    await writeTasks(many, [{ title: "Wide", files: ["src/kept.ts"] }]);
    expect((await runCli(["plan", "done", many], dir)).code).toBe(0);
    await ensurePlanReady(many);
    expect((await runCli(["approve", many, "--via", "arg"], dir)).code).toBe(0);
    expect((await runCli(["stage", "start", many, "implement", "--tool", "cursor"], dir)).code)
      .toBe(0);
    expect((await runCli(["task", "start", many, "T1"], dir)).code).toBe(0);
    await mkdir(join(dir, "src"), { recursive: true });
    for (let index = 0; index < 11; index += 1) {
      const name = `src/out-${String(index).padStart(2, "0")}.ts`;
      await writeFile(join(dir, name), "export {};\n");
    }
    const capped = await runCli(["task", "done", many, "T1"], dir);
    expect(capped.code).toBe(4);
    expect(capped.stderr).toContain("src/out-09.ts");
    expect(capped.stderr).not.toContain("src/out-10.ts");
    const allowed = await runCli([
      "task",
      "done",
      many,
      "T1",
      "--allow-extra",
      "shared types",
      "--json",
    ], dir);
    expect(allowed.code).toBe(0);
    const events = await readFile(join(many, "events.jsonl"), "utf8");
    const done = events.trim().split("\n").map((line) =>
      JSON.parse(line) as {
        action: string;
        extra?: string[];
        reason?: string;
      }
    ).find((event) => event.action === "task-done");
    expect(done?.reason).toBe("shared types");
    expect(done?.extra).toHaveLength(11);
    expect(done?.extra).toContain("src/out-10.ts");
  });
});

test("non-strict scope records extras and continues through implement completion", async () => {
  await withTempGitRepo(async (dir) => {
    await writeFile(
      join(dir, ".agent-relay.json"),
      JSON.stringify({
        schema: 1,
        requireReviews: ["self", "cross"],
        smallChange: 20,
        strict: { scope: false },
      }),
    );
    await execFileAsync("git", ["add", ".agent-relay.json"], { cwd: dir });
    await gitCommit(dir);
    const run = await createRun(dir, "task-scope-warning");
    await writeTasks(run, [{ title: "Own file", files: ["src/own.ts"] }]);
    expect((await runCli(["plan", "done", run], dir)).code).toBe(0);
    await ensurePlanReady(run);
    expect((await runCli(["approve", run, "--via", "arg"], dir)).code).toBe(0);
    expect(
      (await runCli(["stage", "start", run, "implement", "--tool", "cursor"], dir))
        .code,
    ).toBe(0);
    expect((await runCli(["task", "start", run, "T1"], dir)).code).toBe(0);
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src/unplanned.ts"), "export {} as unplanned;\n");
    const taskDone = await runCli(["task", "done", run, "T1"], dir);
    expect(taskDone.code).toBe(0);
    expect(taskDone.stdout).toContain("scope warning");
    expect(taskDone.stdout).toContain("src/unplanned.ts");

    await writeFile(join(dir, "src/late.ts"), "export {} as late;\n");
    const stageDone = await runCli(["stage", "done", run, "implement", "--tool", "cursor"], dir);
    expect(stageDone.code).toBe(0);
    expect(stageDone.stdout).toContain("src/late.ts");
    const events = (await readFile(join(run, "events.jsonl"), "utf8")).trim().split("\n")
      .map((line) =>
        JSON.parse(line) as {
          action: string;
          stage: string;
          extra?: string[];
          reason?: string;
        }
      );
    const taskEvent = events.find((event) => event.action === "task-done");
    const stageEvent = events.find((event) =>
      event.action === "completed" && event.stage === "implement"
    );
    expect(taskEvent?.extra).toContain("src/unplanned.ts");
    expect(taskEvent?.reason).toContain("strict.scope=false");
    expect(stageEvent?.extra).toContain("src/late.ts");
    expect(stageEvent?.reason).toContain("strict.scope=false");
  });
});

test("task done ignores files of a task that finished during the window", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "task-scope-peer-done");
    await writeTasks(run, [
      { title: "Alice", files: ["src/alice.ts"] },
      { title: "Bob", files: ["src/bob.ts"] },
    ]);
    expect((await runCli(["plan", "done", run], dir)).code).toBe(0);
    await ensurePlanReady(run);
    expect((await runCli(["approve", run, "--via", "arg"], dir)).code).toBe(0);
    expect((await runCli(["stage", "start", run, "implement", "--tool", "cursor"], dir)).code)
      .toBe(0);
    await mkdir(join(dir, "src"), { recursive: true });
    expect((await runCli(["claim", run, "T1", "--session", "alice"], dir)).code).toBe(0);
    expect((await runCli(["claim", run, "T2", "--session", "bob"], dir)).code).toBe(0);
    await writeFile(join(dir, "src/bob.ts"), "export const bob = 1;\n");
    expect((await runCli(["task", "done", run, "T2", "--session", "bob"], dir)).code).toBe(0);
    await writeFile(join(dir, "src/alice.ts"), "export const alice = 1;\n");
    expect((await runCli(["task", "done", run, "T1", "--session", "alice"], dir)).code).toBe(0);
  });
});
