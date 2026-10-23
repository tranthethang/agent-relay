# Review Pairs

Verification reviews are organized in numbered pairs consisting of a Markdown narrative and a companion JSON metadata file (`src/core/review.ts`).

## Directory Organization

- Self reviews: `30-self-review/`
- Cross reviews: `40-cross-review/`

File naming increments sequentially:

- First round: `01.md` and `01.json`
- Second round: `02.md` and `02.json`
- Earlier pairs remain immutable historical records.

## Pair Formats

### 1. Markdown Narrative (`01.md`)

```markdown
# self

## Summary

Summary of changes evaluated.

## Findings

Specific observations, defects fixed, and open questions:

- Q1: Should cache eviction use LRU or FIFO?
  - a. Use FIFO for simpler implementation.
  - b. Use LRU for hit-rate durability.
```

### 2. JSON Metadata (`01.json`)

```json
{
  "schema": 1,
  "kind": "self",
  "tool": "antigravity",
  "model": "gemini-3.8-flash",
  "fixed": 1,
  "open": [
    {
      "q": "Should cache eviction use LRU or FIFO?",
      "a": "Use FIFO for simpler implementation.",
      "b": "Use LRU for hit-rate durability."
    }
  ]
}
```

`fixed` is a count of defects fixed in that round, not a list.

## Close Rules for Pairs

- An open question in the latest review fails `atry close` with field `open` and exit 4. `--ack-open` accepts the question.
- A reviewer delta in the latest review appears as `changes made during the latest review`. A strict close needs `--ack-fixes`. A soft close needs `--ack-warnings`.
- A cross-review delta needs a self-review completed after it. `atry close` fails with field `review.self` until that self-review exists.

## Deprecated Keys

`tests` was removed from the JSON metadata. An older run may still carry it.
The CLI reads the key, ignores its value, and never writes it in a new pair.
Every other unknown key makes the parse fail, and `atry status` reports the
file with a warning instead of hiding the run.
