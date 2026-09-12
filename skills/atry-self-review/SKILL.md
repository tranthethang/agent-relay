---
name: atry-self-review
description: Self-review code produced from .agent-relay/plan-<id>.md using implement-plan-<id>.md and implement-report-<id>.md; fix confirmed bugs; write dated sections in review-report-<id>.md and review-walkthrough-<id>.md. Use after an agent-relay implement step, or when the user asks to self-review that implementation — not for unrelated refactors.
---

# Self-Review

You are reviewing code that a (possibly different, possibly weaker) model just
implemented from a plan. Treat the implementation report as a claim to verify,
not a fact.

## Run discovery

Resolve the shared run `<id>` before reading or writing artifacts. Follow
`references/file-conventions.md` (installed next to this skill) for the full
order (user id → CURRENT → single plan-*.md → ask).

Legacy unsuffixed names (`plan.md`, etc.) are only allowed when no `plan-*.md`
exists; after review, write suffixed review files.

**Only write `.agent-relay/CURRENT` when you create a new id.** Resolving an
existing id must not overwrite `CURRENT`.

## Inputs

- Plan file: `.agent-relay/plan-<id>.md` (use its `base:` ref when present)
- Implementation plan: `.agent-relay/implement-plan-<id>.md`. If
  `implement-plan-<id>/` exists, prefer listing via the claim helper over a
  possibly-stale rollup file.
- Implementation report: if `implement-report-<id>/` exists, prefer per-task
  files in that dir over the generated rollup. Otherwise read
  `.agent-relay/implement-report-<id>.md`.
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

1. Resolve `<id>` as above (write `CURRENT` only if you created the id). Read the
   plan, implementation plan, and implementation report first.

1. Inspect the actual changes with git. The diff is the source of truth; the
   implementation report may be incomplete or wrong.

1. Review for, in this order:

   - hidden bugs and logic errors
   - whether the implementation actually satisfies the plan's intent
   - conformance with project rules and existing conventions
   - code smells (only after the above)

   Scope rule: fix bugs and rule violations relative to the plan's intent, but
   do **not** enlarge scope beyond the plan.

1. If tests or a build step exist in this project, run them and report pass/fail.

1. Fix rules:

   - Fix **confirmed** bugs and rule violations directly.
   - For stylistic preferences that don't affect correctness, note them in the
     walkthrough instead of changing code.
   - If a fix requires deviating from the original plan, say so explicitly.

1. Upsert today's Self-Review section with the helper beside this skill (do not
   hand-edit other sections):

   ```bash
   TODAY="$(date +%F)"
   # body file must start with the provenance HTML comment, then the section body
   scripts/review-section.sh upsert \
     .agent-relay/review-report-<id>.md \
     Self-Review "$TODAY" body.md
   scripts/review-section.sh upsert \
     .agent-relay/review-walkthrough-<id>.md \
     Self-Review "$TODAY" walk-body.md
   ```

   Never remove `## Cross-Review` sections or Self-Review sections from other
   dates. The report lists issues found, what was fixed, what was left as a
   note, and test/build results. The walkthrough is a short narrative for the
   next reviewer.
