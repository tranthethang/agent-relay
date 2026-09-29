## Parallel task implementation (optional)

Default implement/review skills use one shared markdown file for the plan
checklist (`implement-plan.md`) and one for the report (`implement-report.md`).
That is fine for a single agent.

When several agents update the **same** run `<RUN_ID>` at once, those shared
files tend to lose updates. An **opt-in** directory layout plus small bash
helpers avoid that for **status and per-task notes only**. They do not schedule
agents, create worktrees, or protect overlapping source-file edits. See
[Working-tree isolation](#working-tree-isolation).

### Directory format

Instead of hand-editing a single `implement-plan.md` or `implement-report.md`,
parallel mode uses `implement-plan/` and `implement-report/` inside the run
directory:

- `implement-plan/<task-id>.status` — three lines:
  ```text
  status: pending|in-progress|done|skipped (<reason>)
  desc: <short description>
  deps: <task-id-1> <task-id-2>
  ```
  `deps:` is optional; omit or leave empty for no dependencies. Tokens are
  whitespace-separated task ids in the same plan.
- `implement-plan/_meta.md` — free-text notes not tied to one task.
- `implement-plan.md` — a generated, read-only rollup file.
- `implement-report/<task-id>.md` — execution notes for a specific task.
- `implement-report/_meta.md` — shared architectural notes.
- `implement-report.md` — a generated, read-only rollup file of execution notes.

### `atry` task helpers (flattened)

The `atry` CLI (helpers in `scripts/runtime/`, installed to `~/.agent-relay`) manages atomic task claiming, status updates,
dependency validation, and rollup generation within the run directory. Ids and
task-ids must match `^[A-Za-z0-9._-]+$` (no path separators).

```bash
atry claim [--allow-skipped-deps] <run-dir-or-id> <task-id> <session-tag>
atry steal <run-dir-or-id> <task-id> <session-tag>
atry update [--session <tag>] <run-dir-or-id> <task-id> [<session-tag>] <status> [<reason>]
atry release [--force] [--session <tag>] <run-dir-or-id> <task-id> [<session-tag>]
atry list <run-dir-or-id>
atry rollup <run-dir-or-id>
atry check <run-dir-or-id>
atry report-write [--force] [--session <tag>] <run-dir-or-id> <task-id> [<session-tag>] <path-or-->
atry report-list <run-dir-or-id>
atry report-rollup <run-dir-or-id>
```

`--session <tag>` may appear after the verb for `update` / `release` /
`report-write` (before or among the positional args). An explicit `--session`
wins over a positional session-tag. Ambient `SESSION` / `SESSION_TAG`
environment variables are never used for auth.

- `claim`: Atomically creates `implement-plan/.lock-<task-id>` (`mkdir` is
  atomic on POSIX) under the per-task `.mutex-<task-id>` critical section.
  Verifies every `deps:` entry is exactly `done` before locking (`skipped` does
  **not** satisfy a dep unless `--allow-skipped-deps`). On success, writes
  `<session-tag> <ISO8601>` inside the lock and sets status to `in-progress`.
  On failure, prints the existing lock's owner + timestamp and exits non-zero.
  **Stale locks are not auto-stolen** — `claim` fails with a message naming the
  owner, lock age, and the `steal` command to run.
- `steal`: Intentional lock takeover. Serializes with the same per-task mutex,
  waiting a short bounded time for it (`AGENT_RELAY_STEAL_WAIT_MAX`, default
  5s) so unrelated contention does not abort a steal, and refusing if the lock
  owner changed while it waited — so two concurrent stealers still yield
  exactly one winner. Auto-steal after two hours was removed on purpose: an
  agent hung for two hours is a human decision, not a mechanism default.
- `update`: Under the task mutex, refuses if the caller's session-tag does not
  match the lock owner. Status must be one of `pending`, `in-progress`, `done`,
  `skipped`. `skipped` requires a reason; other statuses reject a trailing
  reason. Preserves `deps:`.
- `release`: Under the task mutex, removes the lock only if the caller session
  matches the owner, or with `--force` (prints a warning). Leaves `.status`
  untouched.
- `list`: Prints current state of all tasks. Pending tasks whose deps are unmet
  include a `[blocked: …]` suffix explaining why.
- `report-write`: Under the task mutex, requires the caller session to own the
  lock (or `--force`, which warns and appends `report-write-force` to
  `history.log`). Writes stdin (`-`) or a file to
  `implement-report/<task-id>.md` and regenerates the report rollup.
- `report-list`: Prints paths of per-task report files in plan order.
- `report-rollup`: Regenerates `implement-report.md`.
- `check`: Regenerates the expected plan/report rollups into temp files and
  compares them to what is on disk; prints `MISMATCH` and exits non-zero on
  drift (does not repair). See [task-claim.md](task-claim.md).
- Every state-changing plan subcommand regenerates the plan rollup as its last
  step.

### CLI resolution

Runtime helpers are the `atry` CLI installed under `~/.agent-relay/`
(`bin/atry` + `lib/*.sh`), with a PATH shim at `~/.local/bin/atry`. Skill
bundles ship `SKILL.md` and `references/`. Canonical sources in this repo:
`scripts/atry` and `scripts/runtime/`.

Prefer reading `implement-report/` (or `report-list`) over the generated
`implement-report.md` rollup when the directory exists.

### Working-tree isolation

The claim protocol serializes **task status**, not file contents:

| Scenario                                               | Safe?                                                                  |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| Different tasks, **disjoint** file sets, same worktree | Yes (protocol + skill scoping)                                         |
| Different tasks, overlapping files, same worktree      | No — git/content races; claim does not protect                         |
| One agent per git worktree/branch, then merge          | Yes (recommended when files overlap)                                   |
| Multiple features (different `<RUN_ID>`)               | Yes, completely isolated in separate `{YMD}-{RUN_ID}-{RUN_SLUG}/` dirs |

### Concurrency

| Scenario                                                          | Safe?                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------ |
| Multiple runs (different `<RUN_ID>`) in parallel                  | Yes                                                    |
| Multiple sub-agents, same `<RUN_ID>`, different tasks, via `atry` | Yes (for status/report; see isolation above for files) |
| Multiple sub-agents, same `<RUN_ID>`, same task                   | No — second claim fails loudly                         |
| Hand-editing `implement-plan.md` while parallel mode is active    | No — it's generated, gets overwritten                  |
