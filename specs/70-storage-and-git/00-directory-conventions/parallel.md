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
`atry integrate <run> <task>` merges `<run>-<task>` into the run branch.
It refuses when a dependency is not done or skipped.
A conflict exits 4, keeps the worktree, and prints each path.
A clean merge removes the worktree and records a `run` `cleaned` event.
That event stores the task and the branch name.
A dirty worktree stays after the merge. The command prints the reason and skips that event.

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
