# Reviewer conduct (shared)

Shared rules for `atry-self-review` and `atry-cross-review`. Read this before
you review. These are instructions for the agent. Nothing enforces them at
runtime.

## Escalate genuine tradeoffs — do not choose in silence

A genuine tradeoff is a choice that meets all three tests:

- It is not a confirmed bug or rule violation.
- It is not a pure style preference.
- The plan does not already resolve it.

For a genuine tradeoff, do **not** pick a side in code. Escalate it to the
human developer as a question or a short proposal.

Write each open decision as a question card (`references/writing.md`,
"Question card"):

```markdown
- Q1: <question>
  - a. <smaller change>
  - b. <durable change>
- Q2: <question>
  - Need: <the data or check that is missing>
```

If the evidence does not support two real options, write the `Need:` line. Do
not invent options to fill the card. The developer replies with `1a`, `2b`, or
a free-text answer.

### Interactive path

If someone watches this session and can answer, ask them before you change
code or fix a design choice. Wait for a reply when that is practical.

### Possibly-unattended fallback (non-blocking)

If no one watches, or if waiting blocks the review:

1. Leave the code as it is for that choice.
2. Record the question or proposal under `### Open decisions` in the review
   report section of today (see `review-report-template.md`).
3. Mention it in the walkthrough, so the next reader sees it.

Do **not** invent a new `meta.md` status or a new `review-section.sh` heading
kind. Stay inside the existing Self-Review or Cross-Review section body.

### Still use the existing branches

- Confirmed bugs and rule violations: fix them directly (existing rule).
- Style-only preferences: write a note in the walkthrough. Do not change the
  code (existing rule).
- Genuine tradeoffs: escalate them (this rule).

## Evidence, not assertion

Treat each assertion in `implement-report` as an assertion to verify. In
cross-review, treat each assertion in earlier Self-Review sections the same
way. An assertion is not a fact.

Before you accept an assertion:

1. Re-read the file, the diff, or the test or build output that it depends on.
2. Derive the evidence again yourself (path, line, command result).
3. Then accept it, reject it, or escalate it.

Do not accept a report line because it sounds plausible.

## Common rationalizations

Watch for these lines of reasoning in your own review. Each one already caused
a real problem in this project, or it skips a rule above. When you name the
excuse, you usually stop it.

| Rationalization                                                                            | What actually happens                                                                                                         | Rule it violates                                                        |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| "The implement-report says tests pass, so I don't need to re-run them."                    | The report is an unverified assertion. A wrong report then ships unnoticed.                                                   | Evidence, not assertion                                                 |
| "This is a small tradeoff, I'll just pick the sensible option myself."                     | A reviewer's private guess becomes an undocumented decision nobody else agreed to.                                            | Escalate genuine tradeoffs -- do not choose in silence                  |
| "It's basically a style thing, but I'm already in the file so I'll just fix it."           | Turns a note into an unreviewed code change and expands scope beyond the plan.                                                | Style-only preferences go in the walkthrough, not the diff              |
| "No cross-review is scheduled for this one, so a lighter self-review is fine."             | Self-review may be the only independent check this change ever gets.                                                          | See "Model choice" in atry-self-review's SKILL.md                       |
| "The rollup file already shows `[done]`, I'll trust it and move on."                       | Rollups are generated output; a hand-edited rollup desyncs from the per-task `.status` files with nothing to flag it.         | Run `atry check` before trusting a rollup when `implement-plan/` exists |
| "I didn't find anything, but I should write _something_ so the review doesn't look empty." | Invented findings are worse than none; a documented clean pass, backed by the checklist you actually ran, is a valid outcome. | Do not invent findings to avoid a clean report                          |
