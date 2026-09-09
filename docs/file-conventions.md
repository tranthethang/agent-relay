# File conventions

Skills read and write files under `.agent-relay/` in the target repo. One run
uses one id on every file so two features do not overwrite each other. Nothing
in this repo enforces the names except the skill text.

| Purpose | Path | Written by |
| --- | --- | --- |
| Plan | `.agent-relay/plan-<id>.md` | You, or a planning tool. Not a skill in this repo. |
| Task list | `.agent-relay/implement-plan-<id>.md` | `atry-implement` |
| Implement notes | `.agent-relay/implement-report-<id>.md` | `atry-implement` |
| Review report | `.agent-relay/review-report-<id>.md` | `atry-self-review` creates or overwrites. `atry-cross-review` appends. |
| Review walkthrough | `.agent-relay/review-walkthrough-<id>.md` | Same as the review report. |
| Active id | `.agent-relay/CURRENT` | Any stage after it resolves or creates an id. |

`<id>` is 10 characters from `A-Za-z0-9_-`. The same id is used for all five
role files.

Empty templates are in [`templates/`](../templates/). They are not a completed
run. Runtime files must use the `-<id>` suffix. The templates keep short names
so the links stay stable.

## CURRENT

`.agent-relay/CURRENT` is one line: the active id, trimmed, no quotes. A stage
overwrites it after it resolves or creates an id.

Skills resolve the id in this order. They are told not to use mtime:

1. The user passed a plan path or an id. From a path, take the id with
   `^plan-(.+)\.md$`.
2. Else read `.agent-relay/CURRENT`.
3. Else if exactly one `plan-*.md` exists, take the id from that name.
4. Else ask. Do not guess.

## Plan header

`plan-<id>.md` should start with the git ref you will diff from, and the id:

```markdown
base: <git-ref>
id: <id>

# <title>
```

If those lines are missing, `atry-implement` is instructed to add them before
coding. `base` should be a real ref in that repo (`HEAD` before the work, or
the branch tip). Do not invent one.

## Review headings

Self-review creates or overwrites each review file with one section:

```markdown
## Self-Review — YYYY-MM-DD
```

Cross-review appends. It must not remove the self-review section:

```markdown
## Cross-Review — YYYY-MM-DD
```

## Legacy names

If `.agent-relay/plan.md` exists and no `plan-*.md` exists, a skill may read
the unsuffixed set once (`implement-plan.md`, and so on). New writes go to
`*-<id>.md` and `CURRENT`. Do not create new unsuffixed names.

## Notes

- Put the plan at `.agent-relay/plan-<id>.md` and set `CURRENT` before
  `atry-implement`.
- Commit `.agent-relay/` if you want the notes on the branch. Otherwise add
  the directory to `.gitignore`. This repo does not choose for you.
  `bin/install.sh` prints that reminder.
- The id commands in the skills are suggestions. `npx --yes nanoid@5` needs
  network and npm. The `openssl` fallback strips characters and can be shorter
  than 10. Either way, use the same id on every file for that run.
