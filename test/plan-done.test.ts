import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { RelayError } from "../src/core/error.js";
import { indexFromTasks } from "../src/core/plan.js";
import { gitCommit, runCli, withTempGitRepo } from "./helper.js";
import { createRun, writeTasks } from "./plan-helper.js";

test("indexFromTasks assigns ids and rejects dep errors", () => {
  const index = indexFromTasks([
    { title: "First", deps: [], files: ["src/core/plan.ts"] },
    { title: "Second", deps: ["T1"], files: [] },
  ]);
  expect(index.tasks.map((task) => task.id)).toEqual(["T1", "T2"]);
  expect(() => indexFromTasks([{ title: "Loop", deps: ["T1"], files: [] }])).toThrow(RelayError);
  try {
    indexFromTasks([
      { title: "A", deps: ["T2"], files: [] },
      { title: "B", deps: ["T1"], files: [] },
    ]);
  } catch (error) {
    expect(error).toBeInstanceOf(RelayError);
    expect((error as RelayError).code).toBe("validation");
    expect((error as RelayError).message).toBe("cycle T1 T2");
  }
  try {
    indexFromTasks([{ title: "A", deps: ["T2"], files: [] }, { title: "B", deps: [], files: [] }]);
  } catch (error) {
    expect((error as RelayError).message).toBe("forward dep T2");
    expect((error as RelayError).fieldPath).toBe("tasks[0].deps[0]");
  }
  try {
    indexFromTasks([{ title: "A", deps: ["T9"], files: [] }]);
  } catch (error) {
    expect((error as RelayError).message).toBe("unknown id T9");
    expect((error as RelayError).fieldPath).toBe("tasks[0].deps[0]");
  }
  try {
    indexFromTasks(Array.from({ length: 9 }, (_, index) => ({
      title: `Task ${index + 1}`,
      deps: [],
      files: [],
    })));
  } catch (error) {
    expect((error as RelayError).code).toBe("gate");
    expect((error as RelayError).exitCode).toBe(4);
  }
});

test("plan done and plan amend reject root and escaping files", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "plan-files");
    const rejected = [".", "./", "", "../outside", "/x", "C:\\x"];
    for (const file of rejected) {
      await writeTasks(run, [{ title: "First", files: ["src/ok.ts", file] }]);
      const result = await runCli(["plan", "done", run], dir);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("tasks[0].files[1]");
    }
    await expect(readFile(join(run, "10-plan", "index.json"), "utf8")).rejects.toThrow();
    await writeTasks(run, [{ title: "First", files: ["src/core/plan.ts"] }]);
    expect((await runCli(["plan", "done", run], dir)).code).toBe(0);
    await writeTasks(run, [{ title: "First", files: ["src/../src/core/plan.ts"] }]);
    const amended = await runCli(["plan", "amend", run, "--json"], dir);
    expect(amended.code).toBe(0);
    const index = JSON.parse(await readFile(join(run, "10-plan", "index.json"), "utf8")) as {
      tasks: { files: string[] }[];
    };
    expect(index.tasks[0]?.files).toEqual(["src/../src/core/plan.ts"]);
    await writeTasks(run, [{ title: "First", files: ["../outside"] }]);
    const bad = await runCli(["plan", "amend", run], dir);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("tasks[0].files[0]");
    const kept = JSON.parse(await readFile(join(run, "10-plan", "index.json"), "utf8")) as {
      tasks: { files: string[] }[];
    };
    expect(kept.tasks[0]?.files).toEqual(["src/../src/core/plan.ts"]);
  });
});

test("atry plan done reports dep errors and the 8-task gate", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "plan-done");
    const missing = await runCli(["plan", "done", run], dir);
    expect(missing.code).toBe(3);
    await writeTasks(run, [{ title: "A", deps: ["T9"] }]);
    const unknown = await runCli(["plan", "done", run], dir);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain("tasks[0].deps[0]: unknown id T9");
    await writeTasks(run, [{ title: "A", deps: ["T2"] }, { title: "B" }]);
    const forward = await runCli(["plan", "done", run], dir);
    expect(forward.code).toBe(2);
    expect(forward.stderr).toContain("forward dep T2");
    await writeTasks(run, [{ title: "A", deps: ["T2"] }, { title: "B", deps: ["T1"] }]);
    const cycle = await runCli(["plan", "done", run], dir);
    expect(cycle.code).toBe(2);
    expect(cycle.stderr).toContain("cycle T1 T2");
    await writeTasks(run, [{ title: "A", deps: ["nope"] }]);
    const schema = await runCli(["plan", "done", run], dir);
    expect(schema.code).toBe(2);
    expect(schema.stderr).toContain("tasks[0].deps[0]");
    await writeTasks(
      run,
      Array.from({ length: 9 }, (_, index) => ({ title: `Task ${index + 1}` })),
    );
    const gate = await runCli(["plan", "done", run], dir);
    expect(gate.code).toBe(4);
    expect(gate.stderr).toContain("plan has more than 8 tasks");
    const events = await readFile(join(run, "events.jsonl"), "utf8");
    expect(events).not.toContain("\"action\":\"completed\"");
  });
});
