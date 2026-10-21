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

Run `atry preflight --requires "<requires-atry>"` before any other command in this skill.
Stop when that command exits non-zero.
When `atry` reports an unknown command, tell the user to run `npm i -g @tranthethang/agent-relay@latest`.
When this skill names a run, call `atry context <run> --json` first.
When the context JSON has `run.worktree`, edit files and run git in `run.worktree.path`.

<!-- END PREFLIGHT -->

Use one of these tool names: `cursor`, `claude-code`, `cowork`, `codex`, `antigravity`, `kiro`, or `unknown`.
Use a different tool than implement and self-review when you can.
`review done` prints a warning when the tool matches. The warning does not stop the command.

## Loop

Run `atry next <run> --json`.
Read `state`, `actions`, and `recommendation` from the result.
Follow the recommendation when only one action is available.
When several actions are available, show them and ask the developer to select one.
Then follow the developer's selection.
Read the selected action's paths before you run its command.
Stop when the state is closed or abandoned and no action is available.
When the selected action is approve, stop. This skill does not approve.
When the selected action names self-review, stop. Use the self-review skill for that stage.
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
When the selected action contains `review new`, run `atry review new <run> cross --tool <tool> --model <model>`.
When the selected action contains `review done`, follow the review method, then run `atry review done <run> cross`.
Repeat from the first step in this section.

## Review method

1. Read `run.base`, `reviews.self`, and the stage paths from the context JSON.
2. Read the plan files, the implement files, and the self-review pair.
3. Diff the work from `run.base` to the current HEAD. When `run.worktree` exists, diff in `run.worktree.path`.
4. Ask where each earlier claim can be wrong. Then check that place.

`review new cross` requires `--model`. After the user answers an open
question, record the answer with `atry review decide <run> Q<n> <answer>`.
Use `a` or `b` for a choice card and the user's text for a `Need:` card.
Let `atry review done` run the configured `testCommand` from the run's base policy.
Fill the printed markdown file with the edit tool.
Set `fixed` and `open` in the printed JSON file.
`review done` stores the configured test command's exit code, duration, and
tree in the event and writes its last 200 output lines to `.test.log`.

Fix a confirmed bug before `review done`.
Leave a style-only note in the markdown file. Do not change code for style.
Write a genuine tradeoff as a question card and in `open`.
`review new` records the stage start. Do not also run `atry stage start`.
