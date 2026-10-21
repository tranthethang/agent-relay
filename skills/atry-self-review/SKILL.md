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
When the selected action is approve, stop. This skill does not approve.
When the selected action names cross-review, stop. Use the cross-review skill for that stage.
When the selected action contains `close`, run `atry close <run> --preview`.
Show that preview and ask the user to answer `y` or `n`.
When it recommends `n`, read `strict.reviewIntegrity` from the run base policy.
When that setting is `true`, stop without closing.
When it is `false`, show the listed integrity warnings and let the user decide.
When the skill call includes a `yes` token, use that token as `y`.
When the user answers `n`, stop and do not record an event.
When the preview says `recommend: n` and `strict.reviewIntegrity` is `true`, stop and do not record an event.
When the user answers `y` and the preview says `recommend: y`, run `atry close <run> --via confirm`.
When the user answers `y`, the preview says `recommend: n`, and `strict.reviewIntegrity` is `false`, run `atry close <run> --via confirm`.
When the `yes` token is that answer, run `atry close <run> --via arg`.
When the selected action contains `review new`, run `atry review new <run> self --tool <tool>`.
Add `--model <model>` when you know the model.
When the selected action contains `review done`, follow the review method, then run `atry review done <run> self`.
Repeat from the first step in this section.

## Review method

1. Read `run.base`, the plan paths, and the implement paths from the context JSON.
2. Read `10-plan/overview.md`, each task file, and each `20-implement/` file.
3. Diff the work from `run.base` to the current HEAD. When `run.worktree` exists, diff in `run.worktree.path`.

After the user answers an open question, record the answer with
`atry review decide <run> Q<n> <answer>`. Use `a` or `b` for a choice card.
Use the user's text for a `Need:` card.
Let `atry review done` run the configured `testCommand` from the run's base policy.
Fill the printed markdown file with the edit tool.
Set `fixed` and `open` in the printed JSON file.
`review done` stores the configured test command's exit code, duration, and tree.
It also writes the last 200 output lines to the matching `.test.log` file.
The close preview names a delta when one is present.

Fix a confirmed bug before `review done`.
Leave a style-only note in the markdown file. Do not change code for style.
Write a genuine tradeoff as a question card and in `open`.
`review new` records the stage start. Do not also run `atry stage start`.

## Non-goals

Do not approve the plan.
