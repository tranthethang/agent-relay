---
type: decision
project: <BANK_PROJECT_NAME-or-omit>
key: <topic-slug>
status: active
supersedes:
superseded_by:
resolves:
run_id: {YMD}-{RUN_ID}-{RUN_SLUG}
date: YYYY-MM-DD
base: <git-ref>
scope: project
tags: [atry/decision, project/<name>]
aliases: [<topic-slug>]
---

<!-- template: note-decision. Filename: `{YMD}-{RUN_ID}-<decision-slug>.md` (slug ≠ `RUN_SLUG`). No `#` H1. Write only when reusable on a later run. `scope` may be `module:<slug>` when narrowed. Copy from the first line; frontmatter must stay on line 1. -->

## Context

<why a choice was needed>

## Options considered

- <option A>
- <option B>

## Rationale

<why the chosen option won; what was rejected and why>
