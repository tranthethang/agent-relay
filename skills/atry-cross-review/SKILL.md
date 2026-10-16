---
name: atry-cross-review
description: Use when the user asks for a second opinion, a cross-check, or an independent review of an agent-relay change. The change already has a Self-Review. When you can, use a different tool or model than the implement and self-review authors.
---

# Cross-Review

Before writing review-report prose, read `references/writing.md`.

## Overview

This stage gives a second-opinion review of the change. It uses the artifacts
in the run directory and the earlier Self-Review sections. It appends dated
Cross-Review sections.

You are the _second_ reviewer. You run in a different tool than the tool that
implemented and self-reviewed the change. Do not repeat the earlier review.
Find the errors that a model or tool of the same family is likely to miss.

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

| Command                                                                     | Meaning of a non-zero exit                                        |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `atry version`                                                              | atry is missing or broken on PATH -- stop, see Preflight above    |
| `atry resolve [RUN_ID or path]`                                             | ambiguous or not found -- ask the user for the `RUN_ID` or path   |
| `atry history append <run-dir> cross-review started\|completed tool=<tool>` | run dir invalid                                                   |
| `atry review upsert <file> Cross-Review <date> <body-file>`                 | bad arguments, or `<file>` is not laid out as expected            |
| `atry check "$RUN_DIR"` (when `implement-plan/` exists)                     | `MISMATCH` -- a rollup was hand-edited outside the claim protocol |

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

- Plan file: `$RUN_DIR/plan.md`
- Task breakdown and implementation report. When the directory layout exists,
  use the directory and the `atry` helpers.
- Earlier review report: `$RUN_DIR/review-report.md`
- Earlier review walkthrough: `$RUN_DIR/review-walkthrough.md`
- The full diff from the `base:` git ref of the plan to the current tree
- Project rules, in the same order as implement

## Provenance

Get today's date from `date +%F`. Open each Cross-Review section with:

```html
<!-- relay: stage=cross-review tool=<tool> model=<id-or-unknown> base=<ref> date=<YYYY-MM-DD> -->
```

When you do not know the tool or model, write `unknown`. This is a record. It
does not enforce anything, and nothing here can verify which tool runs you.

`atry review upsert` prints a **non-blocking** warning when the Cross-Review
`tool=` equals the tool of the implement author. The author tool comes from the
latest `implement started` line in `history.log`. If that line is missing, it
comes from the first `<!-- relay: stage=implement ` line in
`implement-report.md`. If either side is empty or `unknown`, the check is
skipped. When you can, use a different tool than the implementer.

## Instructions

1. Resolve `$RUN_DIR` as above. Record stage start in `history.log`:
   ```bash
   atry history append "$RUN_DIR" cross-review started tool=<tool>
   ```
   Before you review, read `references/reviewer-conduct.md`. Then read the
   full chain: plan, implement, and earlier review.

1. Diff from the `base:` ref of the plan, or ask the user. Do not diff only the
   uncommitted changes.

1. Use inverted questions. For each assertion in the implementation report and
   the earlier Self-Review, ask where it can be wrong. Do not ask whether it
   looks right. Before you accept an assertion, derive the evidence again.
   Re-read the file, the diff, or the test or build output.

   List that evidence in the report. Include paths, commands, and results.
   A result of "no issues found" is valid when that evidence is present.
   Do not invent findings to fill the report.

1. Use different priorities than the self-review stage:

   - architecture and intent issues before line-level style
   - the fixes of the earlier reviewer: verify that they are correct
   - consistency with the rest of the codebase
   - each item that the earlier review left open

1. If the project has tests or a build, run them again and report pass or fail.

1. Fix and escalate rules (keep all three branches):

   - Fix confirmed bugs and rule violations directly.
   - For a pure style disagreement, write a note. Do not change the code.
   - For a genuine tradeoff (not a bug, not style, and not settled by the
     plan), escalate as `reviewer-conduct.md` says. In an interactive session,
     ask the developer. Otherwise record it under `### Open decisions` and
     leave the code as it is. When the human settles an open item, they record
     it with `atry decide <run> <id> "<resolution>"`, which writes
     `decisions.md`. If the user did not ask, do not run that command.
   - If you override an earlier decision, state why.

1. If the plan was ambiguous or wrong and the implementation correctly deferred
   or adjusted it, append a plan amendment. Do not rewrite the history:

   ```markdown
   ## Plan amendment — YYYY-MM-DD

   - What was wrong/ambiguous in the original plan
   - What was actually done instead
   - Why that should stick for future work
   ```

1. Upsert today's Cross-Review section with `atry review`. Before you write
   the body files, read `references/review-report-template.md` and
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
   body_tmp="$(mktemp "${TMPDIR:-/tmp}/ar-cross-body.XXXXXX")"
   walk_tmp="$(mktemp "${TMPDIR:-/tmp}/ar-cross-walk.XXXXXX")"
   trap 'rm -f "$body_tmp" "$walk_tmp"' EXIT

   # Populate $body_tmp and $walk_tmp; each file must start with the provenance
   # HTML comment, then the section body.
   atry review upsert \
     "$RUN_DIR/review-report.md" \
     Cross-Review "$TODAY" "$body_tmp"
   atry review upsert \
     "$RUN_DIR/review-walkthrough.md" \
     Cross-Review "$TODAY" "$walk_tmp"
   ```

   Keep the earlier `## Self-Review — ...` sections intact. In the body file,
   use `###` for subsections, not `##`. An unfenced `## ` starts a new section
   for `atry review`, so a same-day re-upsert truncates the body.

1. When cross-review is complete, record the completion in `history.log`:
   ```bash
   atry history append "$RUN_DIR" cross-review completed tool=<tool>
   ```
