---
name: atry-self-review
description: Use right after an agent-relay implement stage finishes, before any cross-review. Review the diff just produced against its own plan.
---

# Self-Review

Before writing review-report prose, read `references/writing.md`.

## Overview

This stage reviews code that was written from a plan. It uses the task
breakdown (`implement-plan.md`) and `implement-report.md`. It fixes confirmed
bugs. It writes dated sections in `review-report.md` and
`review-walkthrough.md`.

You review code that a model just implemented from a plan. That model may
differ, and it may be weaker. Treat the implementation report as an assertion
to verify. It is not a fact.

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

| Command                                                                    | Meaning of a non-zero exit                                        |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `atry version`                                                             | atry is missing or broken on PATH -- stop, see Preflight above    |
| `atry resolve [RUN_ID or path]`                                            | ambiguous or not found -- ask the user for the `RUN_ID` or path   |
| `atry history append <run-dir> self-review started\|completed tool=<tool>` | run dir invalid                                                   |
| `atry review upsert <file> Self-Review <date> <body-file>`                 | bad arguments, or `<file>` is not laid out as expected            |
| `atry check "$RUN_DIR"` (when `implement-plan/` exists)                    | `MISMATCH` -- a rollup was hand-edited outside the claim protocol |

## Run discovery

Resolve the run directory before reading or writing artifacts:

```bash
RUN_DIR="$(atry resolve [RUN_ID or path])"
```

If the user passes a `RUN_ID` or a path under a run directory, pass it to
`atry resolve`. If the user passes no argument and one run directory exists,
`atry resolve` selects it. If the command exits non-zero (ambiguous or not
found), ask the user for the `RUN_ID` or path.

## Inputs

- Plan file: `$RUN_DIR/plan.md` (use its `base:` ref when present)
- Task breakdown: `$RUN_DIR/implement-plan.md`. If `$RUN_DIR/implement-plan/`
  exists, list the tasks with `atry list`. The rollup file can be out of date.
- Implementation report: if `$RUN_DIR/implement-report/` exists, read the
  per-task files in that directory. They are more reliable than the generated
  rollup. Otherwise read `$RUN_DIR/implement-report.md`.
- The current uncommitted changes (`git status` and `git diff`). If the work
  is already committed, diff from the `base:` ref of the plan, or ask the
  user.
- Project rules, in the same order as implement: `AGENTS.md`, then tool rules,
  then `CLAUDE.md` or a similar file

## Provenance

Get today's date from `date +%F`. Do not guess it. Open each review section
with:

```html
<!-- relay: stage=self-review tool=<tool> model=<id-or-unknown> base=<ref> date=<YYYY-MM-DD> -->
```

When you do not know the tool or model, write `unknown`. This is a record. It
is not a proof of the runtime.

## Model choice

Self-review is often the _only_ independent check that a change gets. The user
starts cross-review separately, and it may never run for a change. If you
cannot confirm that a cross-review will follow, use the strongest model that
you can use for this stage. Do not default to the model that ran implement. A
weaker model can miss real bugs and still write "no bugs found" with full
confidence. If cross-review does not run, nothing later catches the error.

## Instructions

1. Resolve `$RUN_DIR` as above. Record stage start in `history.log`:
   ```bash
   atry history append "$RUN_DIR" self-review started tool=<tool>
   ```
   Before you review, read `references/reviewer-conduct.md`. Then read the
   plan, the task breakdown, and the implementation report.

1. Inspect the actual changes with git. The diff is the source of truth. The
   implementation report can be incomplete or wrong. Before you accept an
   assertion in the implementation report, apply the evidence-not-assertion
   rule from `reviewer-conduct.md` to it.

1. Review for these items, in this order:

   - hidden bugs and logic errors
   - whether the implementation satisfies the intent of the plan
   - conformance with project rules and existing conventions
   - code smells (only after the items above)

   Scope rule: fix bugs and rule violations against the intent of the plan.
   Do **not** enlarge the scope beyond the plan.

1. Broad-vision lens (analysis only): also check the reviewed diff for
   cross-feature impact and reuse opportunities. Fix a confirmed bug that you
   find this way directly. Write everything else, including each pattern or
   architecture suggestion, as a walkthrough note. A note never expands the
   scope. Propose a pattern only when it reduces duplication or complexity
   that the reviewed diff already has.

1. If the project has tests or a build, run them and report pass or fail.

1. Fix and escalate rules (keep all three branches):

   - Fix **confirmed** bugs and rule violations directly.
   - For a style preference that does not affect correctness, write a note in
     the walkthrough. Do not change the code.
   - For a genuine tradeoff (not a bug, not style, and not settled by the
     plan), escalate as `reviewer-conduct.md` says. In an interactive session,
     ask the developer. Otherwise record it under `### Open decisions` and
     leave the code as it is. When the human settles an open item, they record
     it with `atry decide <run> <id> "<resolution>"`, which writes
     `decisions.md`. If the user did not ask, do not run that command.
   - If a fix must deviate from the plan, say so in the report.

1. Upsert today's Self-Review section with `atry review`. Do not edit other
   sections by hand. Before you write the body files, read
   `references/review-report-template.md` and
   `references/review-walkthrough-template.md`. Copy the templates and fill
   them in.

   **Workspace hygiene:** Do not write review intermediates under the
   repository workspace or under `$RUN_DIR`. Intermediates include body files,
   walk bodies, diff dumps, patches, and scratch directories. Write each body
   to a system temporary file with `mktemp "${TMPDIR:-/tmp}/ar-*.XXXXXX"`.
   Before you fill the files, register cleanup with `trap 'rm -f …' EXIT`.
   The cleanup removes the files even when the stage stops early:

   ```bash
   TODAY="$(date +%F)"
   body_tmp="$(mktemp "${TMPDIR:-/tmp}/ar-self-body.XXXXXX")"
   walk_tmp="$(mktemp "${TMPDIR:-/tmp}/ar-self-walk.XXXXXX")"
   trap 'rm -f "$body_tmp" "$walk_tmp"' EXIT

   # Populate $body_tmp and $walk_tmp; each file must start with the provenance
   # HTML comment, then the section body.
   atry review upsert \
     "$RUN_DIR/review-report.md" \
     Self-Review "$TODAY" "$body_tmp"
   atry review upsert \
     "$RUN_DIR/review-walkthrough.md" \
     Self-Review "$TODAY" "$walk_tmp"
   ```

   Never remove `## Cross-Review` sections or Self-Review sections of other
   dates. In the body file, use `###` for subsections, not `##`. An unfenced
   `## ` starts a new section for `atry review`, so a same-day re-upsert
   truncates the body. The report lists the issues found, the fixes, the
   notes, and the test and build results. The walkthrough is a short narrative
   for the next reviewer.

1. When self-review is complete, record the completion in `history.log`:
   ```bash
   atry history append "$RUN_DIR" self-review completed tool=<tool>
   ```
