# Lock Contention and Recovery

`acquireRunLock` in `src/core/runlock.ts` serializes mutations for one run.

## Wait Loop

- The deadline is 10 seconds after the acquire starts.
- Each failed create waits 50ms, then tries again.
- There is no exponential backoff and no jitter.
- When the deadline passes, the command throws `RelayError("lock", "run lock timed out")`.

## Stale Lock Recovery

`waitForLock` reads the text and the mtime of `locks/run.lock`.

- If `Date.now() - mtimeMs` is less than 30 seconds, it waits 50ms.
- Otherwise it tries to create `locks/run.lock.break` with `wx`.
- With the break file, it reads the lock again. It deletes the lock only when the text and the mtime match the first read. Then it deletes the break file.
- Without the break file, another process is breaking the lock. A break file older than 30 seconds is deleted. The process waits 50ms.
- It does not parse the lock JSON to decide staleness.
- It does not print a diagnostic when it deletes a stale lock.

Two processes that see the same stale lock cannot both delete it. The second one finds a different lock under the break file and keeps it.

## Limits

- `releaseRunLock` reads the token and then deletes the file. A process that breaks the lock between those two steps loses its new lock. The lock must be older than 30 seconds first.
- A lock file from an older `atry` has no token. A new release keeps it until it is stale.
