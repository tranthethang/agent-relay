# Example self-review

`30-self-review/01.md`:

# self

## Findings

- `src/cli/commands.ts:42` prints the lifecycle twice with `--quiet --json`. Fixed.
- Style only: the name `quietLine` is clear. No code change.

- Q1: The quiet line joins the name and the lifecycle with a space, and a tab is easier to split. Which one ships?
  - a. Keep the space. Scripts split on the first space.
  - b. Use a tab. Scripts split on the tab.

`30-self-review/01.json`:

{ "schema": 1, "kind": "self", "tool": "unknown", "model": "opus", "fixed": 1, "open": [ { "q": "Which separator should the quiet line use?", "a": "Keep the space.", "b": "Use a tab." } ] }
