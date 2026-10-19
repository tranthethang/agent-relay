## Parallel claim

Several sessions can work on one run. `atry claim <run> <task> --session <tag>`
writes `locks/<task>.lock` and starts the task. `atry release` removes that
lock when the session matches.

`claim` refuses a task when another session holds a lock whose `files` overlap.
The same session may hold overlapping tasks. `claim` does not stop edits
outside the recorded paths and does not create a worktree.

A task with deps stays unclaimable until each dep is `done` or `skipped`.
