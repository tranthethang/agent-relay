# Lock Stealing with TTL

If an agent process terminates abruptly or fails to make progress, its task claim lock can be safely acquired by another session via `atry steal` (`src/core/claim.ts`).

## Invocation

```bash
atry steal <run> <task> --session <tag> --ttl <minutes>
```

## Algorithm

1. The run must be `implementing`. The task must not be `done` or `skipped`. Its dependencies must be clear.
2. Create `locks/<task>.steal` so a second steal cannot start. Remove that file when the command finishes.
3. Read `locks/<task>.lock`. Age is `Date.now() - Date.parse(lock.ts)`.
4. If the age is below `ttl` minutes, throw `RelayError("lock", ...)`.
5. If the age is at least `ttl` minutes, delete the old lock and create a new one for the session.
6. Append an event with `action: "stolen"` and the current working-tree hash.
