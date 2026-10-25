---
name: atry-distill
description: "Export an agent-relay run manifest with atry. Use this when the user wants a distill of the run at any state, including an open plan or a closed run. Do not use it to implement tasks, to review findings, or to rewrite the run history."
requires-atry: ">=0.10.7"
---

# Distill

## Overview

This skill writes `90-distill/manifest.json` for one run. It does not close the run.

## Preflight

<!-- BEGIN PREFLIGHT -->

Run `atry preflight --requires "<requires-atry>"` before any other command in this skill.
Stop when that command exits non-zero. A dev build needs `--allow-dev` or `ATRY_DEV=1`; do not use a dev build for a real run.
When `atry` reports an unknown command, tell the user to run `npm i -g @tranthethang/agent-relay@latest`.
When this skill names a run, call `atry context <run> --json` first.
Read `references/file-conventions.md` before you edit a run file.
When the context JSON has `run.worktree`, edit files and run git in `run.worktree.path`.
A claim result with `worktree.path` takes precedence over `run.worktree.path`.

<!-- END PREFLIGHT -->

## Steps

1. Call `atry context <run> --json` when the user names a run.
2. Run `atry distill <run>`.
3. Tell the user the manifest path and the file count.
4. When the run is not closed, tell the user that a later stage makes the manifest stale.
   Why: A manifest from an open run misses the files that later stages write.

Stop when the command fails. Show the field path to the user.

## Non-goals

Do not write a summary. Do not run `atry close`.
Do not edit the manifest by hand.
Why: A hand edit makes the manifest disagree with the run files that `atry distill` read.
