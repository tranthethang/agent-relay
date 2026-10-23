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
| `distill.ts`   | Artifact manifest     | `distill`, `distill verify`                                                                     |
| `policy.ts`    | Repository policy     | `policy init`, `policy check`                                                                   |
| `skills.ts`    | Bundled skills        | `skills install`, `skills status`                                                               |
| `worktree.ts`  | Worktree management   | `integrate`, `worktree cleanup`                                                                 |
| `hook.ts`      | Claude Code edit hook | `hook install`, `hook check`                                                                    |
| `stats.ts`     | Run reporting         | `stats`                                                                                         |
| `doctor.ts`    | Install diagnostics   | `doctor`                                                                                        |

## Skills Tools

`atry skills install --tool <name>` and `atry skills status --tool <name>`
accept these names:

| Tool        | Directory           |
| ----------- | ------------------- |
| Claude Code | `~/.claude/skills/` |
| Cowork      | `~/.agents/skills/` |
| Cursor      | `~/.agents/skills/` |
| Codex       | `~/.agents/skills/` |
| Antigravity | `~/.agents/skills/` |
| Kiro        | `~/.kiro/skills/`   |

Cowork reads the same `.agents/skills` directory as Cursor, Codex, and
Antigravity. One install serves all four. `--dir <path>` replaces the tool
directory. `--all` checks every known directory instead of the ones that exist.

## Stats Filters

`atry stats [run] [--since <ISO date>] [--failed]` reads `events.jsonl` and
writes no event. `--since` keeps a run with at least one event at or after the
date. `--failed` keeps a run with at least one failed test. The filters combine
and also apply to a single run. An invalid date is a validation error, which
exits 2. The JSON keeps `schema` 1 and adds no filter field.

## Token Resolution Convention

All commands accepting a `<run>` or `[run]` parameter resolve positional arguments first. If omitted, they fall back to the `--run` global flag. If both are absent, they select the single active run in `.agent-relay/` or report an error.
