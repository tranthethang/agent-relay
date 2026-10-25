import { expect, test } from "vitest";
import { type EventLine } from "../src/core/event.js";
import {
  crossDeltaNeedsSelfReview,
  parseReviewJson,
  reviewJsonSchema,
  reviewScaffold,
} from "../src/core/review.js";

const validReview = {
  schema: 1,
  kind: "self",
  tool: "cursor",
  model: "unknown",
  findings: [],
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

const finding = {
  id: "F1",
  severity: "high",
  file: "src/a.ts",
  line: 3,
  status: "open",
  evidence: "x is null",
};

test("parseReviewJson parses a legacy fixed count as no findings", () => {
  const { findings: _findings, ...legacy } = { ...validReview, fixed: 2 };
  const review = parseReviewJson(legacy);
  expect(review.findings).toEqual([]);
  expect(review).not.toHaveProperty("fixed");
});

test("parseReviewJson rejects fixed together with findings", () => {
  const result = reviewJsonSchema.safeParse({ ...validReview, fixed: 1, findings: [] });
  expect(result.success).toBe(false);
  expect(result.error?.issues[0]?.path).toEqual(["fixed"]);
});

test("parseReviewJson rejects a negative legacy fixed count", () => {
  const { findings: _findings, ...legacy } = validReview;
  expect(() => parseReviewJson({ ...legacy, fixed: -1 })).toThrow();
});

test("parseReviewJson accepts a finding with null file and line", () => {
  const review = parseReviewJson({
    ...validReview,
    findings: [{ ...finding, file: null, line: null }],
  });
  expect(review.findings).toHaveLength(1);
});

test("parseReviewJson rejects a duplicate finding id with a field path", () => {
  const result = reviewJsonSchema.safeParse({ ...validReview, findings: [finding, finding] });
  expect(result.success).toBe(false);
  expect(result.error?.issues[0]?.path).toEqual(["findings", 1, "id"]);
});

test.each([
  { id: "f1" },
  { id: "F0" },
  { severity: "critical" },
  { status: "closed" },
  { line: 0 },
  { file: "" },
  { evidence: "" },
  { extra: true },
])("parseReviewJson rejects a bad finding %j", (patch) => {
  expect(() => parseReviewJson({ ...validReview, findings: [{ ...finding, ...patch }] })).toThrow();
});

test("reviewScaffold writes findings and no fixed key", () => {
  const scaffold = reviewScaffold("self", "cursor", "unknown");
  expect(scaffold.findings).toEqual([]);
  expect(scaffold).not.toHaveProperty("fixed");
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
