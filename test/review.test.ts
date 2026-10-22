import { expect, test } from "vitest";
import { parseReviewJson } from "../src/core/review.js";

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

test("parseReviewJson reads the removed tests key", () => {
  const review = parseReviewJson({ ...validReview, tests: "pass" });
  expect(review.kind).toBe("self");
  expect(review.open).toEqual([]);
});

test("parseReviewJson rejects an unknown key other than tests", () => {
  expect(() => parseReviewJson({ ...validReview, nope: true })).toThrow();
});
