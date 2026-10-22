# Example cross-review

`40-cross-review/01.md`:

# cross-review

## Findings

- `src/cli/commands.ts:38` prints `undefined` without a run argument. Fixed.
- Style only: `quietLine` returns one string. No code change.

- Q1: The quiet line drops the run title, and a script cannot show the title later. Should the line keep the title?
  - a. Keep the short line. Use `--json` when the title matters.
  - b. Append the title. The line grows by one field.

`40-cross-review/01.json`:

{ "schema": 1, "kind": "cross", "tool": "cursor", "model": "opus", "fixed": 1, "open": [ { "q": "Should the quiet line keep the run title?", "a": "Keep the short line.", "b": "Append the title." } ] }
