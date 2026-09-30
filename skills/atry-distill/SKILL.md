---
name: atry-distill
description: Use when the user wants to export a run's manifest, at any run state.
---

# Distill

## Overview

Exports a deterministic `$RUN_DIR/distill/manifest` via `atry distill`. Distill
is an export, not a lifecycle stage: it does not append history, edit
`meta.md`, or close the run. Manifest contract:
`references/file-conventions.md` ("Distill manifest").

## Preflight

<!-- BEGIN PREFLIGHT -->

Run `atry version` before anything else in this stage. If it fails, stop —
do not search the filesystem for helpers and do not fall back to running
`scripts/atry`, `scripts/runtime/*.sh`, or `~/.agent-relay/lib/*.sh` directly.
Tell the user to run `verify.sh` and fix what it reports (most often
`$HOME/.local/bin` missing from `PATH`). Run `atry` from the repo root, and
confirm each `atry resolve` / `atry run-init` call below prints `atry: using
<path>` on stderr. Full rule: `references/file-conventions.md` ("atry
preflight").

<!-- END PREFLIGHT -->

### Commands used in this stage

| Command                         | Meaning of a non-zero exit                                     |
| ------------------------------- | -------------------------------------------------------------- |
| `atry version`                  | atry missing/broken on PATH -- stop, see Preflight             |
| `atry resolve [RUN_ID or path]` | ambiguous or not found -- ask for the `RUN_ID` or path         |
| `atry distill <run-dir-or-id>`  | usage error, run not resolved, or no sha256 tool -- stop / fix |

## Instructions

1. Resolve the run:
   ```bash
   RUN_DIR="$(atry resolve [RUN_ID or path])"
   ```
2. Export the manifest:
   ```bash
   atry distill "$RUN_DIR"
   ```
3. Report the path and file count from stderr (`distill: wrote <path> (<N> files)`).

## Non-goals

- Do not write typed notes, summaries, or legacy vault/metrics content.
- Do not append `history.log` or run `atry close`.
- Do not invent lessons or parse plan/review markdown into structured records.
