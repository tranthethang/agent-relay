# Base Commit Policy Loading

Policy configurations are not read from the current working tree. Instead, the CLI reads `.agent-relay.json` strictly from the git commit recorded as the run's `base` (`src/core/policy.ts`).

## Rationale

- Prevents an agent within a run from relaxing policy rules (e.g. removing required cross-reviews) to bypass gates.
- Guarantees that validation rules remain consistent across the entire life of the run.

## Loading Procedure

1. Read the `base` commit hash from the run's `created` event.
2. Execute `git show <base>:.agent-relay.json`.
3. If the file exists in the base commit:
   - Parse and validate JSON schema.
4. If the file does not exist in the base commit:
   - Apply secure defaults:
     - `requireReviews`: `["self", "cross"]`
     - `smallChange`: `20`
     - `testCommand`: `undefined`
