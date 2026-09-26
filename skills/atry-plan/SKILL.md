---
name: atry-plan
description: Use when the user asks to plan work in this repo before implementing -- starting a new agent-relay run, or writing/updating a plan.md that has not yet been broken into steps.
---

# Plan

## Overview

Creates a new run directory under `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/` with
`plan.md` and `meta.md`, ready for `atry-implement` to consume.

You are writing a plan that later stages (`atry-implement`, reviews) will
consume. Do not implement. Do not call other tools' agents. Produce one plan
file that `atry task-init` can parse without guessing.

## Preflight

Run `atry version` before anything else in this stage. If it fails, stop —
do not search the filesystem for helpers and do not fall back to running
`scripts/atry`, `scripts/runtime/*.sh`, or `~/.agent-relay/lib/*.sh` directly.
Tell the user to run `verify.sh` and fix what it reports (most often
`$HOME/.local/bin` missing from `PATH`). Run `atry` from the repo root, and
confirm each `atry resolve` / `atry run-init` call below prints `atry: using
<path>` on stderr. Full rule: `references/file-conventions.md` ("atry
preflight").

### Commands used in this stage

| Command                                                       | Meaning of a non-zero exit                                        |
| ------------------------------------------------------------- | ----------------------------------------------------------------- |
| `atry version`                                                | atry is missing or broken on PATH -- stop, see Preflight above    |
| `atry run-init <id> --slug <slug> [--title ...] [--base ...]` | invalid id/slug, or no `.agent-relay/` / git repo found above cwd |
| `atry task-init "$RUN_DIR"` (optional validation)             | the plan doesn't parse (bad checkbox status or dependency id)     |

## Run discovery

Follow `references/file-conventions.md`. For a **new** plan you always create a
new id (unless the user passed an explicit id to reuse).

Generate an id and slug:

```bash
# RUN_ID is the Unix epoch timestamp in seconds (offline, no network):
id="$(date +%s)"

# RUN_SLUG is a short agent-authored slug (3–48 chars, lowercase letters and single hyphens):
slug="<short-descriptive-slug>"
```

Record `base:` with a real git ref:

```bash
git rev-parse HEAD
```

Do not invent a ref. If git is unavailable, ask the user.

Initialize the run directory with `atry` (on PATH after install):

```bash
RUN_DIR="$(atry run-init "$id" --slug "$slug" --title "<short title>" --base "<base-ref>")"
# run-init may bump id on same-second collision; meta.md is canonical:
id="$(grep -E '^id:' "$RUN_DIR/meta.md" | head -1 | sed 's/^id:[[:space:]]*//')"
```

This creates `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/`, writes `meta.md`, and starts `history.log`.
Use the `id` read back from `meta.md` (not the pre-init `date +%s` value) when writing `plan.md`.

## Prior lessons (optional)

Before writing `## Goal`, check whether this repo already has distilled
lessons from earlier runs: look for the most recent
`.agent-relay/*/distillation.md` (sort by the `{YMD}-{RUN_ID}` prefix in the
directory name; newest first). If one exists and its lessons are relevant to
this plan's goal, skim it and let it inform `## Constraints` or `## Non-goals`
-- do not copy it wholesale, and do not block on it if none exists or none
apply. This is the only point where a prior run's `distillation.md` feeds
back into a later stage; nothing in this repo reads the knowledge bank back
automatically.

## Provenance

```html
<!-- relay: stage=plan tool=<tool> model=<id-or-unknown> base=<ref> date=<YYYY-MM-DD> -->
```

Today's date: `date +%F`. Use `unknown` for tool/model when you cannot know.

## Plan schema

Before writing `$RUN_DIR/plan.md`, read `references/plan-template.md` and use
it as the literal copy-and-fill outline. The schema below is the explanation;
the template file is what you fill in.

Write `$RUN_DIR/plan.md`:

```markdown
base: <git-rev-parse-HEAD>
id: <RUN_ID>

# <short title>

<!-- relay: stage=plan tool=... model=... base=... date=YYYY-MM-DD -->

## Goal

<what done looks like>

## Non-goals

<what this plan must not expand into>

## Decisions

<optional: choices already made that implement must not reopen>

## Flow

<optional: one mermaid diagram, only when the change alters a runtime flow>

## Constraints

<only what is specific to this run>

## Tasks

1. <short description> (deps: )
2. <short description> (deps: T1)
3. <short description> (deps: T1 T2)
```

`atry run-init` also seeds `meta.md` and `history.log`; see
`references/meta-template.md` and `references/history-log-template.md` for the
empty outlines of those files.

Rules for `## Tasks`:

- Exactly one flat numbered list under `## Tasks` (no nested numbered lists).
- Task ids for deps are the sequential `T1`, `T2`, … that `task-init` will
  assign (global counter, not the markdown number if they ever diverge — keep
  them aligned by using a single flat list).
- Use `(deps: )` or `(deps: T1 T2)` at the end of the line.
- Do not put numbered lists under Goal/Constraints that look like tasks.

Rules for the other sections:

- `## Decisions`: list choices already settled (in discussion, or by you
  with the user's agreement). If a task would otherwise say "pick one" or
  "decide X", decide it here or ask the user -- do not defer the choice to
  implement, which is told not to reinterpret the plan. Omit the section
  if there is nothing to record.
- `## Flow`: include one mermaid diagram only when the change alters a
  runtime flow, a state machine, or calls between components -- the kind
  of thing that is hard to follow in prose. Do not draw task order; `deps:`
  already says that. Omit the section otherwise.
- `## Constraints`: only what is specific to this run. Repo-wide rules
  already in `AGENTS.md` (or tool rules / `CLAUDE.md`) are read by
  `atry-implement` anyway; do not copy them here.

## Done check

After writing the plan, optionally validate with the implement skill's helper
if available in this environment:

```bash
atry task-init "$RUN_DIR"
```

`task-init` must create exactly as many `.status` files as numbered tasks.
If validation is not available here, still emit a schema-correct plan.

## Non-goals for this skill

- Do not run implement, review, or any model orchestration.
- Do not "also start coding" after the plan.
