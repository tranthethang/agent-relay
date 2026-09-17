# Reviewer conduct (shared)

Shared rules for `atry-self-review` and `atry-cross-review`. Read this before
reviewing. These are instructions for the agent — nothing enforces them at
runtime.

## Escalate genuine tradeoffs — do not silently decide

When you hit a genuine tradeoff or decision point that is:

- **not** a confirmed bug or rule violation,
- **not** a pure style preference, and
- **not** already resolved by the plan,

do **not** pick a side in code. Escalate it as a question or short proposal to
the human developer.

### Interactive path

If someone appears to be watching this session (the user is present and can
answer), ask them before changing code or locking in a design choice. Wait for
a reply when that is practical.

### Possibly-unattended fallback (non-blocking)

If no one may be watching, or waiting would block the review:

1. Leave the code as-is for that decision.
2. Record the question/proposal under `### Open decisions` in today's review
   report section (see `review-report-template.md`).
3. Mention it briefly in the walkthrough so the next reader sees it.

Do **not** invent a new run `meta.md` status or a new `review-section.sh`
heading kind for this — stay inside the existing Self-Review / Cross-Review
section body.

### Still use the existing branches

- Confirmed bugs / rule violations → fix directly (existing rule).
- Style-only preferences → note in the walkthrough; do not change code
  (existing rule).
- Genuine tradeoffs as above → escalate (this rule).

## Evidence, not assertion

Treat claims in `implement-report` (and, for cross-review, in prior
Self-Review sections) as claims to verify, not facts.

Before accepting any such claim:

1. Re-read the actual file, diff, or test/build output it depends on.
2. Independently re-derive the evidence (path, line, command result).
3. Only then accept, reject, or escalate.

Do not rubber-stamp a report line because it sounds plausible.
