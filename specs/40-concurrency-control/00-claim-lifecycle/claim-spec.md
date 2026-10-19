# Task Claim Specification

The claim subsystem (`src/core/claim.ts`) enables multiple agent sessions to work concurrently on non-overlapping tasks within a single run.

## Mechanics

1. **Claiming a Task**:
   ```bash
   atry claim <run> <task> --session <tag>
   ```
   - Rejects the claim when a dependency is not `done` or `skipped`.
   - Evaluates the task's `files` against all currently held task locks using the overlap algorithm.
   - If clear, writes `locks/<task>.lock` with `schema`, `session`, `pid`, `host`, and `ts` (UTC timestamp). The start tree hash is on the `task-started` event, not in the lock file.
   - Appends `claimed` and `task-started`. Task status becomes `in-progress`.

2. **Releasing a Task**:
   ```bash
   atry release <run> <task> --session <tag>
   ```
   - Verifies the calling session owns the claim lock.
   - Unlinks `locks/<task>.lock`.
   - Clears `session` on the task. The status stays `in-progress`.

3. **Automatic Lock Drop**:
   - `atry task done` and `atry task skip` drop the task claim lock automatically upon completion.
