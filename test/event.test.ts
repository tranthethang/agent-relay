import { expect, test } from "vitest";
import { parseEventLine } from "../src/core/event.js";

const validEvent = {
  schema: 1,
  ts: "2026-10-17T04:26:00.000Z",
  stage: "implement",
  action: "started",
};

test("parseEventLine accepts optional event fields", () => {
  const event = parseEventLine({
    ...validEvent,
    tool: "cursor",
    model: "unknown",
    via: "arg",
    head: "abc",
    size: { files: 1, added: 2, deleted: 0 },
    task: "T1",
    session: "s1",
    reason: "done",
    ref: "brainstorms/20261017-agent-relay-v2",
  });
  expect(event.action).toBe("started");
  expect(event.size?.added).toBe(2);
});

test("parseEventLine preserves accepted extra paths and their warning reason", () => {
  const event = parseEventLine({
    ...validEvent,
    action: "task-done",
    task: "T1",
    extra: ["src/shared.ts"],
    reason: "scope warning: accepted outside task files under strict.scope=false",
  });
  expect(event.extra).toEqual(["src/shared.ts"]);
  expect(event.reason).toContain("strict.scope=false");
});

test("parseEventLine accepts SHA-1 and SHA-256 trees only", () => {
  expect(parseEventLine({ ...validEvent, tree: "a".repeat(40) }).tree).toHaveLength(40);
  expect(parseEventLine({ ...validEvent, tree: "b".repeat(64) }).tree).toHaveLength(64);
  expect(() => parseEventLine({ ...validEvent, tree: "c".repeat(41) })).toThrow();
});

test("parseEventLine rejects a non-UTC timestamp", () => {
  expect(() => parseEventLine({ ...validEvent, ts: "2026-10-17T04:26:00+07:00" })).toThrow();
});

test("parseEventLine rejects an unknown action", () => {
  expect(() => parseEventLine({ ...validEvent, action: "open" })).toThrow();
});

test("parseEventLine rejects an unknown tool", () => {
  expect(() => parseEventLine({ ...validEvent, tool: "claude" })).toThrow();
});

test("parseEventLine accepts cleaned action", () => {
  const event = parseEventLine({
    schema: 1,
    ts: "2026-10-17T04:26:00.000Z",
    stage: "run",
    action: "cleaned",
    actor: "agent-env",
  });
  expect(event.action).toBe("cleaned");
  expect(event.stage).toBe("run");
});
