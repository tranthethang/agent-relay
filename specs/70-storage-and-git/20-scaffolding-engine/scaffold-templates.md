# Scaffolding Engine & Templates

The scaffolding engine (`src/core/scaffold.ts`) creates standardized directory hierarchies and boilerplate markdown/JSON documents.

## Scaffolding Points

1. **`createRun()`**:
   - Creates the run directory.
   - Creates `locks/` directory.
   - Appends the initial `created` event line to `events.jsonl`.
   - Generates initial `run.json`.

2. **`planNew()`**:
   - Creates `10-plan/`.
   - Writes `10-plan/overview.md` boilerplate (Goal, Non-goals, Decisions, Constraints, Flow).
   - Writes initial `10-plan/tasks.input.json`.

3. **`reviewNew()`**:
   - Creates `30-self-review/` or `40-cross-review/`.
   - Inspects existing files to compute next incremental prefix (`01`, `02`, ...).
   - Writes Markdown review narrative and companion JSON metadata.
