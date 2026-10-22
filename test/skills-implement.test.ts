import { expect, test } from "vitest";
import { assertNoShellSnippet, preflightBody, requiredVersion, skillText } from "./skill-text.js";

const text = skillText("atry-implement");

test("implement asks before approve and uses task verbs", () => {
  expect(text).toContain(`requires-atry: ">=${requiredVersion()}"`);
  expect(text).toContain(preflightBody());
  expect(text).toContain("atry next <run> --json");
  expect(text).toContain("Read `state`, `actions`, and `recommendation` from the result.");
  expect(text).toContain("follow the developer's selection");
  expect(text).toContain("atry approve <run> --preview");
  expect(text).toContain("atry approve <run> --via arg");
  expect(text).toContain("atry approve <run> --via confirm");
  expect(text).toContain("yes");
  expect(text).toContain("atry task start <run> <task>");
  expect(text).toContain("atry task done <run> <task>");
  expect(text).toContain("When `task done` refuses, read the paths in the message.");
  expect(text).toContain(
    "When `strict.scope` is true, ask the user before you pass `--allow-extra <reason>`.",
  );
  expect(text).toContain("continue after the warning");
  expect(text).toContain("Put that reason in the task report.");
  expect(text).toContain("atry task skip <run> <task> --reason <text>");
  expect(text).toContain("atry claim <run> <task> --session <tag>");
  expect(text).toContain("atry stage start <run> implement --tool <tool>");
  expect(text).toContain("atry stage done <run> implement --tool <tool>");
  expect(text).not.toContain("history append");
  expect(text).not.toContain("implement-plan.md");
  expect(assertNoShellSnippet(text)).toBeUndefined();
});

test("implement dispatches on kind and not on command text", () => {
  expect(text).toContain("Dispatch on `kind` and `args`.");
  expect(text).toContain("When `kind` is `approve`");
  expect(text).toContain("When `kind` is `stage-start`");
  expect(text).toContain("When `kind` is `stage-done`");
  expect(text).toContain("When `kind` is `task-start`");
  expect(text).not.toMatch(/selected action (is|contains|names)/);
});
