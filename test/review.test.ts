import { expect, test } from "vitest";
import { type EventLine } from "../src/core/event.js";
import { crossDeltaNeedsSelfReview, parseReviewJson } from "../src/core/review.js";

const validReview = {
  schema: 1,
  kind: "self",
  tool: "cursor",
  model: "unknown",
  fixed: 0,
  open: [],
};

test("parseReviewJson accepts both open-item shapes", () => {
  const review = parseReviewJson({
    ...validReview,
    kind: "cross",
    open: [
      { q: "Which exit code?", a: "Keep 3", b: "Split the codes" },
      { q: "Which timestamp?", need: "A sample events.jsonl line" },
    ],
  });
  expect(review.open).toHaveLength(2);
});

test("parseReviewJson rejects a mixed open item", () => {
  expect(() =>
    parseReviewJson({
      ...validReview,
      open: [{ q: "Which exit code?", a: "Keep 3", b: "Split the codes", need: "more" }],
    })
  ).toThrow();
});

test("parseReviewJson rejects a negative fixed count", () => {
  expect(() => parseReviewJson({ ...validReview, fixed: -1 })).toThrow();
});

test("crossDeltaNeedsSelfReview wants a self-review after cross-review changes", () => {
  const event = (
    stage: EventLine["stage"],
    action: EventLine["action"],
    delta?: { files: number; added: number; deleted: number },
  ): EventLine => ({
    schema: 1,
    ts: "2026-10-17T00:00:00.000Z",
    stage,
    action,
    ...(delta === undefined ? {} : { delta }),
  });
  const delta = { files: 1, added: 2, deleted: 0 };
  expect(crossDeltaNeedsSelfReview([])).toBe(false);
  expect(crossDeltaNeedsSelfReview([event("cross-review", "completed")])).toBe(false);
  expect(crossDeltaNeedsSelfReview([
    event("self-review", "completed"),
    event("cross-review", "completed", delta),
  ])).toBe(true);
  expect(crossDeltaNeedsSelfReview([
    event("self-review", "completed"),
    event("cross-review", "completed", delta),
    event("self-review", "completed"),
  ])).toBe(false);
  // A start alone does not cover the change.
  expect(crossDeltaNeedsSelfReview([
    event("cross-review", "completed", delta),
    event("self-review", "started"),
  ])).toBe(true);
});

test("parseReviewJson reads the removed tests key", () => {
  const review = parseReviewJson({ ...validReview, tests: "pass" });
  expect(review.kind).toBe("self");
  expect(review.open).toEqual([]);
});

test("parseReviewJson rejects an unknown key other than tests", () => {
  expect(() => parseReviewJson({ ...validReview, nope: true })).toThrow();
});
