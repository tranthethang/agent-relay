# Glossary & Definitions

Standard terms used across the codebase, CLI messages, and documentation:

| Term               | Definition                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| **Run**            | An isolated working directory at `.agent-relay/{YMD}-{id}-{slug}/` tracking an end-to-end task workflow.       |
| **Stage**          | A distinct phase within a run: `plan`, `implement`, `self-review`, or `cross-review`.                          |
| **Stage Folder**   | Sub-directories within a run: `10-plan`, `20-implement`, `30-self-review`, `40-cross-review`, or `90-distill`. |
| **Task**           | A single atomic work unit declared in `10-plan/index.json` with an identifier like `T1` to `T8`.               |
| **Task Breakdown** | Implementation progress notes and reports located under `20-implement/`.                                       |
| **Claim**          | A task assignment lock held by a specific agent session, recorded in `locks/T<n>.lock`.                        |
| **Review**         | A review pair consisting of a markdown report and a companion JSON metadata file (e.g. `01.md` and `01.json`). |
| **Distill**        | An export manifest containing SHA-256 hashes of all files in the run directory.                                |
| **Approve**        | The formal human or agent-env approval of a plan before implementation begins.                                 |
| **Close**          | The terminal completion of a run verifying tree matches and review completeness.                               |
| **Abandon**        | The terminal cancellation of an incomplete run with a recorded reason.                                         |
| **Brainstorm**     | An exploratory discussion directory at `.agent-relay/brainstorms/{YMD}-{slug}/`.                               |
| **Events**         | The append-only ledger `events.jsonl` serving as the source of truth for run state.                            |
| **Run Lock**       | An atomic mutex file `locks/run.lock` ensuring state consistency across concurrent operations.                 |
