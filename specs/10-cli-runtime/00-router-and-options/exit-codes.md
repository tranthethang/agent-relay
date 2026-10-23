# Exit Codes

`RelayError` in `src/core/error.ts` maps each error name to one exit code.

## Exit Code Mapping

| Code | Names                    | Meaning                                                                                                                                 |
| ---- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | `ok`                     | The command completed.                                                                                                                  |
| `1`  | `usage`                  | The arguments are invalid, or a required option is missing. `atry preflight` also uses this code when the installed version is too old. |
| `2`  | `validation`             | A schema or field check failed.                                                                                                         |
| `3`  | `not_found`, `ambiguous` | A run, task, file, or review was not found, or more than one run matched the token.                                                     |
| `4`  | `gate`                   | A state transition was refused. Examples: the stage is not allowed, a task is not in progress, or edits sit outside declared files.     |
| `5`  | `lock`                   | A task lock or the run lock blocked the command.                                                                                        |

## Command Examples

| Code | Command                                            | Condition                                                                     |
| ---- | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| `1`  | `atry preflight`                                   | The installed version is below `--requires`.                                  |
| `1`  | `atry skills status`                               | A bundle is `stale`, `mismatch`, or `missing`.                                |
| `1`  | `atry distill verify`                              | A file is missing, differs, or is extra.                                      |
| `2`  | `atry stats --since <date>`                        | The date is not a valid ISO date.                                             |
| `4`  | `atry plan done`, `atry plan amend`                | The plan has zero tasks.                                                      |
| `4`  | `atry approve`, `atry stage start <run> implement` | The index is missing, the plan has zero tasks, or Detail/Acceptance is empty. |
| `4`  | `atry task done`                                   | The task worktree has uncommitted changes.                                    |
| `4`  | `atry integrate`                                   | The task worktree is dirty, or the merge conflicts.                           |

`atry skills status` and `atry distill verify` report a failed check by setting
`process.exitCode` to 1 after the command writes its result. They do not throw.

## Path Guard

`atry guard <run> <path>` uses two of these codes:

- `0`: The path is under `.agent-relay/`, or it overlaps an in-progress task. With `--session`, that task's session must match.
- `4`: The path is outside those scopes.
