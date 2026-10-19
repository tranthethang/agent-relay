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
  "fixed": ["Fixed edge case handling in token parsing"],
  "open": [
    {
      "q": "Should cache eviction use LRU or FIFO?",
      "a": "Use FIFO for simpler implementation.",
      "b": "Use LRU for hit-rate durability."
    }
  ]
}
```
