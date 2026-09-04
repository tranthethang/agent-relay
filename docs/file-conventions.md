# File conventions

All skills read/write a fixed set of paths under `.agent-relay/` in the target
repo. This is what lets a skill run in any project without the user having to
pass file paths as variables each time.

| Purpose                  | Path                                 | Produced by                                              |
| ------------------------ | ------------------------------------ | -------------------------------------------------------- |
| Master plan              | `.agent-relay/plan.md`               | Planning step (outside this repo, e.g. Cursor Plan Mode) |
| Implementation task list | `.agent-relay/implement-plan.md`     | `atry-implement` skill                                   |
| Implementation report    | `.agent-relay/implement-report.md`   | `atry-implement` skill                                   |
| Review report            | `.agent-relay/review-report.md`      | `atry-self-review`, appended by `atry-cross-review`      |
| Review walkthrough       | `.agent-relay/review-walkthrough.md` | `atry-self-review`, appended by `atry-cross-review`      |

## Plan header

`.agent-relay/plan.md` should start with a git `base:` ref so later stages can
diff the full change:

```markdown
base: abcdef0123456789

# Feature: …
```

If the planning step did not record one, `atry-implement` writes it before
coding. See [`examples/plan.md`](../examples/plan.md).

## Review section headings

Self-review **writes** (creates/overwrites) each review file with:

```markdown
## Self-Review — YYYY-MM-DD
```

Cross-review **appends** (never overwrites the prior section):

```markdown
## Cross-Review — YYYY-MM-DD
```

## Notes

- The planning step itself is intentionally **not** a skill in this repo — it's
  whatever your planning tool/mode produces. Just make sure the output lands at
  `.agent-relay/plan.md` (or symlink/copy it there) before running `atry-implement`.
- `atry-cross-review` appends to the review files rather than overwriting them, so
  you keep a record of what each tool found.
- Add `.agent-relay/` to your project's `.gitignore` if you don't want these
  working files committed, or commit them if you want an audit trail per
  feature branch — both are reasonable; this repo doesn't enforce either.
  `install.sh` prints a reminder tip after every install.
