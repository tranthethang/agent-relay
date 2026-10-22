---
name: atry-implement
description: Use when the user asks to implement, build, or code from an existing agent-relay plan.
requires-atry: ">=0.10.7"
---

# Implement

Before you write a task report, read `references/writing.md`.

## Overview

This stage implements an existing plan, one task at a time. It does not plan again.

## Preflight

<!-- BEGIN PREFLIGHT -->

Run `atry preflight --requires "<requires-atry>"` before any other command in this skill.
Stop when that command exits non-zero.
When `atry` reports an unknown command, tell the user to run `npm i -g @tranthethang/agent-relay@latest`.
When this skill names a run, call `atry context <run> --json` first.
When the context JSON has `run.worktree`, edit files and run git in `run.worktree.path`.

<!-- END PREFLIGHT -->

Use one of these tool names: `cursor`, `claude-code`, `cowork`, `codex`, `antigravity`, `kiro`, or `unknown`.

## Loop

Run `atry next <run> --json`.
Read `state`, `actions`, and `recommendation` from the result.
Follow the recommendation when only one action is available.
When several actions are available, show them and ask the developer to select one.
Then follow the developer's selection.
Read the selected action's paths before you run its command.
Stop when the state is closed or abandoned and no action is available.
When the selected action is approve, run `atry approve <run> --preview`.
Show that preview and ask the user to answer `y` or `n`.
When the skill call includes a `yes` token, use that token as `y`.
When the user answers `n`, stop and do not record an event.
When the user answers `y` for approve, run `atry approve <run> --via confirm`.
When the `yes` token is that answer, run `atry approve <run> --via arg`.
When the selected action contains `review` or `close`, stop. A review skill closes the run and asks the user before a soft close passes `--ack-warnings`.
When the selected action is stage start, run `atry stage start <run> implement --tool <tool>`.
When the selected action is stage done, run `atry stage done <run> implement --tool <tool>`.
When `stage done` refuses, read the paths in the message.
When `strict.scope` is true, ask the user before you pass `--allow-extra <reason>`.
When `strict.scope` is false, continue after the warning and check that the
accepted paths appear in the task completion event.
Add `--model <model>` when you know the model.
When the selected action is a task command, follow One task.
Repeat from the first step in this section.

## One task

1. Run `atry list <run>`.
2. Pick one pending task. Skip a task that shows `blocked:`.
3. When several sessions share the run, run `atry claim <run> <task> --session <tag>`.
4. When the claim fails, pick a different task or stop.
5. When you work alone, run `atry task start <run> <task>`.
6. Change only the files listed for that task. When `run.worktree` exists, change them in `run.worktree.path`.
7. Fill `20-implement/<task>.md` with the edit tool.
8. Record the files, the assumptions, and the risks in that file.
9. Run `atry task done <run> <task>`. Add `--session <tag>` when you hold a claim.
10. When `task done` refuses, read the paths in the message.
11. When `strict.scope` is true, ask the user before you pass `--allow-extra <reason>`.
    When it is false, continue after the warning and check the recorded extras.
12. Put that reason in the task report.
13. When a task is not feasible, run `atry task skip <run> <task> --reason <text>`.
14. Add `--session <tag>` to `task skip` when you hold a claim.
15. Run `atry release <run> <task> --session <tag>` only when you stop without done or skip.

`task done` and `task skip` drop the claim lock. Do not call `release` after them.
Do not invent a meaning the plan does not state. Skip that task and record the reason.
A stale lock can move with `atry steal <run> <task> --session <tag> --ttl <minutes>`.

## Rules

Do not edit files outside the plan.
Do not hand-edit `events.jsonl` or `run.json`.
Do not run `atry close`.
