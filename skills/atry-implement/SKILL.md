---
name: atry-implement
description: Implement an existing .agent-relay/plan-<id>.md task-by-task, following project rules, and write implement-plan-<id>.md + implement-report-<id>.md. Use when the user asks to implement, build, or code according to an agent-relay plan.
---

# Implement

You are implementing a plan that was created by a separate planning step. Do not
re-plan from scratch — decompose and execute the plan that already exists.

## Run discovery

Resolve the shared run `<id>` before reading or writing artifacts. Follow
`references/file-conventions.md` (installed next to this skill) for the full
order (user id → CURRENT → single plan-*.md → ask).

If you must adopt a legacy `.agent-relay/plan.md` (no suffix) with no `plan-*.md`,
generate a new id, migrate writes to `*-<id>.md`, and **then** write `CURRENT`.

**Only write `.agent-relay/CURRENT` when you create a new id.** Resolving an
existing id must not overwrite `CURRENT` (avoids stealing another feature's
pointer).

Generate a missing id with:

```bash
npx --yes nanoid@5 --size 10
# fallback (must yield exactly 10 chars — regenerate if shorter):
openssl rand -base64 12 | tr -dc 'A-Za-z0-9_-' | head -c 10
```

Verify the id is exactly 10 characters before using it.

## Inputs

- Plan file: `.agent-relay/plan-<id>.md` (fallback: ask the user for the path if
  missing)
- Prefer any `base:` ref recorded in the plan when you need git context
- Project rules, in this precedence order when several exist:
  1. `AGENTS.md` (repo root)
  1. Tool-native rules/skills already loaded in this environment
  1. `CLAUDE.md` / similar
- Infer conventions from the surrounding codebase if no rules file exists — do
  not impose your own style

## Provenance

Record what ran this stage. Prefer real values; use `unknown` when you cannot
know the tool or model (do not invent). Today's date: run `date +%F` (do not
guess).

```html
<!-- relay: stage=implement tool=<tool> model=<id-or-unknown> base=<ref> date=<YYYY-MM-DD> -->
```

This is a record for later readers, not a proof of which runtime invoked you.

## Mode check (do this before step 1)

Before writing anything, check whether `.agent-relay/implement-plan-<id>/` (a
directory, not the `.md` file) already exists for the resolved `<id>`.

- If it does **not** exist: proceed with the default sequential instructions
  below (hand-write `implement-plan-<id>.md` / `implement-report-<id>.md`).
- If it **does** exist: a parallel-mode run was already initialized for this
  id (via `task-init.sh`, by you or another agent). You must use
  `scripts/task-claim.sh` (see "Parallel mode" below) for every further
  status and report write for the rest of this run. Do **not** hand-edit
  `implement-plan-<id>.md` or `implement-report-<id>.md` directly — both are
  generated rollups; a run has previously been left with `.status` files
  stuck at `pending` while an agent hand-wrote `[done]` straight into the
  rollup, which silently desyncs the two and defeats the per-task
  claim/lock protocol for anyone who joins later. Run
  `scripts/task-claim.sh check <id>` at any point to confirm the rollups
  still match the per-task files; a `MISMATCH` means something wrote to a
  rollup outside `task-claim.sh`.

## Instructions

1. Resolve `<id>` as above (write `CURRENT` only if you created the id). Read the
   plan file fully before writing any code. Identify each discrete task. If the
   plan has no `base:` git ref, record one now (`git rev-parse HEAD`) at the top
   of the plan. If the plan has no `id:` line, add `id: <id>` next to `base:`.
   If the plan file still uses a legacy unsuffixed name, rename/copy it to
   `plan-<id>.md` before coding.

1. Break the plan into an explicit task list and write it to
   `.agent-relay/implement-plan-<id>.md` **before** starting implementation. Use
   one line per task in this exact form:

   `- [<status>] <task id>: <short description>`

   where `<status>` is one of: `pending` / `in-progress` / `done` /
   `skipped (<reason>)`.

1. Implement tasks one at a time. Update the task's status in
   `.agent-relay/implement-plan-<id>.md` as you go — do not batch all updates at
   the end.

1. After implementation, write `.agent-relay/implement-report-<id>.md` containing,
   per task:

   - files changed
   - key assumptions made (anything the plan left ambiguous)
   - known risks or open issues left for the reviewer

1. If a task in the plan is unclear, contradictory, or infeasible, do not silently
   reinterpret it — mark it `skipped (<reason>)` in `implement-plan-<id>.md`
   **and** repeat the same reason in `implement-report-<id>.md` instead of
   guessing.

1. Do not modify files unrelated to the plan's scope.

1. Do not expand scope beyond the plan. Clarifying an ambiguous step is fine only
   when the plan already implies it; otherwise skip and report.

## Parallel mode

The default behavior above (sequential, "one at a time" on a single shared
`implement-plan-<id>.md` file) is unchanged. This section applies only when you
are explicitly invoked in parallel mode across multiple sub-agents (separate
sessions).

Call the helpers shipped next to this skill (paths relative to this `SKILL.md`):

```bash
TASK_INIT="$(dirname "$SKILL_DIR")/scripts/task-init.sh"   # or: scripts/task-init.sh beside SKILL.md
TASK_CLAIM="$(dirname "$SKILL_DIR")/scripts/task-claim.sh"
# From the skill directory:
TASK_INIT="scripts/task-init.sh"
TASK_CLAIM="scripts/task-claim.sh"
```

1. **Setup**: Run `"$TASK_INIT" <id>` instead of hand-writing
   `implement-plan-<id>.md`. (If converting an existing sequential run, use
   `"$TASK_INIT" <id> --migrate`). This creates `implement-plan-<id>/`,
   `implement-report-<id>/`, and their rollup files.

2. **Per sub-agent loop**:
   - Run `"$TASK_CLAIM" list <id>`.
   - Pick one `pending` task whose deps are claimable (list shows `[blocked: …]`
     when they are not).
   - Attempt to claim it with `"$TASK_CLAIM" claim <id> <task-id> <session-tag>`.
   - If the claim fails, pick a different pending task or stop.
   - Implement only that task's files (disjoint file sets in one worktree, or
     one worktree/agent when files overlap — claim does not protect content).
   - Update with `"$TASK_CLAIM" update <id> <task-id> <session-tag> done`
     (or `skipped <reason>`).
   - Release with `"$TASK_CLAIM" release <id> <task-id> <session-tag>`.

3. **File scoping rule in parallel mode**:
   Do not touch any file owned by another task that is still `pending` or
   `in-progress` under a lock you do not hold. Report the conflict instead.

4. **Implementation report in parallel mode**:
   Use `"$TASK_CLAIM" report-write <id> <task-id> -` (stdin) or
   `"$TASK_CLAIM" report-write <id> <task-id> <file>"` under
   `implement-report-<id>/<task-id>.md`. Do not manually edit the rollup.
