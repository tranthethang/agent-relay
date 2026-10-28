---
name: atry-brainstorm
description: "Investigate an agent-relay question before any file change. Use this when the user wants to discuss a run, a plan, or a design and does not want edits yet. Do not use it to implement code, to write the plan file, or to review a finished change."
requires-atry: ">=0.10.7"
---

# Brainstorm

Before you write a question card, read `references/writing.md`.

## Overview

This skill investigates and discusses. It stays read-only until the user allows one notes write. It does not create a run.

## Preflight

<!-- BEGIN PREFLIGHT -->

Run `atry preflight --requires "<requires-atry>"` before any other command in this skill.
Stop when that command exits non-zero. A dev build needs `--allow-dev` or `ATRY_DEV=1`; do not use a dev build for a real run.
When `atry` reports an unknown command, stop and tell the user to update `atry` from the README of `github.com/tranthethang/agent-relay`.
When this skill names a run, call `atry context <run> --json` first.
Read `references/file-conventions.md` before you edit a run file.
When the context JSON has `run.worktree`, edit files and run git in `run.worktree.path`.
A claim result with `worktree.path` takes precedence over `run.worktree.path`.

<!-- END PREFLIGHT -->

## Rules

Read files and run read-only git commands. Ask when the scope is not stated.

These actions stay forbidden until the user names the next skill or allows one write:

- Create, edit, or delete a file.
- Change the git index or git refs.
- Run tests or builds.
- Run `atry approve` or `atry close`.

Why: An early write changes the repo before the user agrees on the scope.

A vague reply is not permission. Ask what the user wants next.
Why: A guess at permission can start edits that the user did not ask for.
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
Why: The user reads the summary and starts the next skill, so no edit begins before that check.
