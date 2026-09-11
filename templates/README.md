# Templates

Empty outlines for the files in [`docs/file-conventions.md`](../docs/file-conventions.md).
This directory is not a set of examples from a real run.
These are not a recorded run. There is no sample feature, no test result, and
no claim that a review found or missed anything.

Copy a template into a target repo only as a starting outline. Rename it to
the runtime name (`plan-<id>.md`, and so on) and set `.agent-relay/CURRENT`
to that same id. Do not commit the placeholder lines as if they described work
that happened.

| File | Runtime name |
| --- | --- |
| [`plan.md`](plan.md) | `.agent-relay/plan-<id>.md` |
| [`implement-plan/`](implement-plan/) | `.agent-relay/implement-plan-<id>/` |
| [`implement-report.md`](implement-report.md) | `.agent-relay/implement-report-<id>.md` |
| [`review-report.md`](review-report.md) | `.agent-relay/review-report-<id>.md` |
| [`review-walkthrough.md`](review-walkthrough.md) | `.agent-relay/review-walkthrough-<id>.md` |

Note: The legacy single-file format (`.agent-relay/implement-plan-<id>.md`) is still valid for sequential runs; see [`docs/file-conventions.md`](../docs/file-conventions.md#parallel-task-implementation-optional).

