---
name: atry-implement
description: Implement an existing .agent-relay/plan-<id>.md task-by-task, following project rules, and write implement-plan-<id>.md + implement-report-<id>.md. Use when the user asks to implement, build, or code according to an agent-relay plan.
---

# Implement

You are implementing a plan that was created by a separate planning step. Do not
re-plan from scratch — decompose and execute the plan that already exists.

## Run discovery

Resolve the shared run `<id>` before reading or writing artifacts (see
`docs/file-conventions.md`). Order:

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
