# File conventions

Skills read and write files under `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/` in
the target repo, where `{YMD}` is the run creation date (`date +%Y%m%d`, never
renamed), `{RUN_ID}` is the Unix timestamp in seconds (`date +%s`, 10–11
digits), and `{RUN_SLUG}` is a short agent-authored slug (lowercase `a-z` and
hyphens, length 3–48 inclusive). All run artifacts live inside this per-run
directory using short, stable names (no `<id>` suffixes inside filenames).
Nothing in this repo enforces the names except the skill text and bash helpers.

This file is the **source of truth** for those names. Maintainer docs that
point here (architecture, task-claim, skill authoring, …):
[`INDEX.md`](INDEX.md). Do not hand-edit the copies under
`skills/*/references/` — run `bash scripts/sync-references.sh` from the repo
root after changing this file.

| Purpose | Path | Written by |
| --- | --- | --- |
| Plan | `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/plan.md` | You, or `atry-plan`. |
| Task list | `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/implement-plan.md` (or `implement-plan/` in parallel mode) | `atry-implement` |
| Implement notes | `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/implement-report.md` (or `implement-report/` in parallel mode) | `atry-implement` |
| Review report | `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/review-report.md` | `atry-self-review` creates or overwrites. `atry-cross-review` appends. |
| Review walkthrough | `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/review-walkthrough.md` | Same as the review report. |
| Metadata | `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/meta.md` | `run-init.sh` creates; stages update `stage:` and `status:`. |
| History (optional) | `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/history.log` | `run-history.sh` / stages append events. |

`<RUN_ID>` is the Unix timestamp in seconds (`date +%s`). `<RUN_SLUG>` is 3–48
characters matching `^[a-z]+(-[a-z]+)*$`.

Empty outlines for each artifact live in that skill's
`references/*-template.md` (installed with the bundle). Runtime files live
inside their respective run directory.

## No CURRENT / No Central Index

There is **no** `.agent-relay/CURRENT` file and **no** root index (such as
`composer.csv` or `runs.md`). Each run directory is self-contained.

Skills and helpers resolve the active run directory in this strict order (they
must **never** guess via file mtime):

1. The user passed a `RUN_ID`, `RUN_SLUG`, full dirname, or any path under a run directory.
2. Else if exactly one run directory exists matching `[0-9]{8}-*`, use that directory.
3. Else ask the user. Do not guess.

Directory matching rules:
- Run directory format: `^([0-9]{8})-([0-9]{10,11})-([a-z]+(-[a-z]+)*)$`.
- Lookup by ID: A unique directory under `.agent-relay/` matching `*-${RUN_ID}-*` or by slug.
- Lookup by full path or dirname: Matches directly.

## `meta.md` (Source of Truth for Run Status)

Every run directory contains `meta.md` created at plan time:

```markdown
id: <RUN_ID>
slug: <RUN_SLUG>
created: <YYYY-MM-DD>
title: <short>
stage: plan|implement|self-review|cross-review|done
status: active|done|abandoned
base: <git-ref>
```

Field definitions:
- `id`: The Unix timestamp run identifier (`date +%s`).
- `slug`: Short slug (lowercase letters and hyphens, 3–48 characters).
- `created`: Date the run was initialized (`YYYY-MM-DD`).
- `title`: Short summary of the run's goal.
- `stage`: Current workflow stage (`plan`, `implement`, `self-review`, `cross-review`, or `done`).
- `status`: Lifecycle status (`active`, `done`, or `abandoned`).
- `base`: Git commit ref from which the work branches or diffs.

## `history.log` (Append-Only Event Log)

An optional, append-only log file `history.log` records stage transitions and
major actions. Each line is formatted as:

`<TIMESTAMP> stage=<stage> action=<action> [key=value ...]`

Example:
```text
2026-09-16T03:05:00Z stage=plan action=created tool=cursor
2026-09-16T03:15:22Z stage=implement action=started tool=cursor
2026-09-16T03:45:10Z stage=implement action=completed tool=cursor
```

Timestamp must be ISO8601 UTC. Use `scripts/run-history.sh` to safely append to
this file.

## Plan header

`plan.md` starts with the git ref you will diff from, and the id:

```markdown
base: <git-ref>
id: <RUN_ID>

# <title>
```

If those lines are missing, `atry-implement` adds them before coding. `base`
should be a real ref in that repo (`HEAD` before the work, or the branch tip).
Do not invent one. The plan skill's `references/plan-template.md` also outlines
`## Non-goals` and numbered tasks that may list `(deps: T1 T2)`.

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

Both review skills read shared `references/reviewer-conduct.md` (kept
byte-identical by `sync-references.sh`). When a genuine tradeoff cannot be
resolved interactively, record it as an optional `### Open decisions`
subsection **inside** that day's Self-Review or Cross-Review body — not a new
top-level `##` kind.



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

### `task-claim.sh` contract

The script `scripts/task-claim.sh` manages atomic task claiming, status updates,
dependency validation, and rollup generation within the run directory. Ids and
task-ids must match `^[A-Za-z0-9._-]+$` (no path separators).

```bash
task-claim.sh [--session <tag>] <subcommand> ...
task-claim.sh claim [--allow-skipped-deps] <run-dir-or-id> <task-id> <session-tag>
task-claim.sh steal <run-dir-or-id> <task-id> <session-tag>
task-claim.sh update [--session <tag>] <run-dir-or-id> <task-id> [<session-tag>] <status> [<reason>]
task-claim.sh release [--force] [--session <tag>] <run-dir-or-id> <task-id> [<session-tag>]
task-claim.sh list <run-dir-or-id>
task-claim.sh rollup <run-dir-or-id>
task-claim.sh check <run-dir-or-id>
task-claim.sh report-write <run-dir-or-id> <task-id> <path-or-->
task-claim.sh report-list <run-dir-or-id>
task-claim.sh report-rollup <run-dir-or-id>
```

`--session <tag>` may appear before the subcommand or (for `update`/`release`)
after it. An explicit `--session` wins over a positional session-tag. Ambient
`SESSION` / `SESSION_TAG` environment variables are never used for auth.

- `claim`: Atomically creates `implement-plan/.lock-<task-id>` (`mkdir` is
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
  `implement-report/<task-id>.md` and regenerates the report rollup.
- `report-list`: Prints paths of per-task report files in plan order.
- `report-rollup`: Regenerates `implement-report.md`.
- `check`: Regenerates the expected plan/report rollups into temp files and
  compares them to what is on disk; prints `MISMATCH` and exits non-zero on
  drift (does not repair). See [task-claim.md](task-claim.md).
- Every state-changing plan subcommand regenerates the plan rollup as its last
  step.

### Script resolution

Helpers ship **inside each installed skill bundle** as `scripts/` next to
`SKILL.md` (for example `~/.cursor/skills/atry-implement/scripts/task-claim.sh`).
Call them by path relative to the skill directory.

Prefer reading `implement-report/` (or `report-list`) over the generated
`implement-report.md` rollup when the directory exists.

### Working-tree isolation

The claim protocol serializes **task status**, not file contents:

| Scenario | Safe? |
|---|---|
| Different tasks, **disjoint** file sets, same worktree | Yes (protocol + skill scoping) |
| Different tasks, overlapping files, same worktree | No — git/content races; claim does not protect |
| One agent per git worktree/branch, then merge | Yes (recommended when files overlap) |
| Multiple features (different `<RUN_ID>`) | Yes, completely isolated in separate `{YMD}-{RUN_ID}-{RUN_SLUG}/` dirs |

### Concurrency

| Scenario | Safe? |
|---|---|
| Multiple runs (different `<RUN_ID>`) in parallel | Yes |
| Multiple sub-agents, same `<RUN_ID>`, different tasks, via `task-claim.sh` | Yes (for status/report; see isolation above for files) |
| Multiple sub-agents, same `<RUN_ID>`, same task | No — second claim fails loudly |
| Hand-editing `implement-plan.md` while parallel mode is active | No — it's generated, gets overwritten |


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
- **Directory/rollup drift.** If `implement-plan/` or
  `implement-report/` exists for the run under review, run
  `scripts/task-claim.sh check <run-dir-or-id>` before writing the review. A
  `MISMATCH` means the rollup `.md` was hand-edited outside the claim
  protocol and the per-task `.status`/report files are stale — call this out
  in the review rather than treating the rollup `.md` as ground truth.

## Notes

- Put each run at `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/`.
- Commit `.agent-relay/` if you want the notes on the branch. Otherwise add
  the directory to `.gitignore`. This repo does not choose for you.
  `bin/install.sh` prints that reminder.
- Id generation: `RUN_ID` is generated offline via `date +%s` (Unix epoch
  seconds). No npm or network required.

