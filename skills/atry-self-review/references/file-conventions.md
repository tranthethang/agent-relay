# File conventions

Skills read and write files under `.agent-relay/` in the target repo. One run
uses one id on every file so two features do not overwrite each other. Nothing
in this repo enforces the names except the skill text.

This file is the **source of truth** for those names. Maintainer docs that
point here (architecture, task-claim, skill authoring, …):
[`INDEX.md`](INDEX.md). Do not hand-edit the copies under
`skills/*/references/` — run `bash scripts/sync-references.sh` from the repo
root after changing this file.

| Purpose | Path | Written by |
| --- | --- | --- |
| Plan | `.agent-relay/plan-<id>.md` | You, or `atry-plan`. |
| Task list | `.agent-relay/implement-plan-<id>.md` (or `implement-plan-<id>/` in parallel mode) | `atry-implement` |
| Implement notes | `.agent-relay/implement-report-<id>.md` (or `implement-report-<id>/` in parallel mode) | `atry-implement` |
| Review report | `.agent-relay/review-report-<id>.md` | `atry-self-review` creates or overwrites. `atry-cross-review` appends. |
| Review walkthrough | `.agent-relay/review-walkthrough-<id>.md` | Same as the review report. |
| Active id | `.agent-relay/CURRENT` | Written only when a stage **creates** a new id. |

`<id>` is 10 characters from `A-Za-z0-9_-`. The same id is used for all five
role files.

Empty templates are in [`templates/`](../templates/). They are not a completed
run. Runtime files must use the `-<id>` suffix. The templates keep short names
so the links stay stable.

## CURRENT

`.agent-relay/CURRENT` is one line: the active id, trimmed, no quotes. A stage
writes it **only when it creates a new id**. Resolving an existing id (from the
user, from `CURRENT`, or from a single `plan-*.md`) must not overwrite
`CURRENT` — that was overwriting an in-progress feature's pointer.

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

Default implement/review skills still use one shared markdown file for the
plan checklist and one for the report. That is fine for a single agent.

When several agents update the **same** run `<id>` at once, those shared files
tend to lose updates. An **opt-in** directory layout plus small bash helpers
avoid that for **status and per-task notes only**. They do not schedule agents,
create worktrees, or protect overlapping source-file edits. See
[Working-tree isolation](#working-tree-isolation).

### Directory format

Instead of hand-editing a single `implement-plan-<id>.md` or
`implement-report-<id>.md`, parallel mode uses
`.agent-relay/implement-plan-<id>/` and `.agent-relay/implement-report-<id>/`:

- `implement-plan-<id>/<task-id>.status` — three lines:
  ```text
  status: pending|in-progress|done|skipped (<reason>)
  desc: <short description>
  deps: <task-id-1> <task-id-2>
  ```
  `deps:` is optional; omit or leave empty for no dependencies. Tokens are
  whitespace-separated task ids in the same plan.
- `implement-plan-<id>/_meta.md` — free-text notes not tied to one task.
- `implement-plan-<id>.md` — a generated, read-only rollup file.
- `implement-report-<id>/<task-id>.md` — execution notes for a specific task.
- `implement-report-<id>/_meta.md` — shared architectural notes.
- `implement-report-<id>.md` — a generated, read-only rollup file of execution notes.

### `task-claim.sh` contract

The script `scripts/task-claim.sh` manages atomic task claiming, status updates,
dependency validation, and rollup generation. Ids and task-ids must match
`^[A-Za-z0-9._-]+$` (no path separators).

```bash
task-claim.sh [--session <tag>] <subcommand> ...
task-claim.sh claim [--allow-skipped-deps] <id> <task-id> <session-tag>
task-claim.sh steal <id> <task-id> <session-tag>
task-claim.sh update [--session <tag>] <id> <task-id> [<session-tag>] <status> [<reason>]
task-claim.sh release [--force] [--session <tag>] <id> <task-id> [<session-tag>]
task-claim.sh list <id>
task-claim.sh rollup <id>
task-claim.sh report-write <id> <task-id> <path-or-->
task-claim.sh report-list <id>
task-claim.sh report-rollup <id>
```

`--session <tag>` may appear before the subcommand or (for `update`/`release`)
after it. An explicit `--session` wins over a positional session-tag. Ambient
`SESSION` / `SESSION_TAG` environment variables are never used for auth.

- `claim`: Atomically creates `implement-plan-<id>/.lock-<task-id>` (`mkdir` is
  atomic on POSIX). Verifies every `deps:` entry is exactly `done` before
  locking (`skipped` does **not** satisfy a dep unless `--allow-skipped-deps`).
  On success, writes `<session-tag> <ISO8601>` inside the lock and sets status
  to `in-progress`. On failure, prints the existing lock's owner + timestamp
  and exits non-zero. **Stale locks are not auto-stolen** — `claim` fails with
  a message naming the owner, lock age, and the `steal` command to run.
- `steal`: Intentional lock takeover. Serializes the critical section with
  `mkdir …/.lock-steal-<task-id>` (try-once mutex; a concurrent stealer exits
  non-zero immediately). Auto-steal after two hours was removed on purpose:
  an agent hung for two hours is a human decision, not a mechanism default.
- `update`: Refuses if the caller's session-tag does not match the lock owner.
  Status must be one of `pending`, `in-progress`, `done`, `skipped`. `skipped`
  requires a reason; other statuses reject a trailing reason. Preserves `deps:`.
- `release`: Removes the lock only if the caller session matches the owner, or
  with `--force` (prints a warning). Leaves `.status` untouched.
- `list`: Prints current state of all tasks. Pending tasks whose deps are unmet
  include a `[blocked: …]` suffix explaining why.
- `report-write`: Writes stdin (`-`) or a file to
  `implement-report-<id>/<task-id>.md` and regenerates the report rollup.
- `report-list`: Prints paths of per-task report files in plan order.
- `report-rollup`: Regenerates `implement-report-<id>.md`.
- Every state-changing plan subcommand regenerates the plan rollup as its last
  step. Base dir is found by walking up from cwd for `.agent-relay/` (stops at
  `/` or the git root), so running from a subdirectory does not create a second
  `.agent-relay/`.

### Script resolution

Helpers ship **inside each installed skill bundle** as `scripts/` next to
`SKILL.md` (for example `~/.cursor/skills/atry-implement/scripts/task-claim.sh`).
Call them by path relative to the skill directory. There is no
`~/.agent-relay/scripts/` indirection and no `resolve-task-bin.sh`.

Prefer reading `implement-report-<id>/` (or `report-list`) over the generated
`implement-report-<id>.md` rollup when the directory exists.

### Working-tree isolation

The claim protocol serializes **task status**, not file contents:

| Scenario | Safe? |
|---|---|
| Different tasks, **disjoint** file sets, same worktree | Yes (protocol + skill scoping) |
| Different tasks, overlapping files, same worktree | No — git/content races; claim does not protect |
| One agent per git worktree/branch, then merge | Yes (recommended when files overlap) |
| Multiple features (different `<id>`) and `CURRENT` | Safe if stages only write `CURRENT` when creating an id; pass an explicit id when switching features |

### Concurrency

| Scenario | Safe? |
|---|---|
| Multiple runs (different `<id>`) in parallel | Yes |
| Multiple sub-agents, same `<id>`, different tasks, via `task-claim.sh` | Yes (for status/report; see isolation above for files) |
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

## Review notes worth flagging explicitly

Reviewers (`atry-self-review`, `atry-cross-review`) routinely touch package
manager files as part of a change. Two are worth calling out by name in the
review report's notes rather than only mentioning in passing, because they
tend to recur silently across runs otherwise:

- **Dual lockfiles.** A diff that updates more than one lockfile for the same
  package manager ecosystem (for example both `pnpm-lock.yaml` and
  `package-lock.json`) for a project whose own rules (e.g. `AGENTS.md`) name
  one preferred package manager is a maintenance smell: the second lockfile
  drifts the moment someone forgets to update it by hand. Note it explicitly
  in the review report even if fixing it is out of scope for the current
  plan.
- **Directory/rollup drift.** If `implement-plan-<id>/` or
  `implement-report-<id>/` exists for the run under review, run
  `scripts/task-claim.sh check <id>` before writing the review. A
  `MISMATCH` means the rollup `.md` was hand-edited outside the claim
  protocol and the per-task `.status`/report files are stale — call this out
  in the review rather than treating the rollup `.md` as ground truth.

## Notes

- Put the plan at `.agent-relay/plan-<id>.md`. Write `CURRENT` when creating a
  new id (see above). Prefer an explicit id when switching features.
- Commit `.agent-relay/` if you want the notes on the branch. Otherwise add
  the directory to `.gitignore`. This repo does not choose for you.
  `bin/install.sh` prints that reminder.
- Id generation: `npx --yes nanoid@5 --size 10` needs network/npm. The
  `openssl` fallback must be checked for exactly 10 characters after filtering;
  regenerate if shorter. Use the same id on every file for that run.

