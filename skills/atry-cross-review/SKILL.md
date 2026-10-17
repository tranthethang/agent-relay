---
name: atry-cross-review
description: Use when the user asks for a second opinion or an independent review of an agent-relay change.
requires-atry: ">=0.1.0"
---

# Cross-Review

Before you write review prose, read `references/writing.md` and `references/reviewer-conduct.md`.

## Overview

This stage reviews the plan, the implement files, and the latest self-review. It writes one new review pair. It can close the run after the user agrees.

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
Use a different tool than implement and self-review when you can.
`review done` prints a warning when the tool matches. The warning does not stop the command.

## Steps

1. Read `run.base`, `reviews.self`, and the stage paths from the context JSON.
2. Read the plan files, the implement files, and the self-review pair.
3. Diff the work from `run.base` to the current HEAD.
4. Ask where each earlier claim can be wrong. Then check that place.
5. Run `atry review new <run> cross --tool <tool>`.
6. Add `--model <model>` when you know the model.
7. Run the project tests when the repo has them.
8. Fill the printed markdown file with the edit tool.
9. Set `fixed`, `tests`, and `open` in the printed JSON file.
10. Use `pass`, `fail`, or `not-run` for `tests`.
11. Run `atry review done <run> cross`.

Fix a confirmed bug before `review done`.
Leave a style-only note in the markdown file. Do not change code for style.
Write a genuine tradeoff as a question card and in `open`.
`review new` records the stage start. Do not also run `atry stage start`.

## Close

After `review done`, show `fixed`, each `open` item, and `tests`.
Recommend `n` when `open` is not empty.
Recommend `n` when `tests` is `fail`.
When the skill call includes a `yes` token and `open` is empty, run `atry close <run> --via arg`.
When that token is present and `open` is not empty, ask the user. Do not close yet.
Otherwise ask the user to answer `y` or `n`.
When the user answers `n`, stop. Do not record a close event.
When the user answers `y` and `open` is empty, run `atry close <run> --via confirm`.
When the user answers `y` and `open` is not empty, ask once more.
After that second yes, run `atry close <run> --via confirm --ack-open`.
