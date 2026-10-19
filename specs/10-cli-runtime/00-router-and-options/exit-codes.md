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

## Path Guard

`atry guard <run> <path>` uses two of these codes:

- `0`: The path is under `.agent-relay/`, or it overlaps an in-progress task. With `--session`, that task's session must match.
- `4`: The path is outside those scopes.
