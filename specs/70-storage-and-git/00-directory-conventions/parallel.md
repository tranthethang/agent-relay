## Parallel claim

Several sessions can work on one run. `atry claim <run> <task> --session <tag>`
writes `locks/<task>.lock` and starts the task. `atry release` removes that
lock when the session matches.

`claim` refuses a task when another session holds a lock whose `files` overlap.
The same session may hold overlapping tasks. `claim` does not stop edits
outside the recorded paths and does not create a worktree.

## Parallel runs

With `worktree.enabled` set to `true`, each run has its own worktree and branch.
Several runs can be in implement at the same time. The tree, `base`, and scope
checks of one run do not see edits in another run's worktree. The sessions on
one run still share that run's worktree. The merge into the original branch is
manual.

With worktree off, all runs share the main tree. `stage start implement`
refuses a tree with changes outside `.agent-relay/`. On a clean tree, it moves
`base` to `HEAD` and records a `run` `rebased` event with `ref` set to `HEAD`.
Finish or commit one run's work before another run starts implement.

A task with deps stays unclaimable until each dep is `done` or `skipped`.
