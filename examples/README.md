# Examples

Sample `.agent-relay/` artifacts for the pipeline described in
[`docs/file-conventions.md`](../docs/file-conventions.md). Copy these into a
target project as a starting point, or use them as a shape reference when a
skill asks you to write the corresponding file.

**Canonical runtime names** use a shared NanoID suffix, e.g.
`plan-V1StGXR8_Z.md`, `implement-plan-V1StGXR8_Z.md`, … plus
`.agent-relay/CURRENT` containing that id. The files below keep short names for
readable links; when you copy them into a real project, rename to `*-<id>.md`
and set `CURRENT`.

| File                                             | Role                                     |
| ------------------------------------------------ | ---------------------------------------- |
| [`plan.md`](plan.md)                             | Master plan with `base:` + `id:` headers |
| [`implement-plan.md`](implement-plan.md)         | Task list written before coding          |
| [`implement-report.md`](implement-report.md)     | Per-task notes after coding              |
| [`review-report.md`](review-report.md)           | Self-review + appended cross-review      |
| [`review-walkthrough.md`](review-walkthrough.md) | Narrative for the next reviewer          |
