# State Reducer

The reducer subsystem (`src/core/reduce.ts`) reconstructs the full in-memory state of a run by sequentially folding over the event stream in `events.jsonl`.

## Reducer Function

```typescript
function reduceEvents(events: readonly EventLine[]): RunState;
```

## State Derivation Logic

- Starts from `lifecycle: "planned"`, `stage: "plan"`, `approved: false`, and `tasks: []`.
- Applies each event in order.
- Sets `lifecycle` from `created`, `approved`, `started`, `completed` on `implement`, `closed`, and `abandoned`.
- Sets task status to `pending`, `in-progress`, `done`, or `skipped`.
- `claimed`, `stolen`, and `task-started` set `in-progress`. `released` clears `session` and leaves the status.
- `waived`, `rebased`, `cleaned`, and `drifted` do not change lifecycle, stage, or tasks.
- `RunState` does not store review pairs, question decisions, or waivers. Callers read those from the event list.
- `appendEvent` writes the reduced snapshot to `run.json`.
- `rebuildRun` compares `run.json` with the replay. It writes nothing when they match.
- On a difference, `rebuildRun` takes the run lock and compares again. When the difference remains, it appends a `run` `drifted` event, rewrites `run.json`, and prints a warning.
- `rebuildRunLocked` does the second step for a caller that already holds the run lock.
- Reading events also checks the `prev` hash chain. See [`event-schema.md`](event-schema.md).
