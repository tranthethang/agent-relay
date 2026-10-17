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

Overlap uses the `files` list from `10-plan/index.json`. A directory path
overlaps a file under it. The same session may hold both. A different session
gets exit code 5 and no lock file.

`atry list` shows status, owner, and blocked deps. A task stays blocked until
every dep is `done` or `skipped`.
