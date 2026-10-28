# Example cross-review

`40-cross-review/01.md`:

# cross

## Findings

- F1: `src/cli/commands.ts:38` prints `undefined` without a run argument. Fixed.
- F2: The self-review says `--quiet` exits 1 on a closed run. The command exits 0. Rejected.
- Style only: `quietLine` returns one string. No code change.

- Q1: Should the quiet line keep the run title?
  - a. Keep the short line. Use `--json` when the title matters.
    The quiet flag targets one-field log lines.
  - b. Append the title. Recommended.
    Scripts that only read the quiet line can still show the title.

## Acceptance

- T1: met

`40-cross-review/01.json`:

{ "schema": 1, "kind": "cross", "tool": "cursor", "model": "opus", "findings": [ { "id": "F1", "severity": "high", "file": "src/cli/commands.ts", "line": 38, "status": "fixed", "evidence": "The command printed undefined for a missing run argument." }, { "id": "F2", "severity": "low", "file": null, "line": null, "status": "rejected", "evidence": "A closed run exits 0 in the command output." } ], "open": [ { "q": "Should the quiet line keep the run title?", "a": "Keep the short line.", "b": "Append the title. Recommended." } ] }
