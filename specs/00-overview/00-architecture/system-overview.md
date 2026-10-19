# System Overview

`agent-relay` is a deterministic relay system for AI-assisted software development. It provides structured handoffs between human developers and autonomous AI agents across distinct workflow stages.

## Design Philosophy

### Thick CLI, Thin Skills

Agent skills consist of minimal instruction files (`SKILL.md`) that guide AI models. Complex business logic, state machines, and gate enforcement live inside the TypeScript CLI binary (`atry`).

- Skill files consume fewer tokens in prompt contexts.
- Gate validation occurs deterministically in compiled code rather than probabilistically in model reasoning.
- Tool commands provide machine-readable JSON outputs with deterministic next-step recommendations.

### Data Trust Model

Data within a run directory falls into three distinct trust tiers:

| Tier    | Source             | Examples                                                                | Trust Level               |
| ------- | ------------------ | ----------------------------------------------------------------------- | ------------------------- |
| Level 1 | System-measured    | Git commit hashes, working tree hashes, test command results, run locks | High (Verifiable)         |
| Level 2 | Agent-reported     | Task completions, review findings, model identifiers                    | Medium (Validated by CLI) |
| Level 3 | Unstructured prose | Markdown descriptions, reasoning notes                                  | Informational (Unparsed)  |

The CLI enforces gates based on Level 1 measurements whenever possible.

## Operating Boundaries

- The CLI does not execute external AI models directly.
- The CLI does not schedule background daemon processes.
- All state changes persist as append-only records in `events.jsonl`.
- Worktrees and file edits remain strictly under version control.
