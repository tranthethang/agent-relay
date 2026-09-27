---
type: run
project: <BANK_PROJECT_NAME-or-omit>
run: "[[{YMD}-{RUN_ID}-{RUN_SLUG}]]"
date: YYYY-MM-DD
base: <git-ref>
scope: project
tags: [atry/run, project/<name>]
notes: [{YMD}-{RUN_ID}-<slug>.md]
duration_minutes:
files_changed:
loc_added:
loc_removed:
tasks_done:
tasks_skipped:
review_findings:
---
<!-- relay: stage=distill type=run tool=<tool> model=<id-or-unknown> date=YYYY-MM-DD -->

<!-- template: note-run. Filename: `{YMD}-{RUN_ID}-{RUN_SLUG}.md` (no `#` H1 in the body). Copy from the first line; frontmatter must stay on line 1. -->

## Summary

<one short paragraph: what this run did>

## Notes

Manifest of sibling notes pushed with this run (same list as frontmatter `notes:`):

- [[{YMD}-{RUN_ID}-<slug>]] — <type>: <one-line topic>

## Bank push

<one line: "pushed N notes to <BANK_PATH>" / "skipped — bank not configured" / "failed — <reason>">

## Metrics

Reserved fields above stay empty until a metrics run fills them. Do not invent values.
