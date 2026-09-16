# Templates

Empty outlines for the files in [`docs/file-conventions.md`](../docs/file-conventions.md).
This directory is not a set of examples from a real run.
These are not a recorded run. There is no sample feature, no test result, and
no claim that a review found or missed anything.

Copy a template into a target repo under `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/`
only as a starting outline. Do not commit the placeholder lines as if they
described work that happened.

| File | Runtime name |
| --- | --- |
| [`meta.md`](meta.md) | `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/meta.md` |
| [`history.log`](history.log) | `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/history.log` (optional) |
| [`plan.md`](plan.md) | `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/plan.md` |
| [`implement-plan/`](implement-plan/) | `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/implement-plan/` (parallel) |
| [`implement-report/`](implement-report/) | `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/implement-report/` (parallel) |
| [`implement-report.md`](implement-report.md) | `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/implement-report.md` (sequential / rollup) |
| [`review-report.md`](review-report.md) | `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/review-report.md` |
| [`review-walkthrough.md`](review-walkthrough.md) | `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/review-walkthrough.md` |

Note: Sequential mode uses `implement-plan.md` directly. Parallel mode uses
`implement-plan/` and `implement-report/`; see
[`docs/file-conventions.md`](../docs/file-conventions.md#parallel-task-implementation-optional).
