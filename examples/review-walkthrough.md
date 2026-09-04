## Self-Review — 2026-09-04

Implemented `/healthz` as a plain-text probe beside the existing top-level
routes, with a matching integration test. Skipped ops docs because there is no
probe list to extend yet.

## Cross-Review — 2026-09-04

Agreed with the self-review. Full diff from plan `base:` looks scoped and
consistent with the rest of `src/server/`. No further code changes.
