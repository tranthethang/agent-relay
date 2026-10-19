# Task State Transitions

Each task declared in `10-plan/index.json` advances through discrete states tracked in `events.jsonl` and mirrored in `run.json`.

## Task States

```mermaid
stateDiagram-v2
    [*] --> pending: atry plan done
    pending --> in-progress: atry task start / atry claim
    in-progress --> done: atry task done
    in-progress --> skipped: atry task skip --reason
    pending --> skipped: atry task skip --reason
    done --> [*]
    skipped --> [*]
```

## Transition Logic

- **`pending`**: Default state upon plan generation.
  - A task remains unstartable as long as any task listed in its `deps` is not `done` or `skipped`.
- **`in-progress`**: Set by `atry task start <run> <task>` or `atry claim <run> <task> --session <tag>`.
  - The `task-started` event stores the git working-tree hash. `atry steal` stores a new hash on `stolen`.
- **`done`**: Completed via `atry task done <run> <task>`.
  - Verifies that file modifications do not exceed the declared scope.
  - Automatically releases any claim lock held on the task.
- **`skipped`**: Bypassed via `atry task skip <run> <task> --reason <text>`.
  - Requires a non-empty explanation why the task was not feasible or superseded.
  - Unblocks dependent tasks.
