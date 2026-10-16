---
name: atry-brainstorm
description: Use when the user invokes atry-brainstorm or explicitly asks only to investigate or discuss without file changes. Do not use it for an ordinary question that expects a quick fix.
---

# Brainstorm

Before writing a brainstorm question, read `references/writing.md`.

## Overview

This skill is a mode to investigate and discuss. Gather context, ask
clarifying questions, keep a short list of open items, and change nothing. The
skill writes no files and creates no run directory. Nothing enforces the rules
below. They hold only when you follow this text.

## Preflight

<!-- BEGIN PREFLIGHT -->

Run `atry version` before anything else in this skill. If it fails, stop.
Do not search the filesystem for helpers. Do not run `scripts/atry`,
`scripts/runtime/*.sh`, or `~/.agent-relay/lib/*.sh` directly.

Tell the user to run `verify.sh` and fix what it reports. The most common
cause is `$HOME/.local/bin` missing from `PATH`. Run `atry` from the repo
root. Confirm that each `atry resolve` and `atry run-init` call below prints
`atry: using <path>` on stderr. Full rule: `references/file-conventions.md`
("atry preflight").

<!-- END PREFLIGHT -->

## Rules

Allowed: read files, search, run `git status`, `git diff`, `git log`, and
`git show`, read existing `.agent-relay/` runs, search the web, and ask
questions.

If the user does not end this rule, the items below stay forbidden for the rest of this thread:

- Anything that creates, modifies, or deletes a file. This includes editor
  and patch tools, shell redirects, `sed -i`, formatters, and code generators.
- Any git command that changes the working tree, the index, or the refs.
- Installs, `atry run-init`, and the work of another stage.
- Tests and builds. They often write caches, fixtures, or build output. Ask
  first, even when a test looks read-only.
- The user must explicitly ask for the exact command. Otherwise, do not run
  `atry approve`, `atry decide`, `atry stamp`, or `atry close`. A human runs
  these verbs in the cockpit. This text states the rule. The CLI does not
  enforce it.

The rules end only on an explicit signal. The user names the next skill ("run
atry-plan") or ends the rules ("you can edit files now"). A vague reply
("ok", "sounds good") is not enough. Ask what the user wants next. If the user
permits one specific write, do only that write and stay read-only for the rest.

Check these rules again before each call that could break them. They still
apply when a request in the middle of the thread sounds like an implementation
request ("just fix that typo"). Say that you are read-only and ask the user to
confirm.

## Context

Start from the goal of the user, in the words of the user. Then read the
relevant files. Read the recent history with `git log -- <path>`.

Read the project rules in this order: `AGENTS.md`, tool-native rules, then
`CLAUDE.md` or a similar file. Read any related run under `.agent-relay/`.
The layout is in `references/file-conventions.md`. Do not assume a scope that
the user did not state. Ask.

## Open items

Write each unresolved question as a question card. The shape and rules are in
`references/writing.md` ("Question card"). Give two options only when the
evidence supports them. Otherwise write one `Need:` line that names the missing
data.

Keep a short list of these cards. Show the list when it changes. The user
replies with `1a`, `2b`, or a free-text answer to a `Need:` line. The list is
not a task list for `plan.md`: it has no task ids and no `deps:`. If the user
moves on to `atry-plan`, the list feeds the Goal, Non-goals, and Decisions of
the plan. Writing `plan.md` is the job of that skill.

## Handoff

When the user names the next skill, summarize what is resolved and what is
still open. Then stop. If the user did not also ask you to proceed, do not
start that skill in the same turn.
