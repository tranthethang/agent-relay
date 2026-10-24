# Prompt Contract (`atry next`)

The `atry next <run> --json` command serves as an executable prompt contract between the CLI engine and autonomous AI agents (`src/core/next.ts`).

## Contract Payload Schema

```json
{
  "schema": 1,
  "command": "atry task start 1792385260 T1",
  "recommendation": "atry task start 1792385260 T1",
  "state": {
    "stage": "implement",
    "lifecycle": "implementing",
    "approved": true
  },
  "actions": [
    {
      "kind": "task-start",
      "command": "atry task start 1792385260 T1",
      "args": {
        "run": "1792385260",
        "task": "T1"
      },
      "reason": "An implement task is still open.",
      "needsHuman": false,
      "read": [
        "10-plan/overview.md",
        "10-plan/T1.md"
      ]
    }
  ],
  "reason": "An implement task is still open.",
  "needsHuman": false,
  "read": [
    "10-plan/overview.md",
    "10-plan/T1.md"
  ]
}
```

## Field Semantics

- **`state`**: The current run stage, lifecycle, and approval state.
- **`recommendation`**: The action the CLI recommends first. It is a suggestion, not a required command.
- **`actions`**: Available commands with reasons, human-decision flags, and paths to read.
- **`command`**: A compatibility alias for `recommendation`. If no action is possible or required, returns `"none"`.
- **`reason`**: A single human-readable explanatory sentence describing why this step was chosen.
- **`read`**: An array of file paths that the agent should read into context before executing the command.
- **`needsHuman`**: True when the recommendation requires a human decision or when the developer must choose among several actions. Each action also marks its own decision requirement.

## Action Fields

| Field           | Type                   | Meaning                                                                    |
| --------------- | ---------------------- | -------------------------------------------------------------------------- |
| `kind`          | string                 | The action kind. See the table below.                                      |
| `command`       | string                 | The command to run after the caller replaces the placeholders.             |
| `args`          | object                 | The run id, task, review kind, or stage.                                   |
| `requiresModel` | `true`, optional       | Set on a cross-review start.                                               |
| `reason`        | string                 | Why the CLI chose this action.                                             |
| `needsHuman`    | boolean                | True when a developer decides.                                             |
| `question`      | string, optional       | Set only when `needsHuman` is true. The question the caller asks.          |
| `read`          | array of string        | Paths to read before the command.                                          |

`question` and the placeholders are additive. `schema` stays `1`.

## Placeholders

A command that needs the agent identity carries the literal tokens `<tool>`
and `<model>`. `stage start`, `stage done`, and `review new` carry
`--tool <tool>`. A cross-review start also carries `--model <model>`. The
caller replaces only those two tokens and runs the command as given.

## Preview Commands and `decision`

An `approve` or `close` action holds `atry approve <run> --preview` or
`atry close <run> --preview`. Its `question` says to read the preview
`decision`. `approve --preview --json` and `close --preview --json` add this
object. Both previews also print `question:` and `on yes:` lines after their
other lines.

| Field      | Type           | Meaning                                                                       |
| ---------- | -------------- | ----------------------------------------------------------------------------- |
| `question` | string         | The question for the developer. It states the reason when `onYes` is `null`.  |
| `onYes`    | string or null | The full command with `--via confirm`. `null` when the run must not go on.    |
| `onYesArg` | string or null | The same command with `--via arg`, for a skill call that holds a `yes` token. |
| `onNo`     | null           | Always `null`. A `n` answer stops the skill and records no event.             |

For close, `onYes` adds `--ack-warnings` when the preview recommends `n` and
`strict.reviewIntegrity` is `false`. It adds `--ack-open` when the preview
lists open items. It never holds `--ack-fixes` or `--waive-review`. `onYes` is
`null` when `strict.reviewIntegrity` is `true` and the preview recommends `n`,
and when a cross-review delta has no later self-review. For approve, `onYes` is
`null` when the plan is not ready, and `question` lists the missing items.

A `review-done` action sets `needsHuman`, adds `--run-tests`, and asks
`Run <testCommand> and record the result?` when the base policy sets
`testCommand`. Without `testCommand` it stays as it was.

## Action Kind

Each action holds a `kind`. A skill stops on a `kind` it does not handle and
runs the `command` of one it does, after it replaces the placeholders.

| `kind`        | Command shape                            | `args`           | `reason`                                         | `needsHuman` | Flags           |
| ------------- | ---------------------------------------- | ---------------- | ------------------------------------------------ | ------------ | --------------- |
| `plan-new`    | `atry plan new <run>`                    | `run`            | The plan has no overview or task input.          | `false`      |                 |
| `plan-done`   | `atry plan done <run>`                   | `run`            | The plan has no task index.                      | `false`      |                 |
| `approve`     | `atry approve <run> --preview`           | `run`            | The plan is incomplete.                          | `true`       |                 |
| `approve`     | `atry approve <run> --preview`           | `run`            | The plan is waiting for approval.                | `true`       |                 |
| `stage-start` | `atry stage start <run> implement --tool <tool>` | `run`, `stage`   | Implement has not started.                       | `false`      |                 |
| `task-start`  | `atry task start <run> <task>`           | `run`, `task`    | An implement task is still open.                 | `false`      |                 |
| `integrate`   | `atry integrate <run> <task>`            | `run`, `task`    | A done task still has a worktree.                | `false`      |                 |
| `stage-done`  | `atry stage done <run> implement --tool <tool>` | `run`, `stage`   | Every implement task is done or skipped.         | `false`      |                 |
| `review-new`  | `atry review new <run> self --tool <tool>` | `run`, `review`  | No self-review covers the current tree.          | `false`      |                 |
| `review-done` | `atry review done <run> self`            | `run`, `review`  | Self-review has started.                         | `false`      |                 |
| `review-new`  | `atry review new <run> cross --tool <tool> --model <model>` | `run`, `review`  | Cross-review has not started.                    | `false`      | `requiresModel` |
| `review-done` | `atry review done <run> cross`           | `run`, `review`  | Cross-review has started.                        | `false`      |                 |
| `close`       | `atry close <run> --preview`             | `run`            | The run is ready for a developer close decision. | `true`       |                 |
| `decide`      | `atry review decide <run> Q<n> <answer>` | `run`            | A review question is still open.                 | `true`       |                 |
| `none`        | `none`                                   |                  | The run is closed or abandoned.                  | `false`      |                 |
| `none`        | `atry list <run>`                        | `run` for a list | No pending task is ready to start.               | `false`      |                 |

`args.run` is the run id. `args.task` is a task id such as `T1`. `args.review`
is `self` or `cross`. `args.stage` is `implement`.

The two `approve` rows share the `approve` kind and the `--preview` command.
They differ in `reason`. `needsHuman` is true for `approve`, `close`, and
`decide`, because each one waits for a developer decision. It is also true for
`review-done` when `testCommand` is set.

`requiresModel` marks an action where the caller must pass `--model`. Only a
cross-review start carries it.

The table shows the command before `--run-tests` is added to `review-done`.

While a run is `planned`, `next` reads the plan files instead of recommending
`approve` straight away. It returns `plan new` when the overview or
`tasks.input.json` is missing, `plan done` when `10-plan/index.json` is missing,
`approve --preview` when a task file lacks Detail or Acceptance, and `approve`
(also `--preview`) when the plan is complete. When the caller does not pass a plan state, `next`
keeps the `approve` recommendation.

`task start` carries no `requiresSession`. The command has no `--session` flag.
A shared run calls `atry claim <run> <task> --session <tag>` before `task start`.

`kind` is `none` for a run that is closed or abandoned. It is also `none` for
`atry list <run>`, which reads the plan index and changes nothing. That action
carries `read: ["10-plan/index.json"]`, so the developer can see the blocked
tasks. A closed run carries no actions.

## Read Paths

| `kind`                              | `read`                                                       |
| ----------------------------------- | ------------------------------------------------------------ |
| `plan-new`                          | `10-plan/`                                                   |
| `plan-done`                         | `10-plan/` and `10-plan/tasks.input.json`                    |
| `approve`                           | `10-plan/overview.md` and `10-plan/index.json`               |
| `task-start`, `integrate`           | `10-plan/overview.md` and `10-plan/<task>.md`                |
| `stage-start`, `stage-done`         | `10-plan/overview.md` and `10-plan/index.json`               |
| `review-new`, `review-done` (self)  | `10-plan/overview.md` and `20-implement/`                    |
| `review-new`, `review-done` (cross) | the self paths and `30-self-review/`                         |
| `decide`                            | `30-self-review/` and `40-cross-review/`                     |
| `close`                             | `10-plan/overview.md`, `30-self-review/`, `40-cross-review/` |
| `none`                              | empty for a closed run; the plan index for `atry list`       |

`command` and `recommendation` stay in the payload. `schema` stays `1`.
