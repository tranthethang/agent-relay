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
| Sync   | `scripts/maint/sync-references.sh` | Copy convention parts into skill bundles       |

Build output is `dist/atry.js`. Git ignores `dist/`.

## State

`events.jsonl` is the source of truth. `run.json` is a cache rebuilt from
those events. Lifecycle values are `planned`, `approved`, `implementing`,
`reviewing`, `closed`, and `abandoned`.

Implement start requires `approved`. Close from `reviewing` reads the latest
completed review. Open questions block close unless `--ack-open` is set.
