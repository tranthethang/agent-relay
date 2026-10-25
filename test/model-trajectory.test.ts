import { expect, test } from "vitest";
import { matchTrajectory, parseEvents } from "../evals/model/trajectory.js";

const ev = (stage: string, action: string) => ({ stage, action });
const req = [ev("plan", "started"), ev("plan", "completed")];

test("an exact match passes", () => {
  const r = matchTrajectory(req, { required: req, forbidden: [] });
  expect(r).toEqual({ pass: true, matched: 2, required: 2, firstMissing: null, forbiddenHits: [] });
});

test("extra events between required pairs are allowed", () => {
  const events = [
    ev("run", "created"),
    ev("plan", "started"),
    ev("task", "x"),
    ev("plan", "completed"),
  ];
  expect(matchTrajectory(events, { required: req, forbidden: [] }).pass).toBe(true);
});

test("an out-of-order miss reports the first missing pair and a partial score", () => {
  const r = matchTrajectory([ev("plan", "completed"), ev("plan", "started")], {
    required: req,
    forbidden: [],
  });
  expect(r.pass).toBe(false);
  expect(r.matched).toBe(1);
  expect(r.matched / r.required).toBe(0.5);
  expect(r.firstMissing).toEqual(ev("plan", "completed"));
});

test("a forbidden pair fails the scenario", () => {
  const r = matchTrajectory([...req, ev("plan", "approved")], {
    required: req,
    forbidden: [ev("plan", "approved")],
  });
  expect(r.pass).toBe(false);
  expect(r.matched).toBe(2);
  expect(r.forbiddenHits).toEqual([ev("plan", "approved")]);
});

test("a * stage matches any stage", () => {
  const events = [ev("review", "closed")];
  expect(matchTrajectory(events, { required: [ev("*", "closed")], forbidden: [] }).pass).toBe(true);
  expect(matchTrajectory(events, { required: [], forbidden: [ev("*", "closed")] }).pass).toBe(
    false,
  );
});

test("an empty event list misses every required pair", () => {
  const r = matchTrajectory([], { required: req, forbidden: [] });
  expect(r).toMatchObject({ pass: false, matched: 0, firstMissing: req[0] });
  expect(matchTrajectory([], { required: [], forbidden: [] }).pass).toBe(true);
});

test("parseEvents reads stage and action, skips empty lines, and defaults missing fields", () => {
  const text =
    "{\"stage\":\"run\",\"action\":\"created\",\"ts\":\"t\"}\n\n{\"stage\":\"plan\"}\nnull\n";
  expect(parseEvents(text)).toEqual([ev("run", "created"), ev("plan", ""), ev("", "")]);
});

test("parseEvents throws on a non-JSON line", () => {
  expect(() => parseEvents("{\"stage\":\"run\",\"action\":\"created\"}\nnope")).toThrow(/line 2/);
});
