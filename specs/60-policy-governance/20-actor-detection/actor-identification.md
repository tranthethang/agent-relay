# Actor Identification

The CLI maintains honest labeling regarding whether approval or close actions originated from human developers or automated agent environments (`src/core/detect.ts`).

## Actor Categories

- **`agent-env`**: Recorded when runtime markers indicate execution within an automated environment (e.g. `CODEX_THREAD_ID`).
- **`unknown`**: Recorded in other terminal shells where an explicit human-versus-agent distinction cannot be cryptographically proven.

## Design Rule

The CLI avoids false security claims. Passing `--via confirm` does not prove that a human pressed a confirmation button; it is an audit trail marker until paired with host tool execution permissions.
