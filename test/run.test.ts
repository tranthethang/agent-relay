import { expect, test } from "vitest";
import { parseRunJson } from "../src/core/run.js";

const validRun = {
  schema: 1,
  id: "1792208724",
  ymd: "20261017",
  slug: "next-core-schemas",
  title: "v2 P2",
  base: "6e9b585ad847ff268cef3da093e065af3db14450",
  state: {
    lifecycle: "planned",
    stage: "plan",
    approved: false,
    tasks: [],
  },
};

test("parseRunJson accepts a run cache", () => {
  const run = parseRunJson({
    ...validRun,
    from: "brainstorms/20261017-agent-relay-v2",
    state: {
      ...validRun.state,
      tasks: [{ id: "T1", status: "done" }, { id: "T2", status: "skipped", reason: "unclear" }],
    },
  });
  expect(run.slug).toBe("next-core-schemas");
  expect(run.state.tasks[1]?.reason).toBe("unclear");
});

test("parseRunJson rejects an unknown key", () => {
  expect(() => parseRunJson({ ...validRun, extra: true })).toThrow();
});

test("parseRunJson rejects a bad lifecycle", () => {
  expect(() =>
    parseRunJson({
      ...validRun,
      state: { ...validRun.state, lifecycle: "active" },
    })
  ).toThrow();
});
