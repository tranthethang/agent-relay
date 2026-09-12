# Parallel task helpers (`task-claim` / `task-init`)

Optional protocol for several agents sharing one run `<id>`. Default implement
flow stays sequential (single `implement-plan-<id>.md` / `implement-report-<id>.md`).

Canonical sources: `scripts/task-init.sh`, `scripts/task-claim.sh`. Bundled
copies under `skills/atry-implement/scripts/` must match
(`scripts/sync-references.sh`). Coverage: `tests/tasks.sh`.

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
# next to SKILL.md after install, or from this repo's scripts/
scripts/task-init.sh <id>
# migrate an existing sequential rollup into directory mode:
scripts/task-init.sh <id> --migrate
```

Creates `implement-plan-<id>/` (`*.status`, `.order`, optional `_meta.md`) and
generates `implement-plan-<id>.md` as a rollup. Plain `task-init` without
`--migrate` refuses if the legacy rollup file already exists.

## `task-claim.sh` subcommands

```text
task-claim.sh [--session <tag>] <subcommand> ...

  claim  [--allow-skipped-deps] <id> <task-id> <session-tag>
  steal  <id> <task-id> <session-tag>
  update [--session <tag>] <id> <task-id> [<session-tag>] <status> [<reason>]
  release [--force] [--session <tag>] <id> <task-id> [<session-tag>]
  list   <id>
  check  <id>
  report-write <id> <task-id> <path-or-->
  report-list  <id>
  report-rollup <id>
```

| Command | Behavior |
| --- | --- |
| `claim` | Atomic `mkdir` lock; deps must be exactly `done` (`skipped` does not count unless `--allow-skipped-deps`); sets status `in-progress` |
| `steal` | Intentional lock takeover (try-once steal mutex). **No** auto-steal by age |
| `update` | Status whitelist: `pending` \| `in-progress` \| `done` \| `skipped` (`skipped` needs a reason). Session must match lock owner |
| `release` | Drop lock if session matches, or `--force` |
| `list` | Print tasks; pending + unmet deps get `[blocked: …]` |
| `check` | Regenerate expected rollups into temps beside the plan/report dirs; `cmp` to on-disk rollups; `MISMATCH` → exit non-zero. **Does not repair** |
| `report-*` | Per-task report files + generated `implement-report-<id>.md` |

`--session` may appear before the subcommand or (for `update`/`release`) after
it. Ambient `SESSION` / `SESSION_TAG` env vars are **never** used for auth.

Ids and task-ids must match `^[A-Za-z0-9._-]+$` (no path separators).

## Locks

- Per-task lock: `implement-plan-<id>/.lock-<task-id>/` (`mkdir` is the mutex)  
- Owner file records `session-tag` + timestamp  
- Stale locks: `claim` fails and prints the `steal` command — human/agent
  decision, not a timer  

## `check` and rollup drift

Hand-editing `implement-plan-<id>.md` while the directory exists desyncs
`.status` files from the rollup (seen in real runs). `check` compares
**content** (what regenerate would produce) to the on-disk rollup — not mtime.

If `implement-plan-<id>/` exists, `atry-implement` skill text requires using
`task-claim.sh` for further status/report writes. That is instruction only;
nothing filesystem-locks the rollup `.md` against editors.

## Isolation summary

| Scenario | Safe for status/report? |
| --- | --- |
| Different tasks, disjoint source files, one worktree | Yes |
| Different tasks, overlapping source files, one worktree | No |
| One agent per worktree/branch, then merge | Yes (recommended when files overlap) |
| Two agents `claim` the same task | No — second fails loudly |
