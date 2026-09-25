---
name: atry-self-review
description: Use right after an agent-relay implement step finishes, before any cross-review -- reviewing the diff that was just produced against its own plan.
---

# Self-Review

## Overview

Reviews code produced from a plan using `implement-plan.md` and
`implement-report.md`, fixes confirmed bugs, and writes dated sections in
`review-report.md` and `review-walkthrough.md`.

You are reviewing code that a (possibly different, possibly weaker) model just
implemented from a plan. Treat the implementation report as a claim to verify,
not a fact.

## Run discovery

Resolve the run directory before reading or writing artifacts:

```bash
RUN_DIR="$(atry resolve [RUN_ID or path])"
```

If the user passed a `RUN_ID` or a path under a run directory, pass it to
`atry resolve`. If no argument is passed and exactly one run directory exists,
it resolves automatically. If it exits non-zero (ambiguous or not found), ask
the user for the `RUN_ID` or path.

## Inputs

- Plan file: `$RUN_DIR/plan.md` (use its `base:` ref when present)
- Implementation plan: `$RUN_DIR/implement-plan.md`. If
  `$RUN_DIR/implement-plan/` exists, prefer listing via the claim helper over a
  possibly-stale rollup file.
- Implementation report: if `$RUN_DIR/implement-report/` exists, prefer per-task
  files in that dir over the generated rollup. Otherwise read
  `$RUN_DIR/implement-report.md`.
- Current uncommitted changes (`git status` / `git diff`). If the work was
  already committed, diff from the plan's `base:` ref (or ask the user).
- Project rules (same precedence as implement: `AGENTS.md`, then tool rules,
  then `CLAUDE.md` / similar)

## Provenance

Today's date: run `date +%F` (do not guess). Open each review section with:

```html
<!-- relay: stage=self-review tool=<tool> model=<id-or-unknown> base=<ref> date=<YYYY-MM-DD> -->
```

Use `unknown` when you cannot know the tool or model. This is a record, not a
runtime proof.

## Model choice

Self-review is often the *only* independent check a change gets -- Cross-Review
is invoked separately and may never run for a given change. If you cannot
confirm that a cross-review will follow, prefer the strongest model available
to you for this stage rather than defaulting to whatever ran implement. A
weaker self-review model can miss real bugs and still write "no bugs found"
with full confidence; there is nothing downstream to catch that if
cross-review is skipped.

## Instructions

1. Resolve `$RUN_DIR` as above. Record stage start in `history.log`:
   ```bash
   atry history append "$RUN_DIR" self-review started tool=<tool>
   ```
   Read `references/reviewer-conduct.md` before reviewing. Then read the plan,
   implementation plan, and implementation report.

1. Inspect the actual changes with git. The diff is the source of truth; the
   implementation report may be incomplete or wrong. Apply the evidence-not-
   assertion rule from `reviewer-conduct.md` to every claim in the
   implement-report before accepting it.

1. Review for, in this order:

   - hidden bugs and logic errors
   - whether the implementation actually satisfies the plan's intent
   - conformance with project rules and existing conventions
   - code smells (only after the above)

   Scope rule: fix bugs and rule violations relative to the plan's intent, but
   do **not** enlarge scope beyond the plan.

1. Broad-vision lens (analysis only): also check cross-feature impact and
   reuse opportunities in the reviewed diff. Action constraint — a confirmed
   bug found this way is fixed directly; everything else (including any
   pattern or architecture suggestion) is a walkthrough note only, never
   scope expansion on its own. Propose a pattern only where it would reduce
   duplication or complexity already present in the reviewed diff.

1. If tests or a build step exist in this project, run them and report pass/fail.

1. Fix / escalate rules (three branches — keep all three):

   - Fix **confirmed** bugs and rule violations directly.
   - For stylistic preferences that don't affect correctness, note them in the
     walkthrough instead of changing code.
   - For a genuine tradeoff/decision point (not a bug, not style, not already
     resolved by the plan), escalate per `reviewer-conduct.md` — ask the
     developer if interactive; otherwise record under `### Open decisions`
     and leave the code as-is.
   - If a fix requires deviating from the original plan, say so explicitly.

1. Upsert today's Self-Review section with `atry review` (do not
   hand-edit other sections). Before writing the body files, read
   `references/review-report-template.md` and
   `references/review-walkthrough-template.md` and use them as the
   copy-and-fill outlines:

   ```bash
   TODAY="$(date +%F)"
   # body file must start with the provenance HTML comment, then the section body
   atry review upsert \
     "$RUN_DIR/review-report.md" \
     Self-Review "$TODAY" body.md
   atry review upsert \
     "$RUN_DIR/review-walkthrough.md" \
     Self-Review "$TODAY" walk-body.md
   ```

   Never remove `## Cross-Review` sections or Self-Review sections from other
   dates. Inside the body file, use `###` (not bare `##`) for subsections —
   unfenced `## ` is a section boundary for `atry review`, so a same-day
   re-upsert would truncate. The report lists issues found, what was fixed,
   what was left as a note, and test/build results. The walkthrough is a short
   narrative for the next reviewer.

1. Once self-review is complete, record completion in `history.log`:
   ```bash
   atry history append "$RUN_DIR" self-review completed tool=<tool>
   ```
