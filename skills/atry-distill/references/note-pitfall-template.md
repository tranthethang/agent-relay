---
type: pitfall
project: <BANK_PROJECT_NAME-or-omit>
key: <topic-slug>
status: open
resolves:
resolved_by:
run_id: {YMD}-{RUN_ID}-{RUN_SLUG}
date: YYYY-MM-DD
base: <git-ref>
scope: project
tags: [atry/pitfall, project/<name>]
aliases: [<topic-slug>]
---

<!-- template: note-pitfall. Filename: `{YMD}-{RUN_ID}-<pitfall-slug>.md` (slug ≠ `RUN_SLUG`). No `#` H1. Write only if still open after the run (mitigation not done). `scope` may be `module:<slug>` when narrowed. Copy from the first line; frontmatter must stay on line 1. -->

## Symptom

<what went wrong or looked wrong>

## Cause

<root cause, not the surface error alone>

## Avoid / fix

<concrete prevention or remediation; no repo paths>
