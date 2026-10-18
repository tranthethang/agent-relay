import { expect, test } from "vitest";
import { assertNoShellSnippet, preflightBody, requiredVersion, skillText } from "./skill-text.js";

const selfReview = skillText("atry-self-review");
const crossReview = skillText("atry-cross-review");

test("self-review uses review new and review done", () => {
  expect(selfReview).toContain(`requires-atry: ">=${requiredVersion()}"`);
  expect(selfReview).toContain(preflightBody());
  expect(selfReview).toContain("atry review new <run> self --tool <tool>");
  expect(selfReview).toContain("atry review done <run> self");
  expect(selfReview).toContain("atry review decide <run> Q<n> <answer>");
  expect(selfReview).toContain("atry next <run> --json");
  expect(selfReview).toContain("atry close <run> --preview");
  expect(selfReview).toContain("configured `testCommand`");
  expect(selfReview).not.toContain("Set `fixed`, `tests`, and `open`");
  expect(selfReview).not.toContain("--ack-fixes");
  expect(selfReview).not.toContain("review upsert");
  expect(assertNoShellSnippet(selfReview)).toBeUndefined();
});

test("cross-review asks before close and gates the yes token", () => {
  expect(crossReview).toContain(`requires-atry: ">=${requiredVersion()}"`);
  expect(crossReview).toContain(preflightBody());
  expect(crossReview).toContain("atry review new <run> cross --tool <tool> --model <model>");
  expect(crossReview).toContain("atry review done <run> cross");
  expect(crossReview).toContain("atry review decide <run> Q<n> <answer>");
  expect(crossReview).toContain("atry next <run> --json");
  expect(crossReview).toContain("atry close <run> --preview");
  expect(crossReview).toContain("atry close <run> --via arg");
  expect(crossReview).toContain("atry close <run> --via confirm");
  expect(crossReview).toContain("recommend: y");
  expect(crossReview).not.toContain("--ack-open");
  expect(crossReview).not.toContain("Do not close yet");
  expect(crossReview).not.toContain("review upsert");
  expect(assertNoShellSnippet(crossReview)).toBeUndefined();
});
