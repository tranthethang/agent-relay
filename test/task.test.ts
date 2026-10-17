import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { gitCommit, runCli, withTempGitRepo } from "./helper.js";
import { createRun, writeTasks } from "./plan-helper.js";

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
    expect(events).toContain("\"action\":\"task-started\"");
    expect(events).toContain("\"action\":\"task-done\"");
    expect(events).toContain("\"action\":\"task-skipped\"");
    expect(events).toContain("\"reason\":\"not needed\"");
  });
});
