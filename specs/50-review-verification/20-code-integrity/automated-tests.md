# Automated Test Execution

Repository policies may declare an automated test command that runs before a review is recorded as completed (`src/core/testrun.ts`).

## Configuration

In `.agent-relay.json` at the base commit:

```json
{
  "testCommand": "npm test"
}
```

## Execution at `review done`

When `atry review done` runs:

1. Takes `locks/run.lock`, validates the review, and reads `testCommand` from the policy at the run's base commit.
2. When `testCommand` is not set, records `tests: "not-configured"` in the same lock hold.
3. When `testCommand` is set, records the working tree hash, then releases the lock.
4. Runs the command at the repository root through the platform shell, without the run lock.
   A long test run cannot make the run lock look stale to another `atry` process.
5. Takes the lock again and reloads the run.
   It refuses when the lifecycle is no longer `reviewing`.
   It refuses when another event for the same review stage was recorded while the tests ran.
6. Writes the last 200 stdout and stderr lines to `<NN>.test.log` in the review stage folder.
7. Records `tests: { exit, ms, tree }` in the completed event.
   `tree` is the working tree hash from step 3, the code the tests started on.

A non-zero exit is recorded. It does not refuse `review done`.
