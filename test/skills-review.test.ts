import { expect, test } from "vitest";
import { assertNoShellSnippet, preflightBody, requiredVersion, skillText } from "./skill-text.js";

const selfReview = skillText("atry-self-review");
const crossReview = skillText("atry-cross-review");

test("self-review uses review new and review done", () => {
  expect(selfReview).toContain(`requires-atry: ">=${requiredVersion()}"`);
  expect(selfReview).toContain(preflightBody());
  expect(selfReview).toContain("atry review new <run> self --tool <tool>");
  expect(selfReview).toContain("atry review done <run> self");
  expect(selfReview).not.toContain("atry close");
  expect(selfReview).not.toContain("review upsert");
  expect(assertNoShellSnippet(selfReview)).toBeUndefined();
});

test("cross-review asks before close and gates the yes token", () => {
  expect(crossReview).toContain(`requires-atry: ">=${requiredVersion()}"`);
  expect(crossReview).toContain(preflightBody());
  expect(crossReview).toContain("atry review new <run> cross --tool <tool>");
  expect(crossReview).toContain("atry review done <run> cross");
  expect(crossReview).toContain("atry close <run> --via arg");
  expect(crossReview).toContain("atry close <run> --via confirm");
  expect(crossReview).toContain("atry close <run> --via confirm --ack-open");
  expect(crossReview).toContain("Recommend `n` when `open` is not empty");
  expect(crossReview).toContain("Recommend `n` when `tests` is `fail`");
  expect(crossReview).toContain("Do not close yet");
  expect(crossReview).not.toContain("review upsert");
  expect(assertNoShellSnippet(crossReview)).toBeUndefined();
});
