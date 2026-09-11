# File conventions

Skills read and write files under `.agent-relay/` in the target repo. One run
uses one id on every file so two features do not overwrite each other. Nothing
in this repo enforces the names except the skill text.

| Purpose | Path | Written by |
| --- | --- | --- |
| Plan | `.agent-relay/plan-<id>.md` | You, or a planning tool. Not a skill in this repo. |
| Task list | `.agent-relay/implement-plan-<id>.md` | `atry-implement` |
| Implement notes | `.agent-relay/implement-report-<id>.md` | `atry-implement` |
| Review report | `.agent-relay/review-report-<id>.md` | `atry-self-review` creates or overwrites. `atry-cross-review` appends. |
| Review walkthrough | `.agent-relay/review-walkthrough-<id>.md` | Same as the review report. |
| Active id | `.agent-relay/CURRENT` | Any stage after it resolves or creates an id. |

`<id>` is 10 characters from `A-Za-z0-9_-`. The same id is used for all five
role files.

Empty templates are in [`templates/`](../templates/). They are not a completed
run. Runtime files must use the `-<id>` suffix. The templates keep short names
so the links stay stable.

## CURRENT

`.agent-relay/CURRENT` is one line: the active id, trimmed, no quotes. A stage
overwrites it after it resolves or creates an id.

Skills resolve the id in this order. They are told not to use mtime:

1. The user passed a plan path or an id. From a path, take the id with
   `^plan-(.+)\.md$`.
2. Else read `.agent-relay/CURRENT`.
3. Else if exactly one `plan-*.md` exists, take the id from that name.
4. Else ask. Do not guess.

## Plan header

`plan-<id>.md` should start with the git ref you will diff from, and the id:

```markdown
base: <git-ref>
id: <id>

# <title>
```

If those lines are missing, `atry-implement` is instructed to add them before
coding. `base` should be a real ref in that repo (`HEAD` before the work, or
the branch tip). Do not invent one.

## Review headings

Self-review creates or replaces that day's section in each review file:

```markdown
## Self-Review — YYYY-MM-DD
```

If run again on the same day, it replaces only that section. Cross-review
appends and must not remove the self-review section:

```markdown
## Cross-Review — YYYY-MM-DD
```

## Legacy names

If `.agent-relay/plan.md` exists and no `plan-*.md` exists, a skill may read
the unsuffixed set once (`implement-plan.md`, and so on). New writes go to
`*-<id>.md` and `CURRENT`. Do not create new unsuffixed names.

## Parallel task implementation (optional)

When multiple sub-agents implement tasks of the same run `<id>` concurrently,
agent-relay supports an opt-in directory format to prevent lost updates on
`implement-plan-<id>.md`.

### Directory format

Instead of a single hand-edited `implement-plan-<id>.md` file, the run uses a
directory `.agent-relay/implement-plan-<id>/`:

- `implement-plan-<id>/<task-id>.status` — exactly two lines:
  ```text
  status: pending|in-progress|done|skipped (<reason>)
  desc: <short description>
  ```
- `implement-plan-<id>/_meta.md` — free-text notes not tied to one task.
- `implement-plan-<id>.md` — a generated, read-only rollup file in the standard
  format (`- [<status>] <task id>: <desc>` per line), regenerated on every state change.

### `task-claim.sh` contract

The script `scripts/task-claim.sh` manages atomic task claiming, status updates,
and rollup generation:

```bash
task-claim.sh claim <id> <task-id> <session-tag>
task-claim.sh update [--session <tag>] <id> <task-id> [<session-tag>] <status> [<reason>]
task-claim.sh release <id> <task-id>
task-claim.sh list <id>
```

- `claim`: Atomically creates `implement-plan-<id>/.lock-<task-id>` (`mkdir` is atomic on POSIX). On success, writes `<session-tag> <ISO8601>` inside it and sets the task's status to `in-progress`. On failure, prints the existing lock's owner + timestamp and exits non-zero. A stale lock older than 2 hours is loudly stolen.
- `update`: Refuses if the caller's session-tag does not match the lock owner, failing loudly.
- `release`: Removes the lock directory only, leaving `.status` untouched.
- `list`: Prints current state of all tasks (`- [<status>] <task-id>: <desc>`).
- Every state-changing subcommand regenerates the rollup file as its last step.

### Concurrency

| Scenario | Safe? |
|---|---|
| Multiple runs (different `<id>`) in parallel | Yes |
| Multiple sub-agents, same `<id>`, different tasks, via `task-claim.sh` | Yes |
| Multiple sub-agents, same `<id>`, same task | No — second claim fails loudly |
| Hand-editing `implement-plan-<id>.md` while parallel mode is active | No — it's generated, gets overwritten |

### Migration

Legacy single-file runs (`implement-plan-<id>.md`) keep working un-migrated in
the default sequential mode. Run `scripts/task-init.sh <id> --migrate` only when
switching an existing sequential run to parallel mode. This converts the single
file into the directory format, preserves all current statuses, and preserves the
original file as `implement-plan-<id>.md.bak`. Plain `task-init.sh <id>` (no
`--migrate`) refuses if the legacy rollup file already exists, so sequential
progress is not overwritten.

## Notes

- Put the plan at `.agent-relay/plan-<id>.md` and set `CURRENT` before
  `atry-implement`.
- Commit `.agent-relay/` if you want the notes on the branch. Otherwise add
  the directory to `.gitignore`. This repo does not choose for you.
  `bin/install.sh` prints that reminder.
- The id commands in the skills are suggestions. `npx --yes nanoid@5` needs
  network and npm. The `openssl` fallback strips characters and can be shorter
  than 10. Either way, use the same id on every file for that run.

