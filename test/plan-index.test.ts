import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { gitCommit, runCli, withTempGitRepo } from "./helper.js";
import { createRun, writeTasks } from "./plan-helper.js";

test("atry plan done writes index.json and task scaffolds", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "plan-index");
    await writeTasks(run, [
      { title: "Add the schema", files: ["src/core/plan.ts"] },
      { title: "Call it", deps: ["T1"] },
    ]);
    const done = await runCli(["plan", "done", run, "--json"], dir);
    expect(done.code).toBe(0);
    const body = JSON.parse(done.stdout) as { tasks: string[]; index: string };
    expect(body.tasks).toEqual(["T1", "T2"]);
    const index = JSON.parse(await readFile(body.index, "utf8")) as {
      schema: number;
      tasks: { id: string; title: string; deps: string[]; files: string[]; path: string }[];
    };
    expect(index.schema).toBe(1);
    expect(index.tasks[0]).toEqual({
      id: "T1",
      title: "Add the schema",
      deps: [],
      files: ["src/core/plan.ts"],
      path: "10-plan/T1.md",
    });
    expect(index.tasks[1]?.path).toBe("10-plan/T2.md");
    const scaffold = await readFile(join(run, "10-plan", "T1.md"), "utf8");
    expect(scaffold).toBe("# T1: Add the schema\n\n## Detail\n\n## Acceptance\n");
    await writeFile(join(run, "10-plan", "T1.md"), "# kept\n");
    await writeTasks(run, [
      { title: "Add the schema", files: ["src/core/plan.ts"] },
      { title: "Call it", deps: ["T1"] },
    ]);
    const again = await runCli(["plan", "done", run], dir);
    expect(again.code).toBe(0);
    expect(await readFile(join(run, "10-plan", "T1.md"), "utf8")).toBe("# kept\n");
    const events = await readFile(join(run, "events.jsonl"), "utf8");
    expect(events).toContain("\"stage\":\"plan\"");
    expect(events).toContain("\"action\":\"completed\"");
  });
});
