# Reviewer Code Delta Tracking

`atry review done` in `src/core/review.ts` measures code changes made during the review. `atry close` in `src/core/lifecycle.ts` refuses a non-zero delta unless `--ack-fixes` is set.

## Tree Hash Comparison

- At `atry review new`:
  - Captures start tree hash $H_{\text{start}}$.
- At `atry review done`:
  - Captures finish tree hash $H_{\text{done}}$.
- If $H_{\text{start}} \neq H_{\text{done}}$:
  - Generates a git diff between $H_{\text{start}}$ and $H_{\text{done}}$.
  - Computes the modified files, total lines added, and total lines deleted.
  - Records this delta in the review completion event.

## Close Requirement

If a review records a non-zero reviewer delta, `atry close` refuses by default. The human operator must explicitly supply `--ack-fixes` to confirm that the changes made during review have been inspected and accepted.
