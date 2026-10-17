import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { overviewScaffold } from "../src/core/plan.js";
import { gitCommit, runCli, withTempGitRepo } from "./helper.js";
import { createRun } from "./plan-helper.js";

test("atry plan new scaffolds headings and an empty task list", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "plan-new");
    const created = await runCli(["plan", "new", run, "--json"], dir);
    expect(created.code).toBe(0);
    const body = JSON.parse(created.stdout) as { overview: string; tasks: string };
    expect(await readFile(body.overview, "utf8")).toBe(overviewScaffold);
    expect(JSON.parse(await readFile(body.tasks, "utf8"))).toEqual({ schema: 1, tasks: [] });
    const again = await runCli(["plan", "new", run], dir);
    expect(again.code).toBe(2);
    expect(again.stderr).toContain("10-plan/overview.md: already exists");
  });
});

test("atry plan new refuses a closed run", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "plan-closed");
    const abandoned = await runCli(["close", run, "--abandon", "stop"], dir);
    expect(abandoned.code).toBe(0);
    const refused = await runCli(["plan", "new", run], dir);
    expect(refused.code).toBe(4);
    expect(refused.stderr).toContain("run is abandoned");
  });
});

test("atry plan new refuses when only tasks.input.json exists", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "plan-partial");
    await writeFile(join(run, "10-plan", "tasks.input.json"), "{\"schema\":1,\"tasks\":[]}\n");
    const refused = await runCli(["plan", "new", run], dir);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain("10-plan/tasks.input.json: already exists");
  });
});
