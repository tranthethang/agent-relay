---
name: atry-plan
description: Create a new run directory under .agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/ with plan.md and meta.md. Use when the user asks to plan work for agent-relay before implement.
---

# Plan

You are writing a plan that later stages (`atry-implement`, reviews) will
consume. Do not implement. Do not call other tools' agents. Produce one plan
file that `scripts/task-init.sh` can parse without guessing.

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

Initialize the run directory with the helper shipped next to this skill:

```bash
# from skill directory or repo root:
RUN_DIR="$(scripts/run-init.sh "$id" --slug "$slug" --title "<short title>" --base "<base-ref>")"
# run-init may bump id on same-second collision; meta.md is canonical:
id="$(grep -E '^id:' "$RUN_DIR/meta.md" | head -1 | sed 's/^id:[[:space:]]*//')"
```

This creates `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/`, writes `meta.md`, and starts `history.log`.
Use the `id` read back from `meta.md` (not the pre-init `date +%s` value) when writing `plan.md`.
There is no `CURRENT` file — each run is self-contained.

## Provenance

```html
<!-- relay: stage=plan tool=<tool> model=<id-or-unknown> base=<ref> date=<YYYY-MM-DD> -->
```

Today's date: `date +%F`. Use `unknown` for tool/model when you cannot know.

## Plan schema

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

## Constraints

<bash version, no network in tests, etc.>

## Tasks

1. <short description> (deps: )
2. <short description> (deps: T1)
3. <short description> (deps: T1 T2)
```

Rules for `## Tasks`:

- Exactly one flat numbered list under `## Tasks` (no nested numbered lists).
- Task ids for deps are the sequential `T1`, `T2`, … that `task-init` will
  assign (global counter, not the markdown number if they ever diverge — keep
  them aligned by using a single flat list).
- Use `(deps: )` or `(deps: T1 T2)` at the end of the line.
- Do not put numbered lists under Goal/Constraints that look like tasks.

## Done check

After writing the plan, optionally validate with the implement skill's helper
if available in this environment:

```bash
# from a checkout of agent-relay, or after install from the implement bundle:
scripts/task-init.sh "$RUN_DIR"
```

`task-init` must create exactly as many `.status` files as numbered tasks.
If validation is not available here, still emit a schema-correct plan.

## Non-goals for this skill

- Do not run implement, review, or any model orchestration.
- Do not "also start coding" after the plan.
