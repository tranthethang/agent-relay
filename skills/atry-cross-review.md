______________________________________________________________________

## name: atry-cross-review description: Second-opinion cross-review of an agent-relay change using plan.md, implement artifacts, and the prior Self-Review sections; append dated Cross-Review sections. Use when the user asks for a cross-check, second-opinion review, or final review in a different tool/model than the self-review.

# Cross-Review

You are the *second* reviewer, running in a different tool than whoever
implemented and self-reviewed this change. Your job is not to repeat the
previous review — it's to catch what a same-family model/tool is likely to miss.

## Inputs

- Plan file: `.agent-relay/plan.md`
- Implementation plan: `.agent-relay/implement-plan.md`
- Implementation report: `.agent-relay/implement-report.md`
- Prior review report: `.agent-relay/review-report.md`
- Prior review walkthrough: `.agent-relay/review-walkthrough.md`
- Full diff from the plan's `base:` git ref to the current tree. If `base:` is
  missing, use `git merge-base HEAD main` / `master` / the repo's default
  branch, or ask the user — do not review only the latest unstaged hunk.
- Project rules (same precedence as implement: `AGENTS.md`, then tool rules,
  then `CLAUDE.md` / similar)

## Instructions

1. Read the full chain (plan → implement plan/report → prior review) to
   understand both the original intent and what the previous reviewer already
   checked and fixed.

1. Diff from the plan `base:` (or the fallback above), not just uncommitted
   changes, so nothing from earlier in this task is hidden by a later, narrower
   diff.

1. Prioritize differently from the self-review step:

   - architecture- and intent-level issues over line-level style (the prior
     reviewer already did line-level review)
   - verify the prior reviewer's fixes are actually correct, not just present
   - check consistency with the rest of the codebase beyond the touched files
   - re-check anything the prior review explicitly left as a note or open risk

1. If tests or a build step exist, run them and report pass/fail — do not trust
   the prior review's test claims without re-running.

1. Fix rules (same as self-review): fix confirmed bugs/rule violations directly;
   note pure style disagreements without changing code; if you override a
   decision from the prior review, state why.

1. If you find the plan itself was ambiguous or wrong and the implementation
   correctly deferred or adjusted, do not just approve silently. Append an
   amendment to the plan (do not rewrite history) using:

   ```markdown
   ## Plan amendment — YYYY-MM-DD

   - What was wrong/ambiguous in the original plan
   - What was actually done instead
   - Why that should stick for future work
   ```

1. **Append** (do not overwrite) your findings to
   `.agent-relay/review-report.md` and `.agent-relay/review-walkthrough.md`
   using this exact heading form:

   ```markdown
   ## Cross-Review — YYYY-MM-DD

   ...
   ```

   Keep the prior `## Self-Review — ...` section intact above yours.
