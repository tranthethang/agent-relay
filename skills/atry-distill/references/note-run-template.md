---
type: run
project: <BANK_PROJECT_NAME-or-omit>
run: "[[{YMD}-{RUN_ID}-{RUN_SLUG}]]"
date: YYYY-MM-DD
base: <git-ref>
scope: project
tags: [atry/run, project/<name>]
notes: [{YMD}-{RUN_ID}-<slug>.md]
dur_implement_min:
dur_self_review_min:
dur_cross_review_min:
dur_distill_min:
tool_implement:
tool_self_review:
tool_cross_review:
tool_distill:
model_implement:
model_self_review:
model_cross_review:
model_distill:
model_source:
diff_base:
files_changed:
lines_added:
lines_deleted:
tasks_planned:
tasks_implemented:
review_findings:
review_rounds:
tokens:
cost:
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

Reserved fields above are filled by `atry metrics "$RUN_DIR" --write <run-note>` during
distill — do not invent or hand-edit values.
