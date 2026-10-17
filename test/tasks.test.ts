import { expect, test } from "vitest";
import { parsePlanIndex, parseTasksInput } from "../src/core/tasks.js";

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
