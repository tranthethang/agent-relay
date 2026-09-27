---
type: process
project: <BANK_PROJECT_NAME-or-omit>
key: <topic-slug>
status: active
supersedes:
superseded_by:
run: "[[{YMD}-{RUN_ID}-{RUN_SLUG}]]"
date: YYYY-MM-DD
base: <git-ref>
scope: project
tags: [atry/process, project/<name>]
aliases: [<topic-slug>]
---

<!-- template: note-process. Filename: `{YMD}-{RUN_ID}-<process-slug>.md` (slug ≠ `RUN_SLUG`). No `#` H1. Use this type for lessons about atry / the relay workflow itself, not domain rules. Copy from the first line; frontmatter must stay on line 1. -->

## Observation

<what happened in the workflow / tooling>

## Evidence

<concrete signal from this run (no run-dir paths)>

## Suggestion for atry

<what to change in skills, helpers, or docs>
