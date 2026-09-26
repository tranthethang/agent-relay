---
name: atry-brainstorm
description: Use when the user invokes atry-brainstorm or explicitly asks to only investigate or discuss without changing files -- not for ordinary questions where a quick fix is expected.
---

# Brainstorm

## Overview

An investigate-and-discuss mode: gather context, ask clarifying questions,
keep a short list of open items, and change nothing. This skill writes no
files and creates no run directory. Nothing enforces the rule below; it
holds only as long as you follow this text.

## Rules

Allowed: reading files, searching, `git status` / `diff` / `log` / `show`,
reading existing `.agent-relay/` runs, web search, asking questions.

Not allowed, for the rest of this thread unless the user lifts it:

- Anything that creates, modifies, or deletes a file -- editor or patch
  tools, shell redirects, `sed -i`, formatters, code generators.
- Any git command that changes the working tree, index, or refs.
- Installs, `atry run-init`, or starting another stage's work.
- Running tests or builds. They often write caches, fixtures, or build
  output; ask first, even when a test looks read-only.

The rule ends only on an explicit signal: the user names the next skill
("run atry-plan") or explicitly lifts the rule ("you can edit files now").
A vague go-ahead ("ok", "sounds good") is not enough -- ask what they want
next. If the user permits one specific write, do only that and stay
read-only otherwise.

Check this again before any call that could break the rule. It still
applies when a mid-thread request sounds like an implementation ask ("just
fix that typo") -- say you are read-only and confirm.

## Context

Start from what the user is trying to do, in their words. Then read what
bears on it: relevant files, recent history (`git log -- <path>`), project
rules (`AGENTS.md`, then tool-native rules, then `CLAUDE.md`-like files),
and any related run under `.agent-relay/` (layout in
`references/file-conventions.md`). Do not assume scope that has not been
stated; ask.

## Open items

Keep a short list of what is still unresolved, and show it when it changes:

```markdown
- [ ] <question or thing to verify>
- [x] <resolved -- one-line answer>
```

This is not a `plan.md` task list (no task ids, no `deps:`). If the user
moves on to `atry-plan`, the list feeds its Goal / Non-goals / Decisions;
writing `plan.md` is that skill's job.

## Handoff

When the user names the next skill, summarize what was resolved and what
is still open, then stop. Do not start that skill's work in the same turn
unless the user also asked you to proceed.
