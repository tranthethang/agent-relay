---
name: atry-implement
description: Implement an existing .agent-relay/plan-<id>.md task-by-task, following project rules, and write implement-plan-<id>.md + implement-report-<id>.md. Use when the user asks to implement, build, or code according to an agent-relay plan.
---

# Implement

You are implementing a plan that was created by a separate planning step. Do not
re-plan from scratch — decompose and execute the plan that already exists.

## Run discovery

Resolve the shared run `<id>` before reading or writing artifacts. The same
rules are in the agent-relay repo at `docs/file-conventions.md`; that file is
not installed next to this skill. Order:

1. User gave a plan path or run id → use that id
1. Else read `.agent-relay/CURRENT` (one trimmed line)
1. Else if exactly one `plan-*.md` → extract id from `^plan-(.+)\.md$`
1. Else ask the user — do not guess by mtime

If you must adopt a legacy `.agent-relay/plan.md` (no suffix) with no `plan-*.md`,
generate a new id, migrate writes to `*-<id>.md`, and set `CURRENT`.

After resolving or creating an id, write/overwrite `.agent-relay/CURRENT` with
that id.

Generate a missing id with:

```bash
npx --yes nanoid@5 --size 10
# fallback:
openssl rand -base64 12 | tr -dc 'A-Za-z0-9_-' | head -c 10
```

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

## Instructions

1. Resolve `<id>` (and update `CURRENT`) as above. Read the plan file fully before
   writing any code. Identify each discrete task. If the plan has no `base:` git
   ref, record one now (current `HEAD` or the branch tip before you start) at the
   top of the plan so later review stages can diff the full change. If the plan
   has no `id:` line, add `id: <id>` next to `base:` (matching the filename
   suffix). If the plan file still uses a legacy unsuffixed name, rename/copy it
   to `plan-<id>.md` before coding.

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

Resolve task binaries before calling them (project override, then global install):

```bash
RESOLVE=".agent-relay/scripts/resolve-task-bin.sh"
[[ -x "$RESOLVE" ]] || RESOLVE="$HOME/.agent-relay/scripts/resolve-task-bin.sh"
TASK_INIT="$("$RESOLVE" init)"
TASK_CLAIM="$("$RESOLVE" claim)"
```

Do not use a repo-root `./scripts/` path as the override — only
`.agent-relay/scripts/` or `~/.agent-relay/scripts/`.

1. **Setup**: Run `"$TASK_INIT" <id>` instead of hand-writing
   `implement-plan-<id>.md`. (If converting an existing sequential run, use
   `"$TASK_INIT" <id> --migrate`). This creates `implement-plan-<id>/`,
   `implement-report-<id>/`, and their rollup files.

2. **Per sub-agent loop**:
   - Run `"$TASK_CLAIM" list <id>`.
   - Pick one `pending` task whose `deps:` (if any) are all `done` — `claim`
     also enforces this and fails loudly if a dependency is not done.
   - Attempt to claim it with `"$TASK_CLAIM" claim <id> <task-id> <session-tag>`.
   - If the claim fails (another agent already claimed it, or deps not done),
     pick a different `pending` task or stop if none are available.
   - Implement only that task's files (disjoint file sets in one worktree, or
     one worktree/agent when files overlap — claim does not protect content).
   - Update the task status with `"$TASK_CLAIM" update <id> <task-id> <session-tag> done`
     (or `skipped (<reason>)`).
   - Release the lock with `"$TASK_CLAIM" release <id> <task-id>`.

3. **File scoping rule in parallel mode**:
   In addition to not modifying files outside the plan's scope, do not touch
   any file owned by another task that is still `pending` or `in-progress` under
   a lock you do not hold. Report the conflict instead of guessing.

4. **Implementation report in parallel mode**:
   Use `"$TASK_CLAIM" report-write <id> <task-id> -` (stdin) or
   `"$TASK_CLAIM" report-write <id> <task-id> <file>` to record task-specific
   notes under `implement-report-<id>/<task-id>.md` and regenerate the rollup.
   Do not manually edit `implement-report-<id>.md`.
