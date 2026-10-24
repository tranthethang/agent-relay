# Parallel tasks

Claim, release, and integrate verbs. The lock and overlap rules are in
[`claim-spec.md`](../00-claim-lifecycle/claim-spec.md).

```bash
atry claim <run> T1 --session <tag>
atry release <run> T1 --session <tag>
atry integrate <run> T1
atry list <run>
```

`claim` refuses a task whose `files` overlap a lock held by another session.
With worktree off, `claim` does not create a worktree.
With worktree on, `claim` creates one worktree and one branch for the task.
The lock stores the path and the branch. A failed claim removes both.
`release` removes a clean worktree and its branch when the run branch contains that branch.
`release` keeps a worktree that has changes or unmerged commits. It prints the reason.
A task worktree must be committed before `atry task done` and before `atry integrate`.
`task done` exits 4 and names `worktree` when the task worktree has uncommitted changes.
The tool does not commit for the agent. Commit in the task worktree first.
`atry integrate` merges that branch into the run branch after each dependency is done or skipped.
A conflict exits 4, keeps the worktree, and prints each path.
A clean merge removes the worktree and records a `run` `cleaned` event with the task and the branch.
A dirty task worktree refuses the merge with exit 4, prints `merged: no` and
`worktree: kept`, and skips the cleaned event. Nothing merges until the agent commits.
`atry next` recommends integrate after the task is done while that worktree remains.
`task done` ignores
a path that another in-progress task's `files` covers. `atry guard <run> <path>`
exits 0 when that path is inside an in-progress task. `--session <tag>` limits
the check to that session.
