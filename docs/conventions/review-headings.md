## Review files

`atry review new <run> self` writes the next pair under `30-self-review/`.
`atry review new <run> cross` writes the next pair under `40-cross-review/`.
Names are `01.md` and `01.json`, then `02`, and so on. A later review does
not rewrite an earlier pair.

The markdown file is prose under `# self` or `# cross`. The JSON file has
`schema`, `kind`, `tool`, `model`, `fixed`, `tests`, and `open`. `tests` is
`pass`, `fail`, or `not-run`. Each `open` item is either `q`, `a`, and `b`,
or `q` and `need`.

`atry review done` validates the latest JSON for that kind and appends a
`completed` event. Close reads the review whose `completed` event is newest.
