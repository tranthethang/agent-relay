# Parallel task helpers (`atry` claim / `atry task-init`)

Optional protocol for several agents sharing one run `<id>`. Default implement
flow stays sequential (single `implement-plan.md` / `implement-report.md` inside
the run folder).

Canonical sources: `scripts/atry` + `scripts/runtime/task-init.sh` /
`scripts/runtime/task-claim.sh` (invoked as flattened `atry …` verbs). Skill
bundles do not ship `scripts/`. Coverage: `tests/tasks.sh`.

Artifact layout and status field semantics:
[file-conventions.md](file-conventions.md) (sections on parallel mode).

## When to use

- Multiple agents update **status / per-task reports** for the same `<id>`
- File sets for those tasks are **disjoint**, or each agent has its own
  worktree/branch

Do **not** rely on this protocol to serialize overlapping edits to the same
source files — it does not.

## Initialize

From the target repo (walks up to find `.agent-relay/`):

```bash
atry task-init <id>
```

Creates `implement-plan/` (`*.status`, `.order`, optional `_meta.md`) and
generates `implement-plan.md` as a rollup. `task-init` refuses if the rollup
file already exists. Invalid checkbox statuses, invalid dependency ids, and
dependency cycles refuse the plan and remove the partially written
`implement-plan/` so a later re-init is not blocked.

## Task state machine

Per-task status values (whitelist):

| Status             | Meaning                                      |
| ------------------ | -------------------------------------------- |
| `pending`          | Not started; may be blocked on deps          |
| `in-progress`      | Claimed (or stolen); an agent holds the lock |
| `done`             | Finished                                     |
| `skipped (reason)` | Waived; reason required                      |

Typical transitions under the lock:

```text
pending --claim/steal--> in-progress --update--> done | skipped | pending | in-progress
                         in-progress --release--> (status unchanged; lock removed)
```

`claim` / `steal` set `in-progress`. `update` may set any whitelisted status while
the caller's session owns the lock. `release` drops the lock only; it does not
change `.status`.

## Ownership and mutation invariant

**At most one mutation runs per task at a time.** Every `claim`, `steal`,
`update`, `release`, and `report-write` acquires a per-task `mkdir` mutex
(`implement-plan/.mutex-<task-id>/`) before touching the ownership lock or
status file, then releases it before regenerating rollups.

| Artifact            | Role                                                                            |
| ------------------- | ------------------------------------------------------------------------------- |
| `.mutex-<task-id>/` | Short-lived critical-section mutex (`owner_pid`, `owner_host`, `created_epoch`) |
| `.lock-<task-id>/`  | Session ownership (`owner` + `created_epoch`)                                   |

Stale mutex recovery uses the **recorded** epoch age plus pid liveness: a live
slow holder is never evicted because a waiter has been blocked for N seconds.
The old `.lock-steal-<task-id>` directory is gone.

### Single-host assumption

A pid is only evidence on the machine that recorded it, so every mutex also
records `owner_host` (`uname -n`) and recovery has two branches:

| Recorded host              | Reclaim rule                                                 | Default |
| -------------------------- | ------------------------------------------------------------ | ------- |
| Same as this machine       | Owner pid dead **and** recorded age ≥ `MUTEX_STALE_AGE`      | 10s     |
| Different, or not recorded | Recorded age ≥ `MUTEX_FOREIGN_STALE_AGE`; the pid is ignored | 900s    |

agent-relay assumes the agents working one run share a machine. Sharing a run
directory across machines (a network filesystem, separate containers) still
works, but staleness detection there is best effort: a dead peer's mutex blocks
that task for the long timer instead of 10s, and clock skew between the hosts
shifts `created_epoch` comparisons. Nothing is reclaimed on a foreign pid, so
the failure mode is a mutation that times out and says so — not two writers in
one critical section. Override either threshold with
`AGENT_RELAY_MUTEX_STALE_AGE` / `AGENT_RELAY_MUTEX_FOREIGN_STALE_AGE`.

### How `steal` serializes

`steal` waits for the mutex on a short budget (`STEAL_WAIT_MAX`, default 5s,
override `AGENT_RELAY_STEAL_WAIT_MAX`) rather than failing the moment it is
busy — every critical section is a few small writes, so that budget absorbs
incidental contention from an unrelated `claim`, `update`, or `release`.

The "exactly one stealer wins" rule is enforced separately, by compare-and-swap
on the lock owner: `steal` reads the owner it intends to take over from before
entering the mutex, and refuses inside if that owner has changed. Two
concurrent stealers therefore still produce exactly one winner — the loser
exits non-zero with `was already taken over by …` — while a steal that merely
overlapped an unrelated mutation now succeeds instead of aborting.

## `task-claim.sh` subcommands

```text
task-claim.sh [--session <tag>] <subcommand> ...

  claim  [--allow-skipped-deps] <id> <task-id> <session-tag>
  steal  <id> <task-id> <session-tag>
  update [--session <tag>] <id> <task-id> [<session-tag>] <status> [<reason>]
  release [--force] [--session <tag>] <id> <task-id> [<session-tag>]
  list   <id>
  check  <id>
  report-write [--force] [--session <tag>] <id> <task-id> [<session-tag>] <path-or-->
  report-list  <id>
  report-rollup <id>
```

| Command        | Behavior                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claim`        | Under task mutex: re-check deps, atomic `mkdir` ownership lock; deps must be exactly `done` (`skipped` does not count unless `--allow-skipped-deps`); sets status `in-progress` |
| `steal`        | Intentional lock takeover under the same task mutex: short bounded wait plus compare-and-swap on the lock owner. **No** auto-steal by age                                       |
| `update`       | Under task mutex: session must match lock owner; status whitelist `pending` \| `in-progress` \| `done` \| `skipped` (`skipped` needs a reason)                                  |
| `release`      | Under task mutex: drop lock if session matches, or `--force`                                                                                                                    |
| `list`         | Print tasks; pending + unmet deps get `[blocked: …]`                                                                                                                            |
| `rollup`       | Regenerate the plan rollup on demand. Every state-changing subcommand above already does this as its last step, so this is mostly for manual recovery                           |
| `check`        | Regenerate expected rollups into temps beside the plan/report dirs; `cmp` to on-disk rollups; `MISMATCH` → exit non-zero. **Does not repair**                                   |
| `report-write` | Under task mutex: session must own the lock (or `--force`, which appends `report-write-force` to `history.log`); writes per-task report + report rollup                         |
| `report-*`     | Per-task report files + generated `implement-report.md`                                                                                                                         |

`--session` may appear before the subcommand or (for `update`/`release`/
`report-write`) after it. Ambient `SESSION` / `SESSION_TAG` env vars are
**never** used for auth.

Ids and task-ids must match `^[A-Za-z0-9._-]+$` (no path separators). Dependency
ids use the same rule at `task-init` parse time; expansion in `deps_satisfied`
disables pathname globbing.

## Locks

- Per-task ownership: `implement-plan/.lock-<task-id>/` (`mkdir` is the mutex)
- Per-task mutation mutex: `implement-plan/.mutex-<task-id>/`
- Owner file records `session-tag` + timestamp
- Stale ownership locks: `claim` fails and prints the `steal` command — human/agent
  decision, not a timer
- Rollup locks use the same recorded-age + pid-liveness recovery as task mutexes
  (not “waited 5s → steal”)

## `check` and rollup drift

Hand-editing `implement-plan.md` while the directory exists desyncs
`.status` files from the rollup (seen in real runs). `check` compares
**content** (what regenerate would produce) to the on-disk rollup — not mtime.

If `implement-plan/` exists, `atry-implement` skill text requires using
`task-claim.sh` for further status/report writes. That is instruction only;
nothing filesystem-locks the rollup `.md` against editors.

## Isolation summary

| Scenario                                                | Safe for status/report?                                     |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| Different tasks, disjoint source files, one worktree    | Yes                                                         |
| Different tasks, overlapping source files, one worktree | No                                                          |
| One agent per worktree/branch, then merge               | Yes (recommended when files overlap)                        |
| Two agents `claim` the same task                        | No — second fails loudly                                    |
| Concurrent `steal` vs `release` on one task             | Serialized by task mutex; release cannot be silently undone |
