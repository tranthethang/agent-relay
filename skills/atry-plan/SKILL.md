---
name: atry-plan
description: Use when the user asks to plan work in this repo before implementing.
requires-atry: ">=0.1.0"
---

# Plan

Before you write plan prose, read `references/writing.md`.

## Overview

This stage creates one run and fills the plan stage folder. It does not implement.

## Preflight

<!-- BEGIN PREFLIGHT -->

This skill needs `requires-atry` in its front matter.
Run `atry version --json` before any other command in this skill.
Stop when the output is not a JSON object with `schema` and `version`, and tell the user to run `npm i -g @tranthethang/agent-relay@latest`.
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

## Size

Count the goals and the tasks before you create a run.
Stop when the draft has more than one goal.
Stop when the draft has more than eight tasks.
Ask the user to split the work or to pick one plan.
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

## Non-goals

Do not implement. Do not start a review. Do not run `atry approve` or `atry close`.
