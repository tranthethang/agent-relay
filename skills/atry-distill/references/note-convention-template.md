---
type: convention
project: <BANK_PROJECT_NAME-or-omit>
key: <topic-slug>
status: active
supersedes:
superseded_by:
resolves:
derived_from:
run: "[[{YMD}-{RUN_ID}-{RUN_SLUG}]]"
date: YYYY-MM-DD
base: <git-ref>
scope: project
tags: [atry/convention, project/<name>]
aliases: [<topic-slug>]
---

<!-- template: note-convention. Filename: `{YMD}-{RUN_ID}-<convention-slug>.md` (slug ≠ `RUN_SLUG`). No `#` H1. `scope` may be `module:<name>` when the rule is not project-wide. Copy from the first line; frontmatter must stay on line 1. -->

## Rule

<one sentence standing rule>

## Do

```text
<short example of the preferred shape>
```

## Don't

```text
<short counter-example to avoid>
```

## Scope

<when this applies / when it does not>
