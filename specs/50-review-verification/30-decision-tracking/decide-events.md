# Question Decisions & Reconciliation

When humans or agents resolve an open question raised in a review, the decision is formally committed via `atry review decide` (`src/core/decide.ts`).

## Command Interface

```bash
atry review decide <run> <question> <answer>
```

Example:

```bash
atry review decide 1792385260 Q1 1b
```

## Behavior

- Validates that the question identifier (e.g. `Q1`) exists in the latest review's `open` questions list.
- Appends an event with `action: "decided"`, `question`, `answer`, and `ref` (the review JSON path).
- `atry close` treats a question as resolved when a `decided` event has the same `ref` and `question`.
