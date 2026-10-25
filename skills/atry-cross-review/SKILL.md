---
name: atry-cross-review
description: "Give an independent review of an agent-relay change. Use this when a self review is done and the user wants a second review of the run. Do not use it to implement the change, to skip the self review, or to close the run without a decision."
requires-atry: ">=0.10.7"
---

# Cross-Review

Before you write review prose, read `references/writing.md` and `references/reviewer-conduct.md`.

## Overview

This stage reviews the plan, the implement files, and the latest self-review. It writes one new review pair. It can close the run after the user agrees.

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
Use a different tool than implement and self-review when you can.
`review done` prints a warning when the tool matches, but does not stop the command.

## Loop

This skill handles `review-new` and `review-done` with `args.review` `cross`, `decide`, and `close`. For `review-done`, follow the review method. Use the self-review skill for a self review.

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

## Review method

1. Read `run.base`, `reviews.self`, and the stage paths from the context JSON.
2. Read the plan files, the implement files, and the self-review pair.
3. Diff the work from `run.base` to the current HEAD. When `run.worktree` exists, diff in `run.worktree.path`.
4. Ask where each earlier claim can be wrong. Then check that place.

`review new cross` requires `--model`. Record each answer with
`atry review decide <run> Q<n> <answer>`.
Use `a` or `b` for a choice card and the user's text for a `Need:` card.
`review done` prints `test command: <command>`. Run the configured `testCommand` from the base policy only with `--run-tests`.
Fill the printed markdown file with the edit tool. Read `references/example-cross-review.md` before you write that file.
Fill `findings` and `open` in the printed JSON file.
`close` refuses while a `high` finding is `open`.
`review done` stores the test exit code, duration, and tree.
It writes the last 200 output lines to `.test.log` and prints none.

Fix a confirmed bug before `review done`.
A fix needs a later self-review before close. `atry next` recommends it.
`review new` records the stage start. Do not also run `atry stage start`.
