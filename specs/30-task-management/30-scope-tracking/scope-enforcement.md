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
   - With `strict.scope: true`, a path outside those sets throws `RelayError("gate", ...)` and the process exits `4`.
   - With `strict.scope: false`, the command reports a warning, records the paths and reason in `events.jsonl`, and continues.
   - Later implement integrity checks treat recorded extra paths as covered.

2. **The `--allow-extra` Override**:
   - In strict mode, an unexpected file modification requires `--allow-extra <reason>` after the developer confirms it.
   - The CLI appends accepted extra paths and the reason to `events.jsonl`.
   - In non-strict mode, the CLI records the warning and continues without asking for a reason.
