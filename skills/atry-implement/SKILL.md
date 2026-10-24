---
name: atry-implement
description: "Carry out an approved agent-relay plan with atry. Use this when the user asks to implement a run, to build the planned tasks, or to code from that plan. Do not use it to invent a new plan, to review the result, or to close the run."
requires-atry: ">=0.10.7"
---

# Implement

Before you write a task report, read `references/writing.md`.

## Overview

This stage implements an existing plan, one task at a time. It does not plan again.

## Preflight

<!-- BEGIN PREFLIGHT -->

Run `atry preflight --requires "<requires-atry>"` before any other command in this skill.
Stop when that command exits non-zero. A dev build needs `--allow-dev` or `ATRY_DEV=1`; do not use a dev build for a real run.
When `atry` reports an unknown command, tell the user to run `npm i -g @tranthethang/agent-relay@latest`.
When this skill names a run, call `atry context <run> --json` first.
Read `references/file-conventions.md` before you edit a run file.
When the context JSON has `run.worktree`, edit files and run git in `run.worktree.path`.
A claim result with `worktree.path` takes precedence over `run.worktree.path`.

<!-- END PREFLIGHT -->

Use one of these tool names: `cursor`, `claude-code`, `cowork`, `codex`, `antigravity`, `kiro`, or `unknown`.

## Loop

This skill handles `approve`, `stage-start`, `task-start`, `integrate`, and `stage-done`. For `task-start`, follow One task.

<!-- BEGIN LOOP -->

1. Run `atry next <run> --json`.
2. Stop when `actions` is empty, or when the `kind` of the recommended action is not one this skill handles.
3. Replace `<tool>` and `<model>` in its `command`. Change no other token.
4. When `needsHuman` is false, run the command. Then go to step 1.
5. When `needsHuman` is true and the command ends in `--preview`, run it with `--json` and read `decision`.
6. Show `decision.question`, or the action `question` when the command has no preview. Ask the developer to answer `y` or `n`. A `yes` token in the skill call counts as `y`.
7. On `y`, run `decision.onYes`. Run `decision.onYesArg` for a `yes` token. Run the action `command` when it has no preview. Stop when the field is `null`. Then go to step 1.
8. On `n`, stop and record no event.

<!-- END LOOP -->

## Stage commands

When `integrate` prints `worktree: kept`, stop and show the reason.
When `stage done` refuses, read the paths in the message.
When `strict.scope` is true, ask the user before you pass `--allow-extra <reason>`.
When `strict.scope` is false, continue after the warning and check that the
accepted paths appear in the task completion event.
Add `--model <model>` to a `stage` command when you know the model.

## One task

1. Run `atry list <run>`.
2. Pick one pending task. Skip a task that shows `blocked:`.
3. When several sessions share the run, run `atry claim <run> <task> --session <tag>`.
4. When the claim fails, pick a different task or stop.
5. When you work alone, run `atry task start <run> <task>`.
6. Change only the files listed for that task. Edit them in the claim result's
   `worktree.path` when it has one. Use `run.worktree.path` only when no task
   worktree exists.
7. Fill `20-implement/<task>.md` with the edit tool. Read `references/example-implement.md` first.
8. Record the files, the assumptions, and the risks in that file.
9. Run `git status` in the tree you edited. Commit there before `atry task done`.
10. Run `atry task done <run> <task>`. Add `--session <tag>` when you hold a claim.
11. When `task done` refuses, read the paths in the message. A refused run names
    the dirty worktree; commit there and retry.
12. When `strict.scope` is true, ask the user before you pass `--allow-extra <reason>`.
    When it is false, continue after the warning and check the recorded extras.
13. Put that reason in the task report.
14. When a task is not feasible, run `atry task skip <run> <task> --reason <text>`.
15. Add `--session <tag>` to `task skip` when you hold a claim.
16. Run `atry release <run> <task> --session <tag>` only when you stop without done or skip.

`task done` and `task skip` drop the claim lock. Do not call `release` after them.
`atry task start` does not create a task worktree. Use `atry claim` when the run
uses a task worktree. A task worktree must be committed before `atry task done`.
Do not invent a meaning the plan does not state. Skip that task and record the reason.
A stale lock can move with `atry steal <run> <task> --session <tag> --ttl <minutes>`.

## Rules

Do not edit files outside the plan.
Do not hand-edit `events.jsonl` or `run.json`.
Do not run `atry close`.
