# Automated Test Execution

Repository policies may declare an automated test command that must pass before any review can be recorded as completed (`src/core/testrun.ts`).

## Configuration

In `.agent-relay.json` at the base commit:

```json
{
  "testCommand": "npm test"
}
```

## Execution at `review done`

When `atry review done` runs:

1. Checks if `testCommand` is defined in the policy loaded from the run's base commit.
2. If defined:
   - Spawns the test command with `PAGER=cat`.
   - Streams output to `.agent-relay/<run>/30-self-review/<NN>.test.log`.
   - Measures elapsed wall-clock duration in milliseconds.
   - If the process exits with a non-zero code, `review done` fails and aborts without appending a completed event.
3. If successful, records `test: { exitCode: 0, durationMs: ... }` in the review event.
