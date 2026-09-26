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

## Common rationalizations

Watch for these lines of reasoning in your own review pass. Each has either
already caused a real problem in this project or is a direct shortcut around a
rule above -- naming the excuse is usually enough to stop it.

| Rationalization                                                                            | What actually happens                                                                                                         | Rule it violates                                                        |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| "The implement-report says tests pass, so I don't need to re-run them."                    | The report is an unverified claim; a wrong report then ships silently.                                                        | Evidence, not assertion                                                 |
| "This is a small tradeoff, I'll just pick the sensible option myself."                     | A reviewer's private guess becomes an undocumented decision nobody else agreed to.                                            | Escalate genuine tradeoffs -- do not silently decide                    |
| "It's basically a style thing, but I'm already in the file so I'll just fix it."           | Turns a note into an unreviewed code change and expands scope beyond the plan.                                                | Style-only preferences go in the walkthrough, not the diff              |
| "No cross-review is scheduled for this one, so a lighter self-review is fine."             | Self-review may be the only independent check this change ever gets.                                                          | See "Model choice" in atry-self-review's SKILL.md                       |
| "The rollup file already shows `[done]`, I'll trust it and move on."                       | Rollups are generated output; a hand-edited rollup desyncs from the per-task `.status` files with nothing to flag it.         | Run `atry check` before trusting a rollup when `implement-plan/` exists |
| "I didn't find anything, but I should write _something_ so the review doesn't look empty." | Invented findings are worse than none; a documented clean pass, backed by the checklist you actually ran, is a valid outcome. | Do not invent findings to avoid a clean report                          |
