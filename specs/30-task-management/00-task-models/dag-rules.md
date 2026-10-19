# DAG Dependency Rules

Task execution adheres to strict Directed Acyclic Graph (DAG) invariants (`src/core/plan.ts`):

## Invariants

1. **Topological Ordering**:
   - Tasks receive sequential identifiers: `T1`, `T2`, ..., up to `T8`.
   - A task's `deps` array may only reference earlier task identifiers (e.g. `T3` may depend on `T1` or `T2`, but never on `T3`, `T4`, or later).
   - This rule mathematically guarantees that circular dependencies cannot occur.

2. **Maximum Task Limit**:
   - A single run may declare at most eight (8) tasks (`T1` through `T8`).
   - If a proposed plan requires more than eight tasks, the agent must ask the human to decompose the scope into multiple distinct runs.

3. **Relative File Paths**:
   - All entries in `files` must be repository-relative clean paths using forward slashes (`/`).
   - Absolute paths or paths with directory traversal (`../`) are rejected.
