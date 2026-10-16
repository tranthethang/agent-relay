---
name: atry-implement
description: Use when the user asks to implement, build, or code from an existing agent-relay plan.md. Turn an approved plan into file changes.
---

# Implement

Before writing implement-plan or implement-report prose, read `references/writing.md`.

## Overview

This stage implements an existing plan task by task and follows the project
rules. It writes the task breakdown (`implement-plan.md`) and
`implement-report.md` in the run directory. In parallel mode, it writes the
directory versions of these files.

A separate plan stage created the plan. Do not plan again from the start.
Break the existing plan into tasks and run them.

## Preflight

<!-- BEGIN PREFLIGHT -->

Run `atry version` before anything else in this skill. If it fails, stop.
Do not search the filesystem for helpers. Do not run `scripts/atry`,
`scripts/runtime/*.sh`, or `~/.agent-relay/lib/*.sh` directly.

Tell the user to run `verify.sh` and fix what it reports. The most common
cause is `$HOME/.local/bin` missing from `PATH`. Run `atry` from the repo
root. Confirm that each `atry resolve` and `atry run-init` call below prints
`atry: using <path>` on stderr. Full rule: `references/file-conventions.md`
("atry preflight").

<!-- END PREFLIGHT -->

After resolve, run `atry status "$RUN_DIR"` and tell the user its output.
Include `plan approved: no` and any `run-history: warning: plan not approved`
from the `implement started` append. Do **not** stop for a missing approval.
Warn the user and continue. The approval gate is advisory only.

The user must explicitly ask for the exact command in this conversation.
Otherwise, do not run `atry approve`, `atry decide`, `atry stamp`, or
`atry close`. A human runs these verbs in the cockpit. This text states the
rule. The CLI does not enforce it.

### Commands used in this stage

| Command                                                                                 | Meaning of a non-zero exit                                            |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `atry version`                                                                          | atry is missing or broken on PATH -- stop, see Preflight above        |
| `atry resolve [RUN_ID or path]`                                                         | ambiguous or not found -- ask the user for the `RUN_ID` or path       |
| `atry status "$RUN_DIR"`                                                                | informational; relay approval / next-step lines to the user           |
| `atry history append <run-dir> implement started\|completed tool=<tool>`                | run dir invalid; may warn on stderr if plan is unapproved (exit 0)    |
| `atry task-init "$RUN_DIR"` (parallel mode setup)                                       | the plan doesn't parse (bad checkbox status or dependency id)         |
| `atry list "$RUN_DIR"` (parallel mode)                                                  | informational only -- no special non-zero meaning                     |
| `atry claim "$RUN_DIR" <task-id> <session-tag>` (parallel mode)                         | already locked, or a dep isn't `done` -- pick a different task        |
| `atry update "$RUN_DIR" <task-id> <session-tag> done\|skipped <reason>` (parallel mode) | the caller's session doesn't own the lock                             |
| `atry release "$RUN_DIR" <task-id> <session-tag>` (parallel mode)                       | the caller's session doesn't own the lock (use `--force` to override) |
| `atry report-write "$RUN_DIR" <task-id> <session-tag> -` (parallel mode)                | the lock isn't held -- use `--force` (logs `report-write-force`)      |
| `atry check "$RUN_DIR"` (parallel mode)                                                 | `MISMATCH` -- a rollup was hand-edited outside the claim protocol     |

## Run discovery

Resolve the run directory before reading or writing artifacts:

```bash
RUN_DIR="$(atry resolve [RUN_ID or path])"
```

If the user passes a `RUN_ID` or a path under a run directory, pass it to
`atry resolve`. If the user passes no argument and one run directory exists,
`atry resolve` selects it. If the command exits non-zero (ambiguous or not
found), ask the user for the `RUN_ID` or path.

## Inputs

- Plan file: `$RUN_DIR/plan.md`
- When you need git context, use the `base:` ref in the plan
- Project rules, in this order of precedence:
  1. `AGENTS.md` (repo root)
  1. Tool-native rules and skills that are already loaded
  1. `CLAUDE.md` or a similar file
- If no rules file exists, copy the conventions of the surrounding code. Do
  not impose your own style.

## Provenance

Record what ran this stage. Use real values. When you do not know the tool or
model, write `unknown`. Do not invent a value. Get today's date from
`date +%F`. Do not guess it.

```html
<!-- relay: stage=implement tool=<tool> model=<id-or-unknown> base=<ref> date=<YYYY-MM-DD> -->
```

This record is for later readers. It does not prove which runtime ran you.

## Mode check (do this before instruction 1)

Before you write anything, check for the directory `$RUN_DIR/implement-plan/`
(not the `.md` file) in the resolved run.

- If the directory does **not** exist, use the sequential instructions below.
  Write `$RUN_DIR/implement-plan.md` and `$RUN_DIR/implement-report.md` by hand.
- If the directory **exists**, you or another agent already started parallel
  mode with `atry task-init`. For the rest of this run, write each status with
  `atry`. Use claim, update, release, and list. See "Parallel mode" below.

  Do **not** edit `implement-plan.md` or `implement-report.md` by hand. Both
  files are generated rollups. A run once kept `.status` files at `pending`
  while an agent wrote `[done]` into the rollup. That edit desyncs the files
  and defeats the per-task claim protocol for any later agent. Run
  `atry check "$RUN_DIR"` to compare the rollups with the per-task files. A
  `MISMATCH` means that something wrote to a rollup outside `atry`.

## Instructions

1. Resolve `$RUN_DIR` as above. Record stage start in `history.log`:
   ```bash
   atry history append "$RUN_DIR" implement started tool=<tool>
   ```
   Read the whole plan file before you write code. Identify each task. If no
   `base:` ref exists, run `git rev-parse HEAD` and record it at the top of
   the plan. If the plan has no `id:` line, add `id: <RUN_ID>` next to `base:`.

1. Break the plan into a task breakdown. Write it to
   `$RUN_DIR/implement-plan.md` **before** you start to implement. First read
   `references/implement-plan-template.md`. Copy the template and fill it in.
   Write one line for each task in this exact form:

   `- [<status>] <task id>: <short description>`

   `<status>` is `pending`, `in-progress`, `done`, or `skipped (<reason>)`.

1. Implement one task at a time. Update the status of each task in
   `$RUN_DIR/implement-plan.md` when it changes. Do not update all statuses at
   the end.

1. After you implement, write `$RUN_DIR/implement-report.md`. For each task,
   include:

   - the files that changed
   - the key assumptions (anything that the plan left ambiguous)
   - the known risks and open issues for the reviewer

   Before you write the report, read `references/implement-report-template.md`.
   Copy the template and fill it in.

1. If a task is unclear, contradictory, or not feasible, do not reinterpret it
   in silence. Mark it `skipped (<reason>)` in `implement-plan.md`. Write the
   same reason in `implement-report.md`. Do not guess.

1. Do not change files outside the scope of the plan.

1. Do not expand the scope beyond the plan. Clarify an ambiguous task only
   when the plan already implies the answer. Otherwise skip the task and
   report it.

1. When all tasks are complete, record the completion in `history.log`:
   ```bash
   atry history append "$RUN_DIR" implement completed tool=<tool>
   ```

## Parallel mode

The sequential behavior above (one task at a time in one shared
`implement-plan.md`) does not change. This section applies only when the user
starts you in parallel mode with several sub-agents in separate sessions.

These are the `atry` verbs (Preflight above explains the PATH requirement):

```bash
atry task-init "$RUN_DIR"
atry list "$RUN_DIR"
atry claim "$RUN_DIR" <task-id> <session-tag>
atry update "$RUN_DIR" <task-id> <session-tag> done
atry release "$RUN_DIR" <task-id> <session-tag>
atry report-write "$RUN_DIR" <task-id> <session-tag> -
```

1. **Setup**: Run `atry task-init "$RUN_DIR"`. Do not write `implement-plan.md`
   by hand. The command creates `implement-plan/`, `implement-report/`, and
   their rollup files. The per-task `.status` files follow
   `references/task-status-template.md`.

2. **Per sub-agent loop**:
   - Run `atry list "$RUN_DIR"`.
   - Pick one `pending` task. The list shows `[blocked: …]` for a task whose
     dependencies are not claimable.
   - Claim the task with `atry claim "$RUN_DIR" <task-id> <session-tag>`.
   - If the claim fails, pick a different `pending` task or stop.
   - Change only the files of that task. Use disjoint file sets in one
     worktree. If files overlap, use one worktree and one agent, because
     `atry claim` does not protect file content.
   - Update the task with `atry update "$RUN_DIR" <task-id> <session-tag> done`
     (or `skipped <reason>`).
   - Write the report of the task **before you release** it (instruction 4).
     `report-write` requires that you still hold the lock.
   - Release the task with `atry release "$RUN_DIR" <task-id> <session-tag>`.

3. **File scoping rule in parallel mode**:
   Another task may be `pending` or `in-progress` under a lock you do not hold.
   Do not change a file that belongs to that task. Report the conflict.

4. **Implementation report in parallel mode**:
   Run `atry report-write "$RUN_DIR" <task-id> <session-tag> -` (stdin) or
   `atry report-write "$RUN_DIR" <task-id> <session-tag> <file>`. The command
   writes `$RUN_DIR/implement-report/<task-id>.md`. Run it while you hold the
   lock, before `release`. The session tag must match the owner of the lock.

   After a release, the task is unlocked. Then `report-write` refuses. You can
   pass `--force` to write anyway. The `--force` option logs
   `report-write-force` in `history.log`. Do not edit the rollup by hand.
