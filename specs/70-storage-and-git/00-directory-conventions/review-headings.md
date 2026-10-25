## Review files

`atry review new <run> self` writes the next pair under `30-self-review/`.
`atry review new <run> cross --model <model>` writes the next pair under `40-cross-review/`.
Names are `01.md` and `01.json`, then `02`, and so on. A later review does
not rewrite an earlier pair.

The markdown file is prose under `# self` or `# cross`. Each question starts
at column zero as `- Q<n>: `. The JSON file has `schema`, `kind`, `tool`,
`model`, `findings`, and `open`. Each `open` item is either `q`, `a`, and `b`, or
`q` and `need`. Review JSON does not contain a test result.

`atry review done` validates the latest JSON for that kind and appends a
`completed` event. It runs the base policy's `testCommand`, when configured,
and writes output to the matching `.test.log` file. It refuses when Markdown
question cards and JSON open items differ. Use `atry review decide <run>
Q<n> <answer>` to record a user's answer. Close reads the review whose
`completed` event is newest.
