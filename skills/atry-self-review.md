---
name: atry-self-review
description: Self-review code produced from .agent-relay/plan-<id>.md using implement-plan-<id>.md and implement-report-<id>.md; fix confirmed bugs; write dated sections in review-report-<id>.md and review-walkthrough-<id>.md. Use after an agent-relay implement step, or when the user asks to self-review that implementation — not for unrelated refactors.
---

# Self-Review

You are reviewing code that a (possibly different, possibly weaker) model just
implemented from a plan. Treat the implementation report as a claim to verify,
not a fact.

## Run discovery

Resolve the shared run `<id>` before reading or writing artifacts (see
`docs/file-conventions.md`). Order:

1. User gave a plan path or run id → use that id
1. Else read `.agent-relay/CURRENT` (one trimmed line)
1. Else if exactly one `plan-*.md` → extract id from `^plan-(.+)\.md$`
1. Else ask the user — do not guess by mtime

Legacy unsuffixed names (`plan.md`, etc.) are only allowed when no `plan-*.md`
exists; after review, write suffixed review files and set `CURRENT`.

After resolving an id, write/overwrite `.agent-relay/CURRENT` with that id.

## Inputs

- Plan file: `.agent-relay/plan-<id>.md` (use its `base:` ref when present)
- Implementation plan: `.agent-relay/implement-plan-<id>.md`
- Implementation report: `.agent-relay/implement-report-<id>.md`
- Current uncommitted changes (`git status` / `git diff`). If the work was
  already committed, diff from the plan's `base:` ref (or ask the user) so you
  still see the full change — not only the latest unstaged hunk.
- Project rules (same precedence as implement: `AGENTS.md`, then tool rules,
  then `CLAUDE.md` / similar)

## Instructions

1. Resolve `<id>` (and update `CURRENT`) as above. Read the plan, implementation
   plan, and implementation report first — you need the original intent, not just
   the diff.

1. Inspect the actual changes with git. The diff is the source of truth; the
   implementation report may be incomplete or wrong.

1. Review for, in this order:

   - hidden bugs and logic errors
   - whether the implementation actually satisfies the plan's intent (not just
     its literal wording)
   - conformance with project rules and existing conventions
   - code smells (only after the above)

   Scope rule: you may fix bugs and rule violations relative to the plan's
   intent, but do **not** enlarge scope beyond the plan. If intent and literal
   wording conflict, prefer intent and say so explicitly in the report.

1. If tests or a build step exist in this project, run them and report pass/fail.
   Do not rely on static reading alone to declare the code correct.

1. Fix rules:

   - Fix **confirmed** bugs and rule violations directly. "Confirmed" means you
     can point to a failing test/build, a concrete repro, or a clear incorrect
     code path — not a vague suspicion.
   - For stylistic preferences that don't affect correctness, note them in the
     walkthrough instead of changing code — do not churn the diff on taste.
   - If a fix requires deviating from the original plan, say so explicitly and
     explain why — do not silently diverge.

1. Write `.agent-relay/review-report-<id>.md` and
   `.agent-relay/review-walkthrough-<id>.md`. Create or overwrite each file with
   a single dated section (use today's date):

   ```markdown
   ## Self-Review — YYYY-MM-DD

   ...
   ```

   The report lists issues found, what was fixed, what was left as a note, and
   test/build results. The walkthrough is a short narrative of what changed and
   why, written for the next reviewer (who may be a different tool).
