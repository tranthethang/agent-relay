import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { ensurePlanReady, gitCommit, runCli, withTempGitRepo } from "./helper.js";
import { createRun, writeTasks } from "./plan-helper.js";

test("atry plan amend keeps ids and refuses to drop a started task", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "plan-amend");
    await writeTasks(run, [{ title: "First" }, { title: "Second" }, { title: "Third" }]);
    expect((await runCli(["plan", "done", run], dir)).code).toBe(0);
    await ensurePlanReady(run);
    expect((await runCli(["approve", run, "--via", "arg"], dir)).code).toBe(0);
    expect((await runCli(["stage", "start", run, "implement", "--tool", "cursor"], dir)).code)
      .toBe(0);
    expect((await runCli(["task", "start", run, "T1"], dir)).code).toBe(0);
    expect((await runCli(["task", "start", run, "T2"], dir)).code).toBe(0);
    await writeTasks(run, [{ title: "First" }]);
    const refused = await runCli(["plan", "amend", run], dir);
    expect(refused.code).toBe(4);
    expect(refused.stderr).toContain("plan amend refused: T2 has started");
    const before = await readFile(join(run, "10-plan", "index.json"), "utf8");
    await writeTasks(run, [
      { title: "First", files: ["src/core/plan.ts"] },
      { title: "Second" },
      { title: "Third" },
      { title: "Fourth", deps: ["T1"] },
    ]);
    const amended = await runCli(["plan", "amend", run, "--json"], dir);
    expect(amended.code).toBe(0);
    const index = JSON.parse(await readFile(join(run, "10-plan", "index.json"), "utf8")) as {
      tasks: { id: string; title: string; deps: string[]; files: string[] }[];
    };
    expect(index.tasks.map((task) => task.id)).toEqual(["T1", "T2", "T3", "T4"]);
    expect(index.tasks[0]).toMatchObject({ title: "First", files: ["src/core/plan.ts"] });
    expect(index.tasks[3]?.deps).toEqual(["T1"]);
    expect(await readFile(join(run, "10-plan", "T4.md"), "utf8")).toContain("# T4: Fourth");
    expect(before).not.toBe(await readFile(join(run, "10-plan", "index.json"), "utf8"));
    await writeTasks(run, [
      { title: "First" },
      { title: "Second" },
      { title: "Third" },
    ]);
    const dropped = await runCli(["plan", "amend", run, "--json"], dir);
    expect(dropped.code).toBe(0);
    const shorter = JSON.parse(dropped.stdout) as { tasks: string[] };
    expect(shorter.tasks).toEqual(["T1", "T2", "T3"]);
    await writeTasks(run, [
      { title: "First" },
      { title: "Second" },
      { title: "Third" },
      { title: "Later", deps: ["T6"] },
    ]);
    const forward = await runCli(["plan", "amend", run], dir);
    expect(forward.code).toBe(2);
    expect(forward.stderr).toContain("unknown id T6");
    await writeTasks(run, [{ title: "First" }, { title: "Third" }]);
    const middle = await runCli(["plan", "amend", run], dir);
    expect(middle.code).toBe(4);
    expect(middle.stderr).toContain("plan amend refused: T2 has started");
    await writeTasks(run, [{ title: "Second" }, { title: "First" }, { title: "Third" }]);
    const moved = await runCli(["plan", "amend", run, "--json"], dir);
    expect(moved.code).toBe(0);
    expect((JSON.parse(moved.stdout) as { tasks: string[] }).tasks).toEqual(["T2", "T1", "T3"]);
  });
});

test("atry plan amend refuses a new deps list on a started task", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "plan-deps");
    await writeTasks(run, [
      { title: "First" },
      { title: "Second" },
      { title: "Third", deps: ["T1", "T2"] },
    ]);
    expect((await runCli(["plan", "done", run], dir)).code).toBe(0);
    await ensurePlanReady(run);
    expect((await runCli(["approve", run, "--via", "arg"], dir)).code).toBe(0);
    expect((await runCli(["stage", "start", run, "implement", "--tool", "cursor"], dir)).code)
      .toBe(0);
    expect((await runCli(["task", "start", run, "T1"], dir)).code).toBe(0);
    expect((await runCli(["task", "done", run, "T1"], dir)).code).toBe(0);
    expect((await runCli(["task", "start", run, "T2"], dir)).code).toBe(0);
    expect((await runCli(["task", "done", run, "T2"], dir)).code).toBe(0);
    expect((await runCli(["task", "start", run, "T3"], dir)).code).toBe(0);

    await writeTasks(run, [
      { title: "First" },
      { title: "Second" },
      { title: "Third", deps: ["T1"] },
    ]);
    const changed = await runCli(["plan", "amend", run], dir);
    expect(changed.code).toBe(4);
    expect(changed.stderr).toContain("T3.deps: plan amend refused: T3 has started");

    await writeTasks(run, [
      { title: "First" },
      { title: "Second" },
      { title: "Third", deps: ["T2", "T1"] },
    ]);
    const reordered = await runCli(["plan", "amend", run, "--json"], dir);
    expect(reordered.code).toBe(0);
    const index = JSON.parse(await readFile(join(run, "10-plan", "index.json"), "utf8")) as {
      tasks: { id: string; deps: string[] }[];
    };
    expect(index.tasks[2]?.deps).toEqual(["T2", "T1"]);

    await writeTasks(run, [
      { title: "First" },
      { title: "Second" },
      { title: "Third", deps: ["T2", "T1"] },
      { title: "Fourth" },
    ]);
    expect((await runCli(["plan", "amend", run], dir)).code).toBe(0);
    await writeTasks(run, [
      { title: "First" },
      { title: "Second" },
      { title: "Third", deps: ["T2", "T1"] },
      { title: "Fourth", deps: ["T1"] },
    ]);
    const pending = await runCli(["plan", "amend", run, "--json"], dir);
    expect(pending.code).toBe(0);
    const next = JSON.parse(await readFile(join(run, "10-plan", "index.json"), "utf8")) as {
      tasks: { id: string; deps: string[] }[];
    };
    expect(next.tasks[3]?.deps).toEqual(["T1"]);
  });
});

test("atry plan amend does not reuse the id of a dropped task", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "plan-reuse");
    await writeTasks(run, [{ title: "First" }, { title: "Second" }]);
    expect((await runCli(["plan", "done", run], dir)).code).toBe(0);
    await writeTasks(run, [{ title: "First" }]);
    expect((await runCli(["plan", "amend", run], dir)).code).toBe(0);
    await writeTasks(run, [{ title: "First" }, { title: "New" }]);
    const amended = await runCli(["plan", "amend", run, "--json"], dir);
    expect(amended.code).toBe(0);
    expect((JSON.parse(amended.stdout) as { tasks: string[] }).tasks).toEqual(["T1", "T3"]);
    expect(await readFile(join(run, "10-plan", "T3.md"), "utf8")).toContain("# T3: New");
    expect(await readFile(join(run, "10-plan", "T2.md"), "utf8")).toContain("# T2: Second");
  });
});

test("plan amend after approval returns the run to planned", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "plan-amend-approval");
    await writeTasks(run, [{ title: "First" }]);
    expect((await runCli(["plan", "done", run], dir)).code).toBe(0);
    await ensurePlanReady(run);
    expect((await runCli(["approve", run, "--via", "arg"], dir)).code).toBe(0);

    await writeTasks(run, [{ title: "First" }, { title: "Second" }]);
    expect((await runCli(["plan", "amend", run], dir)).code).toBe(0);
    const approved = JSON.parse(await readFile(join(run, "run.json"), "utf8")) as {
      state: { lifecycle: string; stage: string; approved: boolean };
    };
    expect(approved.state).toMatchObject({
      lifecycle: "planned",
      stage: "plan",
      approved: false,
    });

    const incomplete = await runCli(["next", run, "--json"], dir);
    expect(incomplete.code, incomplete.stderr).toBe(0);
    const preview = JSON.parse(incomplete.stdout) as { command: string; reason: string };
    expect(preview.command.endsWith(" --preview")).toBe(true);
    expect(preview.reason).toBe("The plan is incomplete.");

    await ensurePlanReady(run);
    const ready = JSON.parse((await runCli(["next", run, "--json"], dir)).stdout) as {
      command: string;
    };
    expect(ready.command).toMatch(/^atry approve \d+ --preview$/);
    expect((await runCli(["approve", run, "--via", "arg"], dir)).code).toBe(0);
  });
});

test("plan amend allows more than eight tasks with a warning in non-strict mode", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "plan-amend-large");
    await writeTasks(run, [{ title: "First" }]);
    expect((await runCli(["plan", "done", run], dir)).code).toBe(0);
    await writeTasks(
      run,
      Array.from({ length: 9 }, (_, index) => ({
        title: index === 0 ? "First" : `Task ${index + 1}`,
      })),
    );
    const result = await runCli(["plan", "amend", run], dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("warning: plan has 9 tasks");
  });
});
