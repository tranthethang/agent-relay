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

Each finding with its id, then the open questions:

- F1: `src/cache.ts:42` evicts the newest entry. Fixed.
- Q1: Should cache eviction use LRU or FIFO?
  - a. Use FIFO for simpler implementation.
  - b. Use LRU for hit-rate durability.

## Acceptance

- T1: met
- T2: unmet F1
```

### 2. JSON Metadata (`01.json`)

```json
{
  "schema": 1,
  "kind": "self",
  "tool": "antigravity",
  "model": "gemini-3.8-flash",
  "findings": [
    {
      "id": "F1",
      "severity": "high",
      "file": "src/cache.ts",
      "line": 42,
      "status": "fixed",
      "evidence": "The eviction test failed before the change."
    }
  ],
  "open": [
    {
      "q": "Should cache eviction use LRU or FIFO?",
      "a": "Use FIFO for simpler implementation.",
      "b": "Use LRU for hit-rate durability."
    }
  ]
}
```

A finding is `{ id, severity, file, line, status, evidence }`.

- `id` is `F<n>` and is unique in one review. `review done` refuses an id that the review markdown does not contain.
- `severity` is `high`, `medium`, or `low`.
- `status` is `fixed`, `open`, or `rejected`. Put the reason for `rejected` in `evidence`.
- `file` is a repo-relative path, or `null` for a finding with no single file. `line` is a positive integer or `null`.
- `evidence` is a non-empty string.

A finding is a defect claim. A question card is a tradeoff for the user. They stay separate.
The scaffold writes `findings: []`. An older review JSON with `fixed` as a number and no `findings` still parses as a review with no findings.
The CLI never writes `fixed`. A file with both `fixed` and `findings` fails the parse with field `fixed`.

## Acceptance Section

The review markdown has an `## Acceptance` section. The `review new` scaffold writes the heading with no lines.
The section holds the lines from the heading to the next `## ` heading or the end of the file.
Each task in `10-plan/index.json` whose state is not `skipped` needs exactly one line in that section:

- `- T<n>: met` when each Acceptance item of the task holds.
- `- T<n>: unmet F<k>` when an item does not hold. `F<k>` is the finding for the gap. A line can name more than one id, separated by spaces.

A line matches `^- (T[1-9]\d*): (met|unmet( F[1-9]\d*)+)$`. Trailing spaces are ignored. A line for a skipped or unknown task is ignored.

`review done` refuses with exit 2 and records no event when:

| Check                                                          | Field                              |
| -------------------------------------------------------------- | ---------------------------------- |
| The section is missing                                         | `<review>.json:## Acceptance`      |
| A task has no valid line                                       | `<review>.json:## Acceptance:T<n>` |
| A task has more than one line                                  | `<review>.json:## Acceptance:T<n>` |
| An `unmet` line names an id that is not in the JSON `findings` | `<review>.json:## Acceptance:T<n>` |

`<review>` is the review path in the run, such as `30-self-review/01`.
The check runs after the question card check and before the finding id check.

## Close Rules for Pairs

- An open question in the latest review fails `atry close` with field `open` and exit 4. `--ack-open` accepts the question.
- An open `high` finding in the latest review of a required kind fails `atry close` with field `findings` and exit 4. Fix it, or set it to `rejected` with evidence in a new review. No ack flag passes it.
- A reviewer delta in the latest review appears as `changes made during the latest review`. A strict close needs `--ack-fixes`. A soft close needs `--ack-warnings`.
- A cross-review delta needs a self-review completed after it. `atry close` fails with field `review.self` until that self-review exists.

## Deprecated Keys

`tests` was removed from the JSON metadata. An older run may still carry it.
The CLI reads the key, ignores its value, and never writes it in a new pair.
Every other unknown key makes the parse fail, and `atry status` reports the
file with a warning instead of hiding the run.
