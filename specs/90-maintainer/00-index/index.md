# Documentation index

Maintainer docs for this repository. End-user install and limits stay in the
root [`README.md`](../../../README.md). Agent constraints for editing the repo are in
[`AGENTS.md`](../../../AGENTS.md).

| Doc                                                                  | Read when you need to…                           |
| -------------------------------------------------------------------- | ------------------------------------------------ |
| [architecture.md](../50-architecture/architecture.md)                | See how the CLI, skills, and run directory fit   |
| [core.md](../../70-storage-and-git/00-directory-conventions/core.md) | Name and layout rules for `.agent-relay/`        |
| [installer.md](../10-install/installer.md)                           | Install skills and the npm CLI                   |
| [skills-authoring.md](../70-skills-authoring/skills-authoring.md)    | Edit or add a skill bundle                       |
| [task-claim.md](../60-task-claim/task-claim.md)                      | Maintain claim, release, and file-overlap checks |
| [testing.md](../20-testing/testing.md)                               | Run or extend the vitest suites                  |
| [release.md](../30-release/release.md)                               | Cut an `X.M.Z` release and publish npm `latest`  |
| [security.md](../40-security/security.md)                            | Understand trust boundaries                      |
| [next-features.md](../90-next-features/next-features.md)             | Read planned gaps, intent, and fix direction     |
| [troubleshooting.md](../80-troubleshooting/troubleshooting.md)       | Triage install, gate, and lock failures          |

## Technical specifications

Detail design and diagrams live in the numbered folders next to this one:

- [`00-overview`](../../00-overview/): System architecture, layers, glossary, and sequence diagrams.
- [`10-cli-runtime`](../../10-cli-runtime/): Router, exit codes, discovery, output protocol, and preflight.
- [`20-lifecycle-engine`](../../20-lifecycle-engine/): State machine, event sourcing, locking, and transitions.
- [`30-task-management`](../../30-task-management/): Task schemas, DAG dependencies, transitions, and scope tracking.
- [`40-concurrency-control`](../../40-concurrency-control/): Task claim, file overlap algorithm, TTL stealing, and guarding.
- [`50-review-verification`](../../50-review-verification/): Review workflows, diversity matrix, test automation, and question cards.
- [`60-policy-governance`](../../60-policy-governance/): Policy schemas, trust boundaries, actor detection, and waivers.
- [`70-storage-and-git`](../../70-storage-and-git/): Run layouts, temporary git index isolation, and distill manifests.
- [`80-skills-integration`](../../80-skills-integration/): Thin skills bridge, prompt contracts, and sync pipelines.

Related root files: [`CONTRIBUTING.md`](../../../CONTRIBUTING.md)
and [`ROADMAP.md`](../../../ROADMAP.md). Release notes are the
[GitHub Releases](https://github.com/tranthethang/agent-relay/releases).
