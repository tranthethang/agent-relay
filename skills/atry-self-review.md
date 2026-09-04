______________________________________________________________________

## name: atry-self-review description: Self-review code produced from .agent-relay/plan.md using implement-plan.md and implement-report.md; fix confirmed bugs; write dated sections in review-report.md and review-walkthrough.md. Use after an agent-relay implement step, or when the user asks to self-review that implementation — not for unrelated refactors.

# Self-Review

You are reviewing code that a (possibly different, possibly weaker) model just
implemented from a plan. Treat the implementation report as a claim to verify,
not a fact.

## Inputs

- Plan file: `.agent-relay/plan.md` (use its `base:` ref when present)
- Implementation plan: `.agent-relay/implement-plan.md`
- Implementation report: `.agent-relay/implement-report.md`
- Current uncommitted changes (`git status` / `git diff`). If the work was
  already committed, diff from the plan's `base:` ref (or ask the user) so you
  still see the full change — not only the latest unstaged hunk.
- Project rules (same precedence as implement: `AGENTS.md`, then tool rules,
  then `CLAUDE.md` / similar)

## Instructions

1. Read the plan, implementation plan, and implementation report first — you need
   the original intent, not just the diff.

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

1. Write `.agent-relay/review-report.md` and `.agent-relay/review-walkthrough.md`.
   Create or overwrite each file with a single dated section (use today's date):

   ```markdown
   ## Self-Review — YYYY-MM-DD

   ...
   ```

   The report lists issues found, what was fixed, what was left as a note, and
   test/build results. The walkthrough is a short narrative of what changed and
   why, written for the next reviewer (who may be a different tool).
