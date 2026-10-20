# Run Mutex Locking

To serialize concurrent state mutations, `src/core/runlock.ts` provides a file lock at `locks/run.lock`. `withRunLock` in `src/core/mutate.ts`, the drift write in `rebuildRun`, and worktree cleanup use it. Task claim locks live in `src/core/lock.ts`.

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
  "ts": "2026-10-19T06:00:00.000Z",
  "token": "3f9c0a6e1b2d4c5f8a7e6d5c4b3a2910"
}
```

`token` is 16 random bytes in hex. `acquireRunLock` returns it with the lock path.

## Release

`releaseRunLock` reads the lock file. It removes the file only when the file holds the same token. A lock that another process took after a stale break stays in place.

## Scoped Invocation

All state transitions execute wrapped inside `withRunLock()`:

```typescript
await withRunLock(runDir, async () => {
  // Read events, check gate preconditions, append new event, update cache
});
```

The callback receives the state from `rebuildRunLocked`, which does not take the lock again.

`rebuildRun` takes the lock only when `run.json` differs from the replay. It reads both files again under the lock and writes only when the drift remains.

`review done` holds the lock twice when a policy `testCommand` is set.
The test command runs between the two holds, so a long test run does not hold the lock.
