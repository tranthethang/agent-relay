# Worktree isolation

Worktree isolation remains off by default. Set `"worktree": { "enabled": true }` in `.agent-relay.json` and commit it.
`run new` reads policy at `HEAD`, so an uncommitted change has no effect.
`worktree.dir` sets the folder for worktrees. A relative `dir` resolves from
the git root. It cannot point to the git root or any folder inside the repo.
Without `dir`, the folder is `<repo>_work-tree` next to the repo.

`run new` exclusively reserves the run directory name. A failure during run
setup rolls back the symlink, the worktree, and the branch.
With worktree on, `run new` runs `git worktree add -b <run> <dir>/<run> HEAD`.
`HEAD` must be on a branch. `run.json` records the worktree path and the
original branch. The worktree gets `.agent-relay` as a link to the main repo
folder (a junction on Windows), and `.agent-relay` goes into the shared
`info/exclude`. Work, commit, and run `atry` in that worktree. Every git check
for the run uses the worktree. `atry context --json` shows `run.worktree`.

`stage start implement` checks the worktree before work begins. It verifies
that the worktree directory exists, is registered with Git, is not detached,
and matches the run branch.

The merge stays manual. Merge the run branch into the original branch before
`close`. `close` removes the worktree only when the run branch is an ancestor
of the original branch and the worktree has no uncommitted changes. Otherwise it
keeps the worktree and says why. If removal fails, `close` keeps the run closed
and reports `worktree: kept (<reason>)`. A successful removal records a `cleaned`
run event. `atry worktree cleanup [run]` retries removal on a closed run.
A squash merge does not make the run branch an ancestor. `close` never deletes
the run branch, and the run history stays in the main repo. Ignored files
remain outside this change.

With worktree off, `stage start implement` refuses a tree with changes outside
`.agent-relay/`. On a clean tree, it moves `base` to `HEAD` and records a `run`
`rebased` event.
