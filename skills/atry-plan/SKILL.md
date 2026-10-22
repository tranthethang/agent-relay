---
name: atry-plan
description: Use when the user asks to plan work in this repo before implementing.
requires-atry: ">=0.10.7"
---

# Plan

Before you write plan prose, read `references/writing.md`.

## Overview

This stage creates one run and fills the plan stage folder. It does not implement.

## Preflight

<!-- BEGIN PREFLIGHT -->

Run `atry preflight --requires "<requires-atry>"` before any other command in this skill.
Stop when that command exits non-zero.
When `atry` reports an unknown command, tell the user to run `npm i -g @tranthethang/agent-relay@latest`.
When this skill names a run, call `atry context <run> --json` first.
When the context JSON has `run.worktree`, edit files and run git in `run.worktree.path`.

<!-- END PREFLIGHT -->

Use one of these tool names: `cursor`, `claude-code`, `cowork`, `codex`, `antigravity`, `kiro`, or `unknown`.

## Size

Count the goals and the tasks before you create a run.
Stop when the draft has more than one goal.
Read `strict.plan` from the policy at the run base.
When it is `true`, stop when the draft has more than eight tasks and ask the user to split the work or pick one plan.
When it is `false`, `plan done` and `plan amend` allow more than eight tasks and print a warning.
Show that warning and ask the user whether to keep the larger plan before you finalize it.
Continue only after the user chooses.

## Create

1. Run `atry run new --slug <slug> --title <title>`.
2. Add `--from <brainstorm>` when brainstorm notes already exist.
3. Run `atry stage start <run> plan --tool <tool>`.
4. Add `--model <model>` when you know the model.
5. Run `atry plan new <run>`.
6. Fill `10-plan/overview.md` with the edit tool.
7. Fill `10-plan/tasks.input.json` with the edit tool.
8. Run `atry plan done <run>`.
9. Fill each `10-plan/T<n>.md` file that `plan done` creates.
10. Do not run `atry stage done` for plan. `plan done` records the completed event.

Use a slug of lowercase letters and single hyphens.
`run new` records `base` from git HEAD. Do not invent a ref.
Stop when a command fails. Show the field path to the user.

## Overview file

Write Goal, Non-goals, Decisions, Constraints, and Flow under `10-plan/overview.md`.
Put settled choices under Decisions.
Put limits that apply only to this run under Constraints.
Add Flow only when the change alters a runtime flow.

## Tasks input

Keep `schema` as `1`.
Each task object has `title`, `deps`, and `files`.
`deps` lists earlier ids such as `T1`. Use `[]` when a task has no dependency.
`files` lists the repo paths that the task will edit.
Use at most eight tasks.

## Amend

Edit `tasks.input.json` when the user adds tasks after `plan done`.
Keep every existing title so the current ids stay.
Append only new tasks. Then run `atry plan amend <run>`.
Fill each new task file that `plan amend` creates.

## Approve and close

This skill does not approve or close.
A later skill runs `atry approve <run> --preview` or `atry close <run> --preview`.
That skill shows the preview and asks for one `y` or `n` answer.

## Non-goals

Do not implement. Do not start a review.
