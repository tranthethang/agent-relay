---
name: atry-brainstorm
description: Use when the user invokes atry-brainstorm or asks only to investigate or discuss without file changes.
requires-atry: ">=0.1.0"
---

# Brainstorm

Before you write a question card, read `references/writing.md`.

## Overview

This skill investigates and discusses. It stays read-only until the user allows one notes write. It does not create a run.

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

## Rules

Read files and run read-only git commands. Ask when the scope is not stated.

These actions stay forbidden until the user names the next skill or allows one write:

- Create, edit, or delete a file.
- Change the git index or git refs.
- Run tests or builds.
- Run `atry approve` or `atry close`.

A vague reply is not permission. Ask what the user wants next.
When the user allows one notes write, do only that write. Then stay read-only.

## Context

Start from the user goal. Then read the files that the goal names.
Read `AGENTS.md` before other project rules.
When the user names a run, use the context from Preflight.

## Open items

Write each open question as a question card. The rules are in `references/writing.md`.
Show the card list when it changes.
The user replies with `1a`, `2b`, or text for a `Need:` line.
This list is not a task list. It has no task ids.

## Notes write

Do this only after the user allows the notes write.

1. Run `atry brainstorm new --slug <slug>`.
2. Read the `notes` path and the `open` path from the result.
3. Fill `notes.md` with the edit tool.
4. Fill `open.json` from the question cards. Keep `schema` as `1`.
5. Run `atry brainstorm done <dir>`.

Use a slug of lowercase letters, digits, and single hyphens.
Stop when the command fails. Show the field path to the user.

## Handoff

When the user names the next skill, summarize what is resolved and what is open.
Then stop. Do not start that skill in the same turn.
