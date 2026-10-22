# Review Lifecycle

The review workflow enforces a two-step cycle: scaffolding initialization followed by comprehensive validation (`src/core/review.ts`).

`atry close <run> --preview` lists missing reviews, tree mismatches, reviewer
changes, open items, and failed tests. When `strict.reviewIntegrity` is false,
these items are warnings. The developer can choose to continue by invoking
`atry close` with `--via confirm` or `--via arg`. The close event records any
warnings. When the setting is true, existing close gates remain in force.

`atry review done` records a `delta` when the reviewer changed code after that
review started. A cross-review delta needs a self-review completed after it,
because the earlier self-review did not see that code. `atry close` refuses the
run until one is recorded, and `--ack-fixes` does not replace it.
`atry next` recommends `atry review new <run> self` in that state. With
`strict.reviewIntegrity` false, the missing self-review is one more warning.

## Review Lifecycle Steps

```mermaid
sequenceDiagram
    participant Reviewer as Reviewing Agent
    participant CLI as atry CLI
    participant FS as File System
    participant Git as Git Engine

    Reviewer->>CLI: atry review new <run> <self|cross> --tool <t> [--model <m>]
    CLI->>Git: Capture working tree hash at review start
    CLI->>FS: Scaffold next pair: XX.md and XX.json
    CLI-->>Reviewer: Ready for review prose

    Note over Reviewer: Reviewer reads diff, inspects code, fills findings & open questions

    Reviewer->>CLI: atry review done <run> <self|cross>
    CLI->>FS: Count "- Q<n>:" cards in Markdown vs open array in JSON
    alt Mismatch
        CLI-->>Reviewer: Refuse: Question count mismatch
    end
    CLI->>Git: Capture tree hash for tests, then release the run lock
    CLI->>Git: Execute base testCommand if configured, without the run lock
    CLI->>FS: Take the run lock again and refuse if the review stage changed
    CLI->>Git: Capture current working tree hash
    CLI->>Git: Compute reviewer delta (files, lines added, lines deleted)
    CLI->>FS: Append review completed event to events.jsonl
    CLI-->>Reviewer: Review validated and recorded
```
