# Example self-review

`30-self-review/01.md`:

# self

## Findings

- F1: `src/cli/commands.ts:42` prints the lifecycle twice with `--quiet --json`. Fixed.
- F2: The implement report says `--quiet` ignores `--json`. The test shows it does not. Rejected.
- Style only: the name `quietLine` is clear. No code change.

- Q1: The quiet line joins the name and the lifecycle with a space, and a tab is easier to split. Which one ships?
  - a. Keep the space. Scripts split on the first space.
  - b. Use a tab. Scripts split on the tab.

## Acceptance

- T1: met

`30-self-review/01.json`:

{ "schema": 1, "kind": "self", "tool": "unknown", "model": "opus", "findings": [ { "id": "F1", "severity": "medium", "file": "src/cli/commands.ts", "line": 42, "status": "fixed", "evidence": "The test printed the lifecycle twice." }, { "id": "F2", "severity": "low", "file": null, "line": null, "status": "rejected", "evidence": "test/status.test.ts asserts one line with --quiet --json." } ], "open": [ { "q": "Which separator should the quiet line use?", "a": "Keep the space.", "b": "Use a tab." } ] }
