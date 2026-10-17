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

This skill needs `requires-atry` in its front matter.
Run `atry version --json` before any other command in this skill.
Stop when the output is not a JSON object with `schema` and `version`, and tell the user to run `npm i -g @tranthethang/agent-relay@latest`.
Read the `version` string from that JSON.
Split both versions on `.` and compare the numbers from the left.
Find the first pair of numbers that differ. Ignore the numbers after that pair.
Stop when the required number in that pair is higher than the installed number.
Tell the user to run `npm i -g @tranthethang/agent-relay@latest`.
Do not search the filesystem for helpers.
Do not run files under `scripts/` or `~/.agent-relay/lib/`.
When this skill names a run, call `atry context <run> --json` first.

<!-- END PREFLIGHT -->

## Steps

1. Call `atry context <run> --json` when the user names a run.
2. Run `atry distill <run>`.
3. Tell the user the manifest path and the file count.

Stop when the command fails. Show the field path to the user.

## Non-goals

Do not write a summary. Do not edit the manifest by hand. Do not run `atry close`.
