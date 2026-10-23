# Task claim

`atry claim` is for several sessions on one run. It serializes task status
and refuses overlapping `files` entries. It does not schedule agents or create
worktrees.

```bash
atry list <run>
atry claim <run> T1 --session <tag>
atry release <run> T1 --session <tag>
atry steal <run> T1 --session <tag> --ttl <minutes>
```

A claim writes `locks/<task>.lock` and records `claimed` plus `task-started`.
Release removes the lock when the session matches. `task done` and `task skip`
also drop the lock when `--session` matches the owner.

With `worktree.enabled` true, `claim` creates one worktree and one branch for
the task. The task worktree must be committed before `task done` and
`integrate`. `task done` exits 4 when the task worktree has uncommitted changes.
`integrate` refuses a dirty task worktree with exit 4, `merged: no`, and
`worktree: kept`. The tool does not commit for the agent. Commit in the task
worktree first.

Overlap uses the `files` list from `10-plan/index.json`. A directory path
overlaps a file under it. The same session may hold both. A different session
gets exit code 5 and no lock file.

`atry list` shows status, owner, and blocked deps. A task stays blocked until
every dep is `done` or `skipped`.

The sessions share one working tree. `task done` diffs the tree recorded at
start with the current tree. A path outside that task's `files` refuses unless
`--allow-extra <reason>` is set. A path covered by another in-progress task's
`files` does not count. A directory entry covers every path under it. Paths
under `.agent-relay/` do not count.

`atry guard <run> <path> [--session <tag>]` answers before an edit. It exits 0
when the path is under `.agent-relay/` or inside an in-progress task. With
`--session`, only that session's task counts. Otherwise it exits 4. It reads
events and `index.json`. It does not hash the tree. A tool hook can call it
later. This repo does not ship the hook.
