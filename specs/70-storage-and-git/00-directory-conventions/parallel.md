## Parallel claim

Several sessions can work on one run. `atry claim <run> <task> --session <tag>`
writes `locks/<task>.lock` and starts the task. `atry release` removes that
lock when the session matches.

`claim` refuses a task when another session holds a lock whose `files` overlap.
The same session may hold overlapping tasks. `claim` does not stop edits
outside the recorded paths.

With `worktree.enabled` set to false, `claim` does not create a worktree.
With `worktree.enabled` set to true, `claim` creates `<worktree.dir>/<run>/<task>`
and the branch `<run>-<task>`. The lock stores that path and that branch.
A failed claim removes both. `release` removes a clean worktree and its branch when
the run branch contains that branch. `release` keeps a worktree with changes or
unmerged commits. It prints the reason.
A claim result with `worktree.path` is where the task edits and commits belong.
Edit and commit in that path. Use `run.worktree.path` only when no task worktree
exists. `atry task start` does not create a task worktree. Use `atry claim` when
the run uses a task worktree.
A task worktree must be committed before `atry task done` and `atry integrate`.
`task done` exits 4 when the task worktree has uncommitted changes. The tool
does not commit. Run `git status` in the task worktree and commit there before
`atry task done`. A refused `task done` or `integrate` names the dirty worktree.
Commit there and retry.
`atry integrate <run> <task>` merges `<run>-<task>` into the run branch.
It refuses when a dependency is not done or skipped.
It refuses a dirty task worktree with exit 4, `merged: no`, and `worktree: kept`.
A conflict exits 4, keeps the worktree, and prints each path.
A clean merge removes the worktree and records a `run` `cleaned` event.
That event stores the task and the branch name.

## Parallel runs

With `worktree.enabled` set to `true`, each run has its own worktree and branch.
Several runs can be in implement at the same time. The tree, `base`, and scope
checks of one run do not see edits in another run's worktree. A claimed task
has its own worktree under that run. `atry integrate` merges that branch into
the run branch.

With worktree off, all runs share the main tree. `stage start implement`
refuses a tree with changes outside `.agent-relay/`. On a clean tree, it moves
`base` to `HEAD` and records a `run` `rebased` event with `ref` set to `HEAD`.
Finish or commit one run's work before another run starts implement.

A task with deps stays unclaimable until each dep is `done` or `skipped`.
