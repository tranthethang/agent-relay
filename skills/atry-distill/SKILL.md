---
name: atry-distill
description: Use when the user wants to export a run manifest, at any run state.
requires-atry: ">=0.1.0"
---

# Distill

## Overview

This skill writes `90-distill/manifest.json` for one run. It does not close the run.

## Preflight

<!-- BEGIN PREFLIGHT -->

Run `atry preflight --requires "<requires-atry>"` before any other command in this skill.
Stop when that command exits non-zero.
When `atry` reports an unknown command, tell the user to run `npm i -g @tranthethang/agent-relay@latest`.
When this skill names a run, call `atry context <run> --json` first.

<!-- END PREFLIGHT -->

## Steps

1. Call `atry context <run> --json` when the user names a run.
2. Run `atry distill <run>`.
3. Tell the user the manifest path and the file count.

Stop when the command fails. Show the field path to the user.

## Non-goals

Do not write a summary. Do not edit the manifest by hand. Do not run `atry close`.
