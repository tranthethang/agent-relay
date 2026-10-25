# Review policy

The schema and every option are in [`configuration.md`](configuration.md). This
page describes how the policy drives reviews and close.

The committed `.agent-relay.json` at the run's base commit controls review
requirements. A missing file uses these defaults:

```json
{
  "schema": 1,
  "requireReviews": ["self", "cross"],
  "smallChange": 20,
  "strict": { "scope": false, "plan": false, "reviewIntegrity": false }
}
```

Changes below `smallChange` lines, counting additions and deletions from base
to the current tree, require only a self-review. Policy can also include an
optional `testCommand`. `review done` prints `test command: <command>` and
refuses with exit 4 until you add `--run-tests`. With the flag it runs the
command at the repo root through the platform shell, records its exit code,
duration, and tree, and writes the last 200 stdout and stderr lines to
`NN.test.log`. It does not print that output. The recorded tree is the tree
when the tests started. A non-zero exit records failure but does not refuse
`review done`. The command runs without the run lock. `review done` refuses
when the same review stage records another event while the tests run.
`atry distill` leaves every `*.test.log` out of the manifest; pass
`--include-test-logs` to export them.
`atry distill verify <run>` recomputes each hash and reports a file that the
manifest does not name. It prints `extra: <path>` for each extra file. It
skips the manifest and a `*.test.log` that the manifest does not name. It
exits 1 when a file is missing, different, or extra. It does not rewrite the
manifest. A missing manifest exits 3.

The optional `strict` policy groups control scope, plan, and review-integrity
gates independently. Each group defaults to `false`, which reports a warning
and continues when the command can preserve the relevant evidence. Set a group
to `true` to keep its blocking behavior. Existing policy files that omit
`strict` remain valid.

Review JSON contains `schema`, `kind`, `tool`, `model`, `findings`, and `open`.
A finding is `{ id, severity, file, line, status, evidence }`. An older review JSON
with `fixed` as a number and no `findings` still parses as a review with no findings.
`close` refuses with exit 4 while the latest review of a required kind has a `high`
finding with status `open`. The gate runs with or without `strict.reviewIntegrity`.
`--ack-warnings`, `--ack-open`, `--ack-fixes`, and `--waive-review` do not pass it.
`--abandon` does. To close, fix the finding or set it to `rejected` with evidence in a new review.
An older review JSON may also carry `tests`. The CLI reads that key, ignores
its value, and never writes it in a new review JSON. Any other unknown key
still fails the parse.
The `tool` and `model` values must match the review start event. Cross-review
requires `--model`. Question cards at column zero must match `open.length`.
After a user answers a completed review's open item, record the answer with
`atry review decide <run> Q<n> <answer>`. A decision is stored in
`events.jsonl`; a later review can then close that question.

| Key                      | What it controls                                        |
| ------------------------ | ------------------------------------------------------- |
| `requireReviews`         | Review kinds `close` requires: `self`, `cross`, or both |
| `smallChange`            | Below this many changed lines, only `self` is required  |
| `testCommand`            | Command that `review done` runs and records             |
| `worktree.enabled`       | One git worktree and branch per run                     |
| `worktree.dir`           | Folder for run worktrees, outside the repo              |
| `strict.scope`           | Refuse edits outside task `files` (hook: deny, not ask) |
| `strict.plan`            | Refuse plans with more than eight tasks                 |
| `strict.reviewIntegrity` | Refuse `close` on review warnings, even with `--via`    |

Each option, its default, and the commands that read it are in
[`configuration.md`](specs/60-policy-governance/00-policy-spec/configuration.md).

`atry policy init` writes a template `.agent-relay.json` at the git root.
`--preset lenient|standard|strict` picks the template; the default is
`standard`. The `standard` template holds the defaults and
`"worktree": { "enabled": false }`. The command
refuses when the file exists. It does not stage or commit the file. You must
commit it, because runs read policy only at their base commit.

`atry policy check` validates `.agent-relay.json` in the working tree. Run it
before you commit the file. It uses the same schema and field paths as runs do.
