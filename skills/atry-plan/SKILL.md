---
name: atry-plan
description: Use when the user asks to plan work in this repo before implementing. Start a new run, or write or update a plan.md before the task breakdown.
---

# Plan

Before writing plan prose, read `references/writing.md`.

## Overview

This stage creates a run directory under `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/`
with `plan.md` and `meta.md`. `atry-implement` reads these files.

You write a plan that later stages (`atry-implement` and reviews) read. Do not
implement. Do not call the agents of other tools. Write one plan file that
`atry task-init` can parse without guessing.

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

The user must explicitly ask for the exact command in this conversation.
Otherwise, do not run `atry approve`, `atry decide`, `atry stamp`, or
`atry close`. A human runs these verbs in the cockpit. This text states the
rule. The CLI does not enforce it.

### Commands used in this stage

| Command                                                       | Meaning of a non-zero exit                                        |
| ------------------------------------------------------------- | ----------------------------------------------------------------- |
| `atry version`                                                | atry is missing or broken on PATH -- stop, see Preflight above    |
| `atry run-init <id> --slug <slug> [--title ...] [--base ...]` | invalid id/slug, or no `.agent-relay/` / git repo found above cwd |
| `atry task-init "$RUN_DIR"` (optional validation)             | the plan doesn't parse (bad checkbox status or dependency id)     |

## Size gate

Sketch the goal and the task list of the draft before you create a run
directory. Before you call `atry run-init`, count the independent goals and
the tasks. Group tasks that depend on one another into dependency clusters.
Print a size note. Include the independent-goal count, the task count, the
dependency clusters, and a split suggestion.

If the draft has more than one independent goal or more than eight tasks, do
not call `atry run-init`. Ask the user to choose a split or one plan. Continue
only after the user chooses.

## Run discovery

Follow `references/file-conventions.md`. For a **new** plan, create a new id.
Reuse an id only when the user passes one.

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

Do not invent a ref. If git is not available, ask the user.

Initialize the run directory with `atry`:

```bash
RUN_DIR="$(atry run-init "$id" --slug "$slug" --title "<short title>" --base "<base-ref>")"
# run-init may bump id on same-second collision; meta.md is canonical:
id="$(grep -E '^id:' "$RUN_DIR/meta.md" | head -1 | sed 's/^id:[[:space:]]*//')"
```

This command creates `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/`, writes `meta.md`, and starts `history.log`.
Write `plan.md` with the `id` from `meta.md`, not the `date +%s` value from before init.

## Provenance

```html
<!-- relay: stage=plan tool=<tool> model=<id-or-unknown> base=<ref> date=<YYYY-MM-DD> -->
```

Get today's date from `date +%F`. When you do not know the tool or model, write `unknown`.

## Plan schema

Before you write `$RUN_DIR/plan.md`, read `references/plan-template.md`. Copy
the template and fill it in. The schema below explains the template.

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

`atry run-init` also creates `meta.md` and `history.log`. The empty outlines
are in `references/meta-template.md` and `references/history-log-template.md`.

Rules for `## Tasks`:

- Write one flat numbered list under `## Tasks`. Do not nest numbered lists.
- Dependency ids are the sequential `T1`, `T2`, … that `task-init` assigns.
  Keep them equal to the markdown numbers with one flat list.
- End each line with `(deps: )` or `(deps: T1 T2)`.
- Do not put a numbered list under Goal or Constraints that looks like tasks.

Rules for the other sections:

- `## Decisions`: list the choices already settled, in discussion or with the
  user's agreement. If a task would say "pick one", settle the choice here or
  ask the user. Do not leave the choice to implement, because implement must
  not reinterpret the plan. Omit the section when nothing needs a record.
- `## Flow`: add one mermaid diagram only when the change alters a runtime
  flow, a state machine, or calls between components. Do not draw task order,
  because `deps:` shows it. Omit the section in other cases.
- `## Constraints`: write only what is specific to this run. `atry-implement`
  reads the repo-wide rules in `AGENTS.md` (or tool rules or `CLAUDE.md`).
  Do not copy them here.

## Done check

After you write the plan, you can validate it with the implement helper:

```bash
atry task-init "$RUN_DIR"
```

`task-init` must create one `.status` file for each numbered task. If
validation is not available, still write a plan that follows the schema.

## Non-goals for this skill

- Do not run implement, review, or any model orchestration.
- Do not start to code after the plan.
