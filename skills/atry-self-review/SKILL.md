---
name: atry-self-review
description: Use right after an agent-relay implement stage finishes, before any cross-review.
requires-atry: ">=0.1.0"
---

# Self-Review

Before you write review prose, read `references/writing.md` and `references/reviewer-conduct.md`.

## Overview

This stage checks the implement diff against the plan. It fixes confirmed bugs. It writes one new review pair.

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

## Steps

1. Read `run.base`, the plan paths, and the implement paths from the context JSON.
2. Read `10-plan/overview.md`, each task file, and each `20-implement/` file.
3. Diff the work from `run.base` to the current HEAD.
4. Run `atry review new <run> self --tool <tool>`.
5. Add `--model <model>` when you know the model.
6. Run the project tests when the repo has them.
7. Fill the printed markdown file with the edit tool.
8. Set `fixed`, `tests`, and `open` in the printed JSON file.
9. Use `pass`, `fail`, or `not-run` for `tests`.
10. Run `atry review done <run> self`.

After `review done`, run `atry status <run> --json` and read
`reviews.delta`. If present, show its file and line counts to the user. The
delta records edits made after the latest review started. At close, the user
must accept the latest review delta before the agent uses `--ack-fixes`.

Fix a confirmed bug before `review done`.
Leave a style-only note in the markdown file. Do not change code for style.
Write a genuine tradeoff as a question card and in `open`.
`review new` records the stage start. Do not also run `atry stage start`.

## Non-goals

Do not close the run. Do not approve the plan.
