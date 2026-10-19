# Prompt Contract (`atry next`)

The `atry next <run> --json` command serves as an executable prompt contract between the CLI engine and autonomous AI agents (`src/core/next.ts`).

## Contract Payload Schema

```json
{
  "schema": 1,
  "command": "atry task start 1792385260 T1",
  "reason": "An implement task is still open.",
  "needsHuman": false,
  "read": [
    "10-plan/overview.md",
    "10-plan/T1.md"
  ]
}
```

## Field Semantics

- **`command`**: The exact shell command string the agent should execute next. If no action is possible or required, returns `"none"`.
- **`reason`**: A single human-readable explanatory sentence describing why this step was chosen.
- **`needsHuman`**: A boolean flag indicating whether the step requires explicit human approval or interactive confirmation.
- **`read`**: An array of file paths that the agent should read into context before executing the command.
