import { expect, test } from "vitest";
import { type EventLine } from "../src/core/event.js";
import { formatAge, nextStep } from "../src/core/next.js";
import { reduceEvents } from "../src/core/reduce.js";

const start = Date.parse("2026-10-17T00:00:00.000Z");

function ev(stage: EventLine["stage"], action: EventLine["action"]): EventLine {
  return { schema: 1, ts: "2026-10-17T00:00:00.000Z", stage, action };
}

test("formatAge uses minutes, hours, then days", () => {
  expect(formatAge(start, start + 5 * 60000)).toBe("5m");
  expect(formatAge(start, start + 2 * 3600000)).toBe("2h");
  expect(formatAge(start, start + 3 * 86400000)).toBe("3d");
  expect(formatAge(start, start - 1000)).toBe("0m");
});

test("nextStep names the following verb", () => {
  const approved = [ev("plan", "approved")];
  expect(nextStep("1792208725", reduceEvents(approved), approved)).toBe(
    "atry stage start 1792208725 implement",
  );
  const open = [ev("implement", "started"), { ...ev("implement", "task-started"), task: "T1" }];
  expect(nextStep("1792208725", reduceEvents(open), open)).toBe("atry task start 1792208725");
  const reviewing = [ev("implement", "completed"), ev("self-review", "completed")];
  expect(nextStep("1792208725", reduceEvents(reviewing), reviewing)).toBe(
    "atry review new 1792208725 cross",
  );
  const closed = [ev("run", "closed")];
  expect(nextStep("1792208725", reduceEvents(closed), closed)).toBe("none");
});
