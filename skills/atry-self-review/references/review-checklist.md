# Review checklist (shared)

Shared checklist for `atry-self-review` and `atry-cross-review`. Check each item for each task.

1. Acceptance: mark each Acceptance line of each task met or unmet, with evidence.
   When an item does not apply, write `n/a` and a short reason under that task in the review markdown. Do not open a finding.
   Why: A task can pass every test and still miss what the plan asked for.
2. Tests: a test covers each changed behavior and fails without the change.
   Why: A test that passes without the change does not guard against a regression.
3. Edge cases and error paths: check empty input, a missing file, and a non-zero exit.
4. Input handling and secrets: paths stay under the repo, and no secret is in logs or files.
   Why: A path outside the repo or a leaked token causes damage that a revert cannot undo.
5. Locks and concurrency: each state change holds the run lock.
   Why: Two sessions that write without the lock can lose or reorder events.
6. Spec and doc drift: specs and the README match the code.
7. Scope: edits stay inside task `files`, or the extra path has a reason.
   Why: An unplanned edit escapes the review that the plan set up for it.
