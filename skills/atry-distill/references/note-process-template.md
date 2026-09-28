---
type: process
project: <BANK_ATRY_NAME-or-omit>
key: <topic-slug>
status: active
supersedes:
superseded_by:
resolves:
run_id: {YMD}-{RUN_ID}-{RUN_SLUG}
date: YYYY-MM-DD
base: <git-ref>
scope: atry
tags: [atry/process, project/<BANK_ATRY_NAME>]
aliases: [<topic-slug>]
---

<!-- template: note-process. Filename: `{YMD}-{RUN_ID}-<process-slug>.md` (slug ≠ `RUN_SLUG`). No `#` H1. Always `scope: atry`. Use for actionable suggestions about atry / the relay workflow itself, not domain rules. Soft cap ~1–2 per run; merge by `key` when themes overlap. Copy from the first line; frontmatter must stay on line 1. -->

## Observation

<what happened in the workflow / tooling>

## Evidence

<concrete signal from this run (no run-dir paths)>

## Suggestion for atry

<what to change in skills, helpers, or docs>
