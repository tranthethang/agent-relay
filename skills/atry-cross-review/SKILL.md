---
name: atry-cross-review
description: Second-opinion cross-review of an agent-relay change using plan-<id>.md, implement artifacts, and the prior Self-Review sections; append dated Cross-Review sections. Use when the user asks for a cross-check, second-opinion review, or final review in a different tool/model than the self-review.
---

# Cross-Review

You are the *second* reviewer, running in a different tool than whoever
implemented and self-reviewed this change. Your job is not to repeat the
previous review — it's to catch what a same-family model/tool is likely to miss.

## Run discovery

Resolve the shared run `<id>` before reading or writing artifacts. Follow
`references/file-conventions.md` (installed next to this skill) for the full
order (user id → CURRENT → single plan-*.md → ask).

Legacy unsuffixed names are only allowed when no `plan-*.md` exists; append to
suffixed review files once an id is resolved.

**Only write `.agent-relay/CURRENT` when you create a new id.** Resolving an
existing id must not overwrite `CURRENT`.

## Inputs

- Plan file: `.agent-relay/plan-<id>.md`
- Implementation plan / report (prefer directory layout + helpers when present)
- Prior review report: `.agent-relay/review-report-<id>.md`
- Prior review walkthrough: `.agent-relay/review-walkthrough-<id>.md`
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

1. Resolve `<id>` as above (write `CURRENT` only if you created the id). Read the
   full chain (plan → implement → prior review).

1. Diff from the plan `base:` (or ask), not just uncommitted changes.

1. Prioritize differently from the self-review step:

   - architecture- and intent-level issues over line-level style
   - verify the prior reviewer's fixes are actually correct
   - check consistency with the rest of the codebase
   - re-check anything the prior review left open

1. If tests or a build step exist, re-run them and report pass/fail.

1. Fix confirmed bugs/rule violations directly; note pure style disagreements
   without changing code; if you override a prior decision, state why.

1. If the plan itself was ambiguous or wrong and the implementation correctly
   deferred or adjusted, append a plan amendment (do not rewrite history):

   ```markdown
   ## Plan amendment — YYYY-MM-DD

   - What was wrong/ambiguous in the original plan
   - What was actually done instead
   - Why that should stick for future work
   ```

1. Upsert today's Cross-Review section with the helper beside this skill:

   ```bash
   TODAY="$(date +%F)"
   scripts/review-section.sh upsert \
     .agent-relay/review-report-<id>.md \
     Cross-Review "$TODAY" body.md
   scripts/review-section.sh upsert \
     .agent-relay/review-walkthrough-<id>.md \
     Cross-Review "$TODAY" walk-body.md
   ```

   Keep prior `## Self-Review — ...` sections intact.
