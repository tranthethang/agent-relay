import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { gitCommit, runCli, withTempGitRepo } from "./helper.js";
import { createRun, writeTasks } from "./plan-helper.js";

test("atry task start scaffolds the implement file once", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "task-file");
    await writeTasks(run, [{ title: "First" }, { title: "Kept" }]);
    expect((await runCli(["plan", "done", run], dir)).code).toBe(0);
    expect((await runCli(["approve", run, "--via", "arg"], dir)).code).toBe(0);
    expect((await runCli(["stage", "start", run, "implement", "--tool", "cursor"], dir)).code)
      .toBe(0);
    const file = join(run, "20-implement", "T2.md");
    await writeFile(file, "# already\n");
    const started = await runCli(["task", "start", run, "T1", "--json"], dir);
    expect(started.code).toBe(0);
    const body = JSON.parse(started.stdout) as { implement: string };
    expect(await readFile(body.implement, "utf8")).toBe(
      "# T1: First\n\n## Files\n\n## Assumptions\n\n## Risks\n",
    );
    expect(await readFile(file, "utf8")).toBe("# already\n");
  });
});
