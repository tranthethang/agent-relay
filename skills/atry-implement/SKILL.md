---
name: atry-implement
description: Use when the user asks to implement, build, or code from an existing agent-relay plan.
requires-atry: ">=26.10.17"
---

# Implement

Before you write a task report, read `references/writing.md`.

## Overview

This stage implements an existing plan, one task at a time. It does not plan again.

## Preflight

<!-- BEGIN PREFLIGHT -->

This skill needs `requires-atry` in its front matter.
Run `atry version --json` before any other command in this skill.
Read the `version` string from that JSON.
Split both versions on `.` and compare the numbers from the left.
Find the first pair of numbers that differ. Ignore the numbers after that pair.
Stop when the required number in that pair is higher than the installed number.
Tell the user to run `npm i -g @tranthethang/agent-relay@latest`.
Do not search the filesystem for helpers.
Do not run files under `scripts/` or `~/.agent-relay/lib/`.
When this skill names a run, call `atry context <run> --json` first.

<!-- END PREFLIGHT -->

Use one of these tool names: `cursor`, `claude-code`, `cowork`, `codex`, `antigravity`, `kiro`, or `unknown`.

## Approve

Read `approved` from the context JSON.
When `approved` is true, skip this section.
When the skill call includes a `yes` token, run `atry approve <run> --via arg`.
Otherwise read Goal, Decisions, and the task count.
Goal and Decisions are in `10-plan/overview.md`. The task count is `tasks` in the context JSON.
Show those three items. Then ask the user to answer `y` or `n`.
When the user answers `y`, run `atry approve <run> --via confirm`.
When the user answers `n`, stop. Do not record an event.

## Start

Run `atry stage start <run> implement --tool <tool>`.
Add `--model <model>` when you know the model.

## One task

1. Run `atry list <run>`.
2. Pick one pending task. Skip a task that shows `blocked:`.
3. When several sessions share the run, run `atry claim <run> <task> --session <tag>`.
4. When the claim fails, pick a different task or stop.
5. When you work alone, run `atry task start <run> <task>`.
6. Change only the files listed for that task.
7. Fill `20-implement/<task>.md` with the edit tool.
8. Record the files, the assumptions, and the risks in that file.
9. Run `atry task done <run> <task>`. Add `--session <tag>` when you hold a claim.
10. When a task is not feasible, run `atry task skip <run> <task> --reason <text>`.
11. Add `--session <tag>` to `task skip` when you hold a claim.
12. Run `atry release <run> <task> --session <tag>` only when you stop without done or skip.

`task done` and `task skip` drop the claim lock. Do not call `release` after them.
Do not invent a meaning the plan does not state. Skip that task and record the reason.
A stale lock can move with `atry steal <run> <task> --session <tag> --ttl <minutes>`.

## Finish

Run `atry list <run>` after each task.
When every task is done or skipped, run `atry stage done <run> implement --tool <tool>`.

## Rules

Do not edit files outside the plan.
Do not hand-edit `events.jsonl` or `run.json`.
Do not run `atry close`.
