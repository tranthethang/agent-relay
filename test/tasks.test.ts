import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { type RunState } from "../src/core/reduce.js";
import {
  indexForImplement,
  openPlanTasks,
  parsePlanIndex,
  parseTasksInput,
  readPlanIndex,
} from "../src/core/tasks.js";
import { withTempDir } from "./helper.js";

test("parseTasksInput accepts the empty scaffold", () => {
  expect(parseTasksInput({ schema: 1, tasks: [] }).tasks).toEqual([]);
});

test("parseTasksInput accepts deps and files", () => {
  const input = parseTasksInput({
    schema: 1,
    tasks: [{ title: "Add the schema", deps: [], files: ["src/core/run.ts"] }],
  });
  expect(input.tasks[0]?.title).toBe("Add the schema");
});

test("parseTasksInput rejects a task id before plan done assigns one", () => {
  expect(() =>
    parseTasksInput({
      schema: 1,
      tasks: [{ id: "T1", title: "Add the schema", deps: [], files: [] }],
    })
  ).toThrow();
});

test("parsePlanIndex requires id and path", () => {
  const index = parsePlanIndex({
    schema: 1,
    tasks: [{
      id: "T1",
      title: "Add the schema",
      deps: [],
      files: ["src/core/run.ts"],
      path: "10-plan/T1.md",
    }],
  });
  expect(index.tasks[0]?.path).toBe("10-plan/T1.md");
});

const emptyState: RunState = {
  lifecycle: "implementing",
  stage: "implement",
  approved: true,
  tasks: [],
};

test("openPlanTasks treats a missing state row as pending", () => {
  const index = parsePlanIndex({
    schema: 1,
    tasks: [
      {
        id: "T1",
        title: "Done",
        deps: [],
        files: [],
        path: "10-plan/T1.md",
      },
      {
        id: "T2",
        title: "Open",
        deps: ["T1"],
        files: [],
        path: "10-plan/T2.md",
      },
    ],
  });
  const state: RunState = {
    ...emptyState,
    tasks: [{ id: "T1", status: "done" }],
  };
  expect(openPlanTasks(index, state)).toEqual(["T2"]);
  expect(openPlanTasks({ schema: 1, tasks: [] }, emptyState)).toEqual([]);
  expect(openPlanTasks(null, state)).toEqual([]);
  expect(openPlanTasks(null, {
    ...emptyState,
    tasks: [{ id: "T1", status: "in-progress" }],
  })).toEqual(["T1"]);
});

test("readPlanIndex reports a missing file, invalid JSON, and an invalid schema", async () => {
  await withTempDir(async (dir) => {
    const run = join(dir, "run");
    await mkdir(join(run, "10-plan"), { recursive: true });
    expect(await readPlanIndex(run)).toBeNull();
    await expect(indexForImplement(run, emptyState)).rejects.toMatchObject({
      fieldPath: "10-plan/index.json",
      message: "index.json not found",
    });
    await writeFile(join(run, "10-plan", "index.json"), "{", "utf8");
    await expect(readPlanIndex(run)).rejects.toMatchObject({
      fieldPath: "10-plan/index.json",
      message: "invalid JSON",
    });
    await writeFile(
      join(run, "10-plan", "index.json"),
      `${JSON.stringify({ schema: 1, tasks: [{ id: "T1" }] })}\n`,
    );
    await expect(readPlanIndex(run)).rejects.toMatchObject({
      fieldPath: expect.stringContaining("10-plan/index.json"),
    });
    await writeFile(
      join(run, "10-plan", "index.json"),
      `${JSON.stringify({ schema: 1, tasks: [] })}\n`,
    );
    expect(await indexForImplement(run, emptyState)).toEqual({ schema: 1, tasks: [] });
  });
});

test("parsePlanIndex rejects a forward-looking dep shape that is not an id", () => {
  expect(() =>
    parsePlanIndex({
      schema: 1,
      tasks: [{
        id: "T2",
        title: "Next",
        deps: ["Add the schema"],
        files: [],
        path: "10-plan/T2.md",
      }],
    })
  ).toThrow();
});
