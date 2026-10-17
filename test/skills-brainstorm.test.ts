import { expect, test } from "vitest";
import { assertNoShellSnippet, preflightBody, requiredVersion, skillText } from "./skill-text.js";

const text = skillText("atry-brainstorm");

test("brainstorm stays read-only until the user allows notes", () => {
  expect(text).toContain(`requires-atry: ">=${requiredVersion()}"`);
  expect(text).toContain(preflightBody());
  expect(text).toContain("atry brainstorm new --slug <slug>");
  expect(text).toContain("atry brainstorm done <dir>");
  expect(text).toContain("stays read-only");
  expect(text).not.toContain("atry run new");
  expect(assertNoShellSnippet(text)).toBeUndefined();
});
