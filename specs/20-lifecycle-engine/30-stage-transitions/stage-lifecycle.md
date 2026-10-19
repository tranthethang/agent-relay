# Stage Lifecycle

A stage represents a formal phase in the execution of a run.

## Supported Stages

- `plan`: Task drafting and dependency modeling.
- `implement`: Code implementation and testing across tasks.
- `self-review`: Introspective evaluation by the implementing agent.
- `cross-review`: Independent verification by an alternative model or tool.

## Stage Invariants

1. **Explicit Start**:
   - `atry stage start <run> <stage> --tool <tool> [--model <model>]`
   - Records `tool` and an optional `model`. It does not store a working-tree hash. `atry review new` stores that hash on its own `started` event.

2. **Completion Verification**:
   - `atry stage done <run> <stage> --tool <tool> [--model <model>]`
   - For `implement`, `self-review`, and `cross-review`, completion stores `head`, `tree`, and `size`.
   - `stage done implement` checks that working-tree changes sit in the union of task `files`, plus paths already recorded in `extra`.
   - Unlisted edits throw `RelayError("gate", ...)`. `--allow-extra <reason>` records those paths and the reason.
