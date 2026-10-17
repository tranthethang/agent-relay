import { expect, test } from "vitest";
import { type EventLine, parseEventLine } from "../src/core/event.js";
import { reduceEvents } from "../src/core/reduce.js";

function ev(
  partial: Omit<Partial<EventLine>, "schema" | "ts"> & Pick<EventLine, "stage" | "action">,
): EventLine {
  return parseEventLine({
    schema: 1,
    ts: "2026-10-17T00:00:00.000Z",
    ...partial,
  });
}

test("reduceEvents starts at planned", () => {
  expect(reduceEvents([])).toEqual({
    lifecycle: "planned",
    stage: "plan",
    approved: false,
    tasks: [],
  });
});

test("reduceEvents maps run created to the plan stage", () => {
  const state = reduceEvents([ev({ stage: "run", action: "created" })]);
  expect(state.lifecycle).toBe("planned");
  expect(state.stage).toBe("plan");
  expect(state.approved).toBe(false);
});

test("reduceEvents follows approve, implement, review, and close", () => {
  const state = reduceEvents([
    ev({ stage: "run", action: "created" }),
    ev({ stage: "plan", action: "approved" }),
    ev({ stage: "implement", action: "started" }),
    ev({ stage: "implement", action: "completed" }),
    ev({ stage: "self-review", action: "started" }),
    ev({ stage: "self-review", action: "completed" }),
    ev({ stage: "run", action: "closed" }),
  ]);
  expect(state.lifecycle).toBe("closed");
  expect(state.stage).toBe("self-review");
  expect(state.approved).toBe(true);
});

test("reduceEvents records implement done as reviewing", () => {
  const state = reduceEvents([
    ev({ stage: "plan", action: "approved" }),
    ev({ stage: "implement", action: "started" }),
    ev({ stage: "implement", action: "completed" }),
  ]);
  expect(state.lifecycle).toBe("reviewing");
  expect(state.stage).toBe("implement");
});

test("reduceEvents keeps a later stage after close", () => {
  const state = reduceEvents([
    ev({ stage: "implement", action: "started" }),
    ev({ stage: "run", action: "closed" }),
    ev({ stage: "distill", action: "started" }),
  ]);
  expect(state.lifecycle).toBe("closed");
  expect(state.stage).toBe("implement");
});

test("reduceEvents sets abandoned and keeps it", () => {
  const state = reduceEvents([
    ev({ stage: "plan", action: "approved" }),
    ev({ stage: "run", action: "abandoned", reason: "stop" }),
    ev({ stage: "implement", action: "started" }),
  ]);
  expect(state.lifecycle).toBe("abandoned");
  expect(state.approved).toBe(true);
  expect(state.stage).toBe("plan");
});

test("reduceEvents folds task status in first-seen order", () => {
  const state = reduceEvents([
    ev({ stage: "implement", action: "task-started", task: "T1" }),
    ev({ stage: "implement", action: "task-skipped", task: "T2", reason: "unclear" }),
    ev({ stage: "implement", action: "task-done", task: "T1" }),
    ev({ stage: "implement", action: "claimed", task: "T3", session: "a" }),
    ev({ stage: "implement", action: "stolen", task: "T3", session: "b" }),
    ev({ stage: "implement", action: "released", task: "T3" }),
  ]);
  expect(state.tasks).toEqual([
    { id: "T1", status: "done" },
    { id: "T2", status: "skipped", reason: "unclear" },
    { id: "T3", status: "in-progress" },
  ]);
});

test("reduceEvents ignores a task action that has no task id", () => {
  const state = reduceEvents([ev({ stage: "implement", action: "task-done" })]);
  expect(state.tasks).toEqual([]);
});
