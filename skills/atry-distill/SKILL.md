---
name: atry-distill
description: Use when the user wants to export a run's manifest, at any run state.
---

# Distill

## Overview

This skill exports a deterministic `$RUN_DIR/distill/manifest` with
`atry distill`. Distill is an export. It is not a stage. It does not append to
the history, edit `meta.md`, or close the run. The manifest contract is in
`references/file-conventions.md` ("Distill manifest").

## Preflight

<!-- BEGIN PREFLIGHT -->

Run `atry version` before anything else in this skill. If it fails, stop.
Do not search the filesystem for helpers. Do not run `scripts/atry`,
`scripts/runtime/*.sh`, or `~/.agent-relay/lib/*.sh` directly.

Tell the user to run `verify.sh` and fix what it reports. The most common
cause is `$HOME/.local/bin` missing from `PATH`. Run `atry` from the repo
root. Confirm that each `atry resolve` and `atry run-init` call below prints
`atry: using <path>` on stderr. Full rule: `references/file-conventions.md`
("atry preflight").

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
3. Report the path and the file count from stderr (`distill: wrote <path> (<N> files)`).

## Non-goals

- Do not write typed notes, summaries, or legacy vault or metrics content.
- Do not append to `history.log`. Do not run `atry close`.
- Do not invent lessons. Do not parse plan or review markdown into structured
  records.
