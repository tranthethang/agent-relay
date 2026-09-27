---
type: decision
project: <BANK_PROJECT_NAME-or-omit>
key: <topic-slug>
status: active
supersedes:
superseded_by:
run: "[[{YMD}-{RUN_ID}-{RUN_SLUG}]]"
date: YYYY-MM-DD
base: <git-ref>
scope: project
tags: [atry/decision, project/<name>]
aliases: [<topic-slug>]
---

<!-- template: note-decision. Filename: `{YMD}-{RUN_ID}-<decision-slug>.md` (slug ≠ `RUN_SLUG`). No `#` H1. Copy from the first line; frontmatter must stay on line 1. -->

## Context

<why a choice was needed>

## Options considered

- <option A>
- <option B>

## Rationale

<why the chosen option won; what was rejected and why>
