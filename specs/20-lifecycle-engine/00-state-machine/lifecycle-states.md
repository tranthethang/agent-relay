# Lifecycle States

A run progresses through a sequence of discrete lifecycle states managed by the core lifecycle engine (`src/core/lifecycle.ts` and `src/core/reduce.ts`).

## State Definitions

| State          | Description                                                               | Invariants                                                         |
| -------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `planned`      | The run has been created and plan files are drafted or completed.         | Implementation cannot begin.                                       |
| `approved`     | The plan has received explicit approval (`--via confirm` or `--via arg`). | Tasks are unblocked for starting.                                  |
| `implementing` | One or more implementation tasks are in progress or completed.            | Changes to repository code are tracked.                            |
| `reviewing`    | `stage done implement` has completed. Reviews can start.                  | `atry close` refuses a reviewer delta unless `--ack-fixes` is set. |
| `closed`       | The run is successfully completed and verified.                           | Terminal state. No further mutations permitted.                    |
| `abandoned`    | The run was terminated prematurely with a recorded reason.                | Terminal state.                                                    |
