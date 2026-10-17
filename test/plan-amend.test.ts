import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { gitCommit, runCli, withTempGitRepo } from "./helper.js";
import { createRun, writeTasks } from "./plan-helper.js";

test("atry plan amend keeps ids and refuses to drop a started task", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "plan-amend");
    await writeTasks(run, [{ title: "First" }, { title: "Second" }, { title: "Third" }]);
    expect((await runCli(["plan", "done", run], dir)).code).toBe(0);
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
      { title: "Later", deps: ["T5"] },
    ]);
    const forward = await runCli(["plan", "amend", run], dir);
    expect(forward.code).toBe(2);
    expect(forward.stderr).toContain("unknown id T5");
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
