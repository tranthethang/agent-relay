import { expect, test } from "vitest";
import { assertNoShellSnippet, preflightBody, requiredVersion, skillText } from "./skill-text.js";

const text = skillText("atry-plan");

test("plan uses run new, plan new, and plan done", () => {
  expect(text).toContain(`requires-atry: ">=${requiredVersion()}"`);
  expect(text).toContain(preflightBody());
  expect(text).toContain("atry run new --slug <slug> --title <title>");
  expect(text).toContain("atry plan new <run>");
  expect(text).toContain("atry plan done <run>");
  expect(text).toContain("atry plan amend <run>");
  expect(text).toContain("atry approve <run> --preview");
  expect(text).toContain("atry close <run> --preview");
  expect(text).toContain("tasks.input.json");
  expect(text).not.toContain("run-init");
  expect(text).not.toContain("plan.md");
  expect(assertNoShellSnippet(text)).toBeUndefined();
});
