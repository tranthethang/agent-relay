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
      "command": "atry task start 1792385260 T1",
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
