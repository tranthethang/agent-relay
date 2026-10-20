# Run Mutex Locking

To serialize concurrent state mutations, `src/core/mutate.ts` takes a file lock at `locks/run.lock`. Task claim locks live in `src/core/lock.ts`.

## Atomic Creation

- Uses Node.js `open(path, "wx")` (`O_CREAT | O_EXCL`).
- If the file exists, `open` fails immediately with `EEXIST`.
- If the file does not exist, the kernel atomically creates it and returns the file descriptor.

## Lock Payload

The acquired lock file contains diagnostic metadata in JSON format:

```json
{
  "pid": 12345,
  "host": "build-runner-01",
  "ts": "2026-10-19T06:00:00.000Z"
}
```

## Scoped Invocation

All state transitions execute wrapped inside `withRunLock()`:

```typescript
await withRunLock(runDir, async () => {
  // Read events, check gate preconditions, append new event, update cache
});
```

`review done` holds the lock twice when a policy `testCommand` is set.
The test command runs between the two holds, so a long test run does not hold the lock.
