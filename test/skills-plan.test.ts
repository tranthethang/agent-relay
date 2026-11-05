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
  expect(text).toContain("Read `strict.plan` from the policy at the run base.");
  expect(text).toContain(
    "When it is `false`, `plan done` and `plan amend` allow more than eight tasks and print a warning.",
  );
  expect(text).toContain("ask the user whether to keep the larger plan");
  expect(text).not.toContain("run-init");
  expect(text).not.toContain("plan.md");
  expect(assertNoShellSnippet(text)).toBeUndefined();
});

test("plan rules that are not obvious carry a Why line", () => {
  expect(text).toMatch(/Stop when the draft has more than one goal\.\nWhy: /);
  expect(text).toMatch(/Use at most eight tasks\.\nWhy: /);
  expect(text).toMatch(/`files` lists the repo paths that the task will edit\.\nWhy: /);
  expect(text).toMatch(/Do not invent a ref\.\nWhy: /);
  expect(text).toMatch(
    /Refuse `plan done` when an open card lacks a matching overview decision\.\nWhy: /,
  );
});

test("plan reads brainstorm notes and lifts decisions", () => {
  expect(text).toContain("read `notes.md` in that brainstorm directory");
  expect(text).toContain("read `open.json` in that brainstorm directory");
  expect(text).toContain("copy settled brainstorm choices into `## Decisions`");
  expect(text).toContain("resolve every `open.json` entry in overview prose before `plan done`");
  expect(text).toContain("Refuse `plan done` when an open card lacks a matching overview decision");
  expect(text).toContain("This skill does not add a CLI gate for those rules.");
});
