import { expect, test } from "vitest";
import { parseReviewJson } from "../src/core/review.js";

const validReview = {
  schema: 1,
  kind: "self",
  tool: "cursor",
  model: "unknown",
  fixed: 0,
  tests: "pass",
  open: [],
};

test("parseReviewJson accepts both open-item shapes", () => {
  const review = parseReviewJson({
    ...validReview,
    kind: "cross",
    tests: "not-run",
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
