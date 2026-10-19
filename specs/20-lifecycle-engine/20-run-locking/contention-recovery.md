# Lock Contention and Recovery

`withRunLock` in `src/core/mutate.ts` serializes mutations for one run.

## Wait Loop

- The deadline is 10 seconds after the acquire starts.
- Each failed create waits 50ms, then tries again.
- There is no exponential backoff and no jitter.
- When the deadline passes, the command throws `RelayError("lock", "run lock timed out")`.

## Stale Lock Recovery

`waitForLock` stats `locks/run.lock`.

- If `Date.now() - mtimeMs` is at least 30 seconds, it deletes the file and retries the create.
- It does not parse the lock JSON to decide staleness.
- It does not print a diagnostic when it deletes a stale lock.
