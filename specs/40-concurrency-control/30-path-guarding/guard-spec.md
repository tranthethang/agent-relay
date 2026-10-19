# Path Guarding Specification

The path guard subsystem (`src/core/guard.ts`) provides a lightweight pre-edit verification check that tools or editor hooks can invoke before writing to disk.

## Interface

```bash
atry guard <run> <path> [--session <tag>]
```

## Behavior & Exit Semantics

- Inspects all in-progress tasks in the specified run.
- Checks whether the target `<path>` is contained within the `files` array of an in-progress task.
- If `--session <tag>` is provided, verifies that the claiming session matches `<tag>`.
- **Exit Codes**:
  - `0`: The path is within the scope of an in-progress task owned by the session. Edit is permitted.
  - `4`: The path is outside active task scopes or locked by another session. Edit is rejected.
- Does not compute git tree hashes or write locks, ensuring sub-millisecond execution.
