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

## Action Kind

Each action holds a `kind`. A skill dispatches on `kind` and on `args`.
A skill does not match the text of `command`.

| `kind`        | Command shape                            | `args`           | Flags                     |
| ------------- | ---------------------------------------- | ---------------- | ------------------------- |
| `plan-new`    | `atry plan new <run>`                    | `run`            |                           |
| `plan-done`   | `atry plan done <run>`                   | `run`            |                           |
| `approve`     | `atry approve <run>`                     | `run`            |                           |
| `stage-start` | `atry stage start <run> implement`       | `run`, `stage`   |                           |
| `task-start`  | `atry task start <run> <task>`           | `run`, `task`    |                           |
| `integrate`   | `atry integrate <run> <task>`            | `run`, `task`    |                           |
| `stage-done`  | `atry stage done <run> implement`        | `run`, `stage`   |                           |
| `review-new`  | `atry review new <run> self`             | `run`, `review`  | `requiresModel` for cross |
| `review-done` | `atry review done <run> cross`           | `run`, `review`  |                           |
| `close`       | `atry close <run>`                       | `run`            |                           |
| `decide`      | `atry review decide <run> Q<n> <answer>` | `run`            |                           |
| `none`        | `none`, or `atry list <run>`             | `run` for a list |                           |

`args.run` is the run id. `args.task` is a task id such as `T1`. `args.review`
is `self` or `cross`. `args.stage` is `implement`.

`requiresModel` marks an action where the caller must pass `--model`. Only a
cross-review start carries it.

While a run is `planned`, `next` reads the plan files instead of recommending
`approve` straight away. It returns `plan new` when the overview or
`tasks.input.json` is missing, `plan done` when `10-plan/index.json` is missing,
`approve --preview` when a task file lacks Detail or Acceptance, and `approve`
when the plan is complete. When the caller does not pass a plan state, `next`
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
