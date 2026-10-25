import { expect, test } from "vitest";
import { assertNoShellSnippet, preflightBody, requiredVersion, skillText } from "./skill-text.js";

const text = skillText("atry-implement");

test("implement asks before approve and uses task verbs", () => {
  expect(text).toContain(`requires-atry: ">=${requiredVersion()}"`);
  expect(text).toContain(preflightBody());
  expect(text).toContain("atry next <run> --json");
  expect(text).toContain("`decision.onYes`");
  expect(text).toContain("`decision.onYesArg` for a `yes` token");
  expect(text).not.toContain("atry approve <run> --via");
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
  expect(text).toContain("Add `--model <model>` to a `stage` command when you know the model.");
  expect(text).not.toContain("history append");
  expect(text).not.toContain("implement-plan.md");
  expect(assertNoShellSnippet(text)).toBeUndefined();
});

test("implement edits and commits in the claim worktree", () => {
  expect(text).toContain("Read `references/file-conventions.md` before you edit a run file.");
  expect(text).toContain("Edit them in the claim result's");
  expect(text).toContain("`worktree.path` when it has one.");
  expect(text).toContain("Use `run.worktree.path` only when no task");
  expect(text).toContain("Commit there before `atry task done`.");
  expect(text).toContain("A refused run names");
  expect(text).toContain("`atry task start` does not create a task worktree.");
  expect(text).toContain("A task worktree must be committed before `atry task done`.");
});

test("implement lists its kinds and runs the synced loop", () => {
  expect(text).toContain(
    "This skill handles `approve`, `stage-start`, `task-start`, `integrate`, and `stage-done`.",
  );
  expect(text).toContain("For `task-start`, follow One task.");
  expect(text).toContain("<!-- BEGIN LOOP -->");
  expect(text).toContain("Replace `<tool>` and `<model>` in its `command`.");
  expect(text).not.toContain("Do not match the `command` text.");
  expect(text).not.toContain("--ack-warnings");
  expect(text).not.toContain("--ack-open");
  expect(loopSection(text)).toBeLessThanOrEqual(3);
});

function loopSection(skill: string): number {
  const start = skill.indexOf("## Loop\n") + "## Loop\n".length;
  const block = skill.indexOf("<!-- BEGIN LOOP -->");
  return skill.slice(start, block).split("\n").filter((line) => line.trim() !== "").length;
}

test("implement rules that are not obvious carry a Why line", () => {
  expect(text).toMatch(/worktree exists\.\n {3}Why: An edit outside `files`/);
  expect(text).toMatch(/Commit there before `atry task done`\.\n {3}Why: /);
  expect(text).toMatch(/Skip that task and record the reason\.\nWhy: /);
  expect(text).toMatch(/Do not hand-edit `events\.jsonl` or `run\.json`\.\nWhy: /);
});
