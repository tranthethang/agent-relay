---
name: atry-cross-review
description: Second-opinion cross-review of an agent-relay change using artifacts in the run directory and prior Self-Review sections; append dated Cross-Review sections. Use when the user asks for a cross-check or second-opinion review in a different tool/model.
---

# Cross-Review

You are the *second* reviewer, running in a different tool than whoever
implemented and self-reviewed this change. Your job is not to repeat the
previous review — it's to catch what a same-family model/tool is likely to miss.

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

- Plan file: `$RUN_DIR/plan.md`
- Implementation plan / report (prefer directory layout + helpers when present)
- Prior review report: `$RUN_DIR/review-report.md`
- Prior review walkthrough: `$RUN_DIR/review-walkthrough.md`
- Full diff from the plan's `base:` git ref to the current tree
- Project rules (same precedence as implement)

## Provenance

Today's date: run `date +%F`. Open each Cross-Review section with:

```html
<!-- relay: stage=cross-review tool=<tool> model=<id-or-unknown> base=<ref> date=<YYYY-MM-DD> -->
```

Use `unknown` when you cannot know the tool or model. This is a record, not
enforcement — nothing here can verify which tool is running you.

## Instructions

1. Resolve `$RUN_DIR` as above. Record stage start in `history.log`:
   ```bash
   atry history append "$RUN_DIR" cross-review started tool=<tool>
   ```
   Read `references/reviewer-conduct.md` before reviewing. Then read the full
   chain (plan → implement → prior review).

1. Diff from the plan `base:` (or ask), not just uncommitted changes.

1. Inverted-question framing: for each claim in the implement-report and prior
   Self-Review, ask "where could this be wrong?" — not "does this look right?"
   Independently re-derive evidence (re-read the actual file, diff, or
   test/build output) before accepting the claim. List that evidence in the
   report (paths, commands, results). A documented "no issues found" backed by
   that checklist is a valid, non-penalized outcome — do not invent findings to
   avoid it.

1. Prioritize differently from the self-review step:

   - architecture- and intent-level issues over line-level style
   - verify the prior reviewer's fixes are actually correct
   - check consistency with the rest of the codebase
   - re-check anything the prior review left open

1. If tests or a build step exist, re-run them and report pass/fail.

1. Fix / escalate rules (three branches — keep all three):

   - Fix confirmed bugs/rule violations directly.
   - Note pure style disagreements without changing code.
   - For a genuine tradeoff/decision point (not a bug, not style, not already
     resolved by the plan), escalate per `reviewer-conduct.md` — ask the
     developer if interactive; otherwise record under `### Open decisions`
     and leave the code as-is.
   - If you override a prior decision, state why.

1. If the plan itself was ambiguous or wrong and the implementation correctly
   deferred or adjusted, append a plan amendment (do not rewrite history):

   ```markdown
   ## Plan amendment — YYYY-MM-DD

   - What was wrong/ambiguous in the original plan
   - What was actually done instead
   - Why that should stick for future work
   ```

1. Upsert today's Cross-Review section with `atry review`.
   Before writing the body files, read
   `references/review-report-template.md` and
   `references/review-walkthrough-template.md` and use them as the
   copy-and-fill outlines:

   ```bash
   TODAY="$(date +%F)"
   atry review upsert \
     "$RUN_DIR/review-report.md" \
     Cross-Review "$TODAY" body.md
   atry review upsert \
     "$RUN_DIR/review-walkthrough.md" \
     Cross-Review "$TODAY" walk-body.md
   ```

   Keep prior `## Self-Review — ...` sections intact. Inside the body file, use
   `###` (not bare `##`) for subsections — unfenced `## ` is a section boundary
   for `atry review`, so a same-day re-upsert would truncate.

1. Once cross-review is complete, record completion in `history.log`:
   ```bash
   atry history append "$RUN_DIR" cross-review completed tool=<tool>
   ```
