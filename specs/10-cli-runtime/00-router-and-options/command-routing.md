# Command Routing & CLI Options

The CLI binary `atry` is implemented in TypeScript using [Commander.js](https://github.com/tj/commander.js).

## Global Options

The CLI registers global flags accessible to all subcommands:

- `--json`: Formats stdout as machine-readable JSON. Omits terminal styling and headers.
- `--run <identifier>`: Explicitly specifies the target run token when omitted as a positional argument.

## Command Groups

Command registration is modularized under `src/cli/`:

| Module         | Command Scope         | Primary Commands                                                                                |
| -------------- | --------------------- | ----------------------------------------------------------------------------------------------- |
| `cli.ts`       | Version               | `version`                                                                                       |
| `commands.ts`  | Top-level queries     | `status`, `next`, `context`, `resolve`, `preflight`                                             |
| `lifecycle.ts` | Run state transitions | `run new`, `brainstorm new`, `brainstorm done`, `stage start`, `stage done`, `approve`, `close` |
| `plan.ts`      | Task planning         | `plan new`, `plan done`, `plan amend`, `task start`, `task done`, `task skip`                   |
| `claim.ts`     | Concurrency & locks   | `claim`, `release`, `steal`, `guard`, `list`                                                    |
| `review.ts`    | Verification & review | `review new`, `review done`, `review decide`                                                    |
| `distill.ts`   | Artifact manifest     | `distill`                                                                                       |

## Token Resolution Convention

All commands accepting a `<run>` or `[run]` parameter resolve positional arguments first. If omitted, they fall back to the `--run` global flag. If both are absent, they select the single active run in `.agent-relay/` or report an error.
