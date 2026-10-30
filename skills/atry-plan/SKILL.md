---
name: atry-plan
description: "Write an agent-relay plan for a run before any implement work. Use this when the user asks to plan a change, to split that work into tasks, or to record the plan. Do not use it to implement those tasks, to review the code, or to edit product files before approval."
requires-atry: ">=0.10.7"
---

# Plan

Before you write plan prose, read `references/writing.md`.

## Overview

This stage creates one run and fills the plan stage folder. It does not implement.

## Preflight

<!-- BEGIN PREFLIGHT -->

Run `atry preflight --requires "<requires-atry>"` before any other command in this skill.
Copy the `requires-atry` front matter value into `--requires`, for example `>=0.10.7`.
Pass a `>=X.Y.Z` range only. Do not pass a skill name or subcommand such as `brainstorm`.
Treat the preflight exit code as the only version check. Do not compare version strings in prose.
Do not run `atry --version`. Run subcommand `atry version` only when the user needs the printed version.
Stop when that command exits non-zero. A dev build needs `--allow-dev` or `ATRY_DEV=1`; do not use a dev build for a real run.
When `atry` reports an unknown command, stop and tell the user to update `atry` from the README of `github.com/tranthethang/agent-relay`.
When this skill names a run, call `atry context <run> --json` first.
Read `references/file-conventions.md` before you edit a run file.
When the context JSON has `run.worktree`, edit files and run git in `run.worktree.path`.
A claim result with `worktree.path` takes precedence over `run.worktree.path`.

<!-- END PREFLIGHT -->

Use one of these tool names: `cursor`, `claude-code`, `cowork`, `codex`, `antigravity`, `kiro`, or `unknown`.

## Size

Count the goals and the tasks before you create a run.
Stop when the draft has more than one goal.
Why: Two goals in one run mix two reviews, so one goal can block the close of the other.
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
9. Fill the `## Detail` and `## Acceptance` sections in each `10-plan/T<n>.md` file that `plan done` creates. Approval needs both to hold text.
10. Do not run `atry stage done` for plan. `plan done` records the completed event.

`plan done` refuses a task list with zero tasks.

Use a slug of lowercase letters and single hyphens.
`run new` records `base` from git HEAD. Do not invent a ref.
Why: The scope check and the diff size start at `base`, so a wrong ref hides or adds changes.
Stop when a command fails. Show the field path to the user.

## Overview file

Write Goal, Non-goals, Decisions, Constraints, and Flow under `10-plan/overview.md`.
Read `references/example-overview.md` before you write that file.
Put settled choices under Decisions.
Put limits that apply only to this run under Constraints.
Add Flow only when the change alters a runtime flow.

## Tasks input

Keep `schema` as `1`.
Each task object has `title`, `deps`, and `files`.
`deps` lists earlier ids such as `T1`. Use `[]` when a task has no dependency.
`files` lists the repo paths that the task will edit.
Why: `claim` and the scope check read `files`, so a missing path shows up as an extra edit.
Use at most eight tasks.
Why: A longer task list is hard to review in one run and often holds more than one goal.

## Amend

Edit `tasks.input.json` when the user adds tasks after `plan done`.
Keep every existing title so the current ids stay.
Append only new tasks. Then run `atry plan amend <run>`.
Fill the `## Detail` and `## Acceptance` sections in each new task file that
`plan amend` creates. `plan amend` refuses a task list with zero tasks.
Amend after approval returns the run to `planned`, so it needs approval again.

## Approve and close

This skill does not approve or close.
A later skill runs `atry approve <run> --preview` or `atry close <run> --preview`.
That skill shows the preview and asks for one `y` or `n` answer.
`atry approve` refuses a plan with no index, zero tasks, or an empty Detail or
Acceptance section. `--preview` lists the missing items.

## Non-goals

Do not implement. Do not start a review.
