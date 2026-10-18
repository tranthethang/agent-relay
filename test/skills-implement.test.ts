import { expect, test } from "vitest";
import { assertNoShellSnippet, preflightBody, requiredVersion, skillText } from "./skill-text.js";

const text = skillText("atry-implement");

test("implement asks before approve and uses task verbs", () => {
  expect(text).toContain(`requires-atry: ">=${requiredVersion()}"`);
  expect(text).toContain(preflightBody());
  expect(text).toContain("atry approve <run> --via arg");
  expect(text).toContain("atry approve <run> --via confirm");
  expect(text).toContain("yes");
  expect(text).toContain("atry task start <run> <task>");
  expect(text).toContain("atry task done <run> <task>");
  expect(text).toContain("When `task done` refuses, read the paths in the message.");
  expect(text).toContain("Ask the user before you pass `--allow-extra <reason>`.");
  expect(text).toContain("Put that reason in the task report.");
  expect(text).toContain("atry task skip <run> <task> --reason <text>");
  expect(text).toContain("atry claim <run> <task> --session <tag>");
  expect(text).toContain("atry stage start <run> implement --tool <tool>");
  expect(text).toContain("atry stage done <run> implement --tool <tool>");
  expect(text).not.toContain("history append");
  expect(text).not.toContain("implement-plan.md");
  expect(assertNoShellSnippet(text)).toBeUndefined();
});
