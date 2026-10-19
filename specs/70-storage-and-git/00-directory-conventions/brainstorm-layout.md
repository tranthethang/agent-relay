# Brainstorm Directory Layout

Brainstorms support preliminary exploratory investigation and question-and-answer discussions before creating an actionable run.

## Path Structure

`.agent-relay/brainstorms/{YMD}-{slug}/`

```text
.agent-relay/brainstorms/20261019-doc-refactor/
├── notes.md                     # Human & agent discussion notes and question cards
└── open.json                    # Open question cards serialized as JSON
```

## Invariants

- A brainstorm is not a run. It contains no `events.jsonl` and executes no code mutation gates.
- `atry run new --slug <slug> --title <title> --from <brainstorm>` links a new run back to its parent brainstorm.
