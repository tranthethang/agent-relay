# Scope Enforcement

Scope enforcement (`src/core/lifecycle.ts` and `src/core/plan.ts`) guarantees that agents edit only files declared in their tasks.

## Enforcement Mechanism

1. When `atry task done <run> <task>` runs:
   - Diffs the current working tree against the tree captured at `task start`.
   - Identifies all paths with additions, modifications, or deletions.
   - Ignores paths under `.agent-relay/`.
   - Compares the other paths with:
     - The current task's `files` list.
     - Files of other tasks that are `in-progress`.
     - Files of tasks that became `done` after this task's latest `task-started` or `stolen` event.
   - A path outside those sets throws `RelayError("gate", ...)` and the process exits `4`.

2. **The `--allow-extra` Override**:
   - If an unexpected file modification was legitimately required (such as generated build artifacts or configuration adjustments), the agent must pass `--allow-extra <reason>`.
   - The CLI appends the allowed extra paths and reason to `events.jsonl`.
   - The reason must also be documented in `20-implement/T<n>.md`.
