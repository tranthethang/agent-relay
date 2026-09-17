---
name: atry-implement
description: Implement an existing agent-relay plan task-by-task, following project rules, and write implement-plan.md + implement-report.md in the run directory. Use when the user asks to implement, build, or code according to an agent-relay plan.
---

# Implement

You are implementing a plan that was created by a separate planning step. Do not
re-plan from scratch — decompose and execute the plan that already exists.

## Run discovery

Resolve the run directory before reading or writing artifacts. Call the helper
shipped beside this skill:

```bash
RUN_DIR="$(scripts/resolve-run.sh [RUN_ID or path])"
```

If the user passed a `RUN_ID` or a path under a run directory, pass it to the
helper. If no argument is passed and exactly one run directory exists,
`resolve-run.sh` will resolve it automatically. If it exits non-zero (ambiguous
or not found), ask the user for the `RUN_ID` or path.

There is no `CURRENT` file — do not look for or write `CURRENT`.

## Inputs

- Plan file: `$RUN_DIR/plan.md`
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

Before writing anything, check whether `$RUN_DIR/implement-plan/` (a
directory, not the `.md` file) already exists for the resolved run.

- If it does **not** exist: proceed with the default sequential instructions
  below (hand-write `$RUN_DIR/implement-plan.md` / `$RUN_DIR/implement-report.md`).
- If it **does** exist: a parallel-mode run was already initialized for this
  run (via `task-init.sh`, by you or another agent). You must use
  `scripts/task-claim.sh` (see "Parallel mode" below) for every further
  status and report write for the rest of this run. Do **not** hand-edit
  `implement-plan.md` or `implement-report.md` directly — both are
  generated rollups; a run has previously been left with `.status` files
  stuck at `pending` while an agent hand-wrote `[done]` straight into the
  rollup, which silently desyncs the two and defeats the per-task
  claim/lock protocol for anyone who joins later. Run
  `scripts/task-claim.sh check "$RUN_DIR"` at any point to confirm the rollups
  still match the per-task files; a `MISMATCH` means something wrote to a
  rollup outside `task-claim.sh`.

## Instructions

1. Resolve `$RUN_DIR` as above. Record stage start in `history.log`:
   ```bash
   scripts/run-history.sh append "$RUN_DIR" implement started tool=<tool>
   ```
   Read the plan file fully before writing any code. Identify each discrete task.
   If the plan has no `base:` git ref, record one now (`git rev-parse HEAD`) at the top
   of the plan. If the plan has no `id:` line, add `id: <RUN_ID>` next to `base:`.

1. Break the plan into an explicit task list and write it to
   `$RUN_DIR/implement-plan.md` **before** starting implementation. Read
   `references/implement-plan-template.md` first and use it as the
   copy-and-fill outline. Use one line per task in this exact form:

   `- [<status>] <task id>: <short description>`

   where `<status>` is one of: `pending` / `in-progress` / `done` /
   `skipped (<reason>)`.

1. Implement tasks one at a time. Update the task's status in
   `$RUN_DIR/implement-plan.md` as you go — do not batch all updates at
   the end.

1. After implementation, write `$RUN_DIR/implement-report.md` containing,
   per task:

   - files changed
   - key assumptions made (anything the plan left ambiguous)
   - known risks or open issues left for the reviewer

   Read `references/implement-report-template.md` before writing the report
   and use it as the copy-and-fill outline.

1. If a task in the plan is unclear, contradictory, or infeasible, do not silently
   reinterpret it — mark it `skipped (<reason>)` in `implement-plan.md`
   **and** repeat the same reason in `implement-report.md` instead of
   guessing.

1. Do not modify files unrelated to the plan's scope.

1. Do not expand scope beyond the plan. Clarifying an ambiguous step is fine only
   when the plan already implies it; otherwise skip and report.

1. Once all tasks are complete, record completion in `history.log`:
   ```bash
   scripts/run-history.sh append "$RUN_DIR" implement completed tool=<tool>
   ```

## Parallel mode

The default behavior above (sequential, "one at a time" on a single shared
`implement-plan.md` file) is unchanged. This section applies only when you
are explicitly invoked in parallel mode across multiple sub-agents (separate
sessions).

Call the helpers shipped next to this skill (paths relative to this `SKILL.md`):

```bash
TASK_INIT="scripts/task-init.sh"
TASK_CLAIM="scripts/task-claim.sh"
```

1. **Setup**: Run `"$TASK_INIT" "$RUN_DIR"` instead of hand-writing
   `implement-plan.md`. This creates `implement-plan/`, `implement-report/`, and
   their rollup files. Per-task `.status` files follow
   `references/task-status-template.md`.

2. **Per sub-agent loop**:
   - Run `"$TASK_CLAIM" list "$RUN_DIR"`.
   - Pick one `pending` task whose deps are claimable (list shows `[blocked: …]`
     when they are not).
   - Attempt to claim it with `"$TASK_CLAIM" claim "$RUN_DIR" <task-id> <session-tag>`.
   - If the claim fails, pick a different pending task or stop.
   - Implement only that task's files (disjoint file sets in one worktree, or
     one worktree/agent when files overlap — claim does not protect content).
   - Update with `"$TASK_CLAIM" update "$RUN_DIR" <task-id> <session-tag> done`
     (or `skipped <reason>`).
   - Release with `"$TASK_CLAIM" release "$RUN_DIR" <task-id> <session-tag>`.

3. **File scoping rule in parallel mode**:
   Do not touch any file owned by another task that is still `pending` or
   `in-progress` under a lock you do not hold. Report the conflict instead.

4. **Implementation report in parallel mode**:
   Use `"$TASK_CLAIM" report-write "$RUN_DIR" <task-id> -` (stdin) or
   `"$TASK_CLAIM" report-write "$RUN_DIR" <task-id> <file>"` under
   `$RUN_DIR/implement-report/<task-id>.md`. Do not manually edit the rollup.
