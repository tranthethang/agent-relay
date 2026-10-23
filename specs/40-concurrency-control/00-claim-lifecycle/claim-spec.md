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
   - When `worktree.enabled` is true, the lock also stores `path` and `branch`. The path is `<worktree.dir>/<run>/<task>`. The branch is `<run>-<task>`. A failed claim removes that worktree and that branch.
   - Appends `claimed` and `task-started`. Task status becomes `in-progress`.

2. **Releasing a Task**:
   ```bash
   atry release <run> <task> --session <tag>
   ```
   - Verifies the calling session owns the claim lock.
   - Unlinks `locks/<task>.lock`.
   - When the lock names a worktree, a clean tree is removed with its branch only when the run branch contains that branch. A tree with changes or unmerged commits is kept. The command prints the reason.
   - Clears `session` on the task. The status stays `in-progress`.

3. **Automatic Lock Drop**:
   - `atry task done` and `atry task skip` drop the task claim lock automatically upon completion.
   - Those commands do not remove the task worktree. `atry integrate` finds it from `worktree.dir`.
   - When a task worktree exists, `task done` diffs that worktree against its branch point.
   - The task worktree must be clean and committed. `task done` exits 4 with field `worktree` when the task worktree has uncommitted changes. The tool does not commit. Commit in the task worktree first.

4. **Integrate**:
   ```bash
   atry integrate <run> <task>
   ```
   - Rejects the merge when a dependency is not `done` or `skipped`.
   - Checks the task worktree before the merge. A dirty tree returns `merged: false` and `worktree: kept` with the reason `worktree has uncommitted changes; commit before integrate`. The command exits 4, merges nothing, and keeps the worktree.
   - Merges `<run>-<task>` into the run branch.
   - A conflict exits 4. The command aborts the merge, keeps the worktree, and prints each path.
   - A clean merge removes the worktree and its branch.
   - It records a `run` `cleaned` event. `task` is the task id. `ref` is the branch name.
