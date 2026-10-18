# Architecture

Short map of agent-relay. This describes the current tree.

## What runs where

A person opens a tool and invokes a skill by name. The skill tells the agent
to call `atry`. The agent writes prose with its own editor. `atry` writes
`events.jsonl`, `run.json`, scaffolds, and locks.

```text
tool skill text
    -> atry (npm bin, dist/atry.js)
        -> <repo>/.agent-relay/<YMD>-<id>-<slug>/
```

This repo does not call agents or pick models.

## Layers

| Layer  | Location                           | Job                                            |
| ------ | ---------------------------------- | ---------------------------------------------- |
| Skills | `skills/<name>/`                   | Instructions plus `references/`                |
| CLI    | `src/cli/`                         | Commander router                               |
| Core   | `src/core/`                        | Schemas, events, gates, claim, review, distill |
| Tests  | `test/`                            | Vitest, including CLI end-to-end tests         |
| Sync   | `scripts/maint/sync-references.ts` | Copy convention parts into skill bundles       |

Build output is `dist/atry.js`. Git ignores `dist/`.

## State

`events.jsonl` is the source of truth. `run.json` is a cache rebuilt from
those events. Lifecycle values are `planned`, `approved`, `implementing`,
`reviewing`, `closed`, and `abandoned`.

Implement start requires `approved`. Close from `reviewing` reads the latest
completed review. The policy at the run's base commit determines which review
kinds are required. A missing policy uses self and cross reviews, with a
self-only exception for changes below 20 added and deleted lines.

The CLI records a Git tree for implementation completion and review start and
completion. It builds that tree with a temporary copy of the index and excludes
`.agent-relay/`. A review completion records edits made since its start.
Close checks the latest completed review against the current tree and refuses
an unacknowledged delta. `--ack-fixes` accepts that delta after the user agrees.
`--waive-review <reason>` records a waiver and skips those review checks.
Open questions still require `--ack-open`.

Every run state change uses `locks/run.lock`. The lock serializes CLI checks
and event writes. Direct edits to repository files do not take this lock.
