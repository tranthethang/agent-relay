# File conventions

All skills read/write a **run-scoped** set of paths under `.agent-relay/` in the
target repo. Each pipeline run shares one NanoID so parallel features do not
overwrite each other's plans and reports.

| Purpose                  | Path                                      | Produced by                                              |
| ------------------------ | ----------------------------------------- | -------------------------------------------------------- |
| Master plan              | `.agent-relay/plan-<id>.md`               | Planning step (outside this repo, e.g. Cursor Plan Mode) |
| Implementation task list | `.agent-relay/implement-plan-<id>.md`     | `atry-implement` skill                                   |
| Implementation report    | `.agent-relay/implement-report-<id>.md`   | `atry-implement` skill                                   |
| Review report            | `.agent-relay/review-report-<id>.md`      | `atry-self-review`, appended by `atry-cross-review`      |
| Review walkthrough       | `.agent-relay/review-walkthrough-<id>.md` | `atry-self-review`, appended by `atry-cross-review`      |
| Active run pointer       | `.agent-relay/CURRENT`                    | Any stage after it resolves or creates a run id          |

`<id>` is a URL-safe NanoID of length **10** (alphabet `A-Za-z0-9_-`). All five
role files for one run use the **same** id.

## Run ID and CURRENT

Generate an id when creating a new plan (or when `atry-implement` adopts a plan
that has none yet):

```bash
npx --yes nanoid@5 --size 10
# fallback if node/npx is unavailable:
openssl rand -base64 12 | tr -dc 'A-Za-z0-9_-' | head -c 10
```

`.agent-relay/CURRENT` is a single-line file containing only the active `<id>`
(trimmed, no quotes). Stages write or overwrite it whenever they successfully
resolve or create a run id.

## Plan header

`.agent-relay/plan-<id>.md` should start with a git `base:` ref and the run
`id:` so later stages can diff the full change and recover the id even if the
filename is unclear:

```markdown
base: abcdef0123456789
id: V1StGXR8_Z

# Feature: …
```

If the planning step did not record `base:` or `id:`, `atry-implement` writes
them before coding. See [`examples/plan.md`](../examples/plan.md) for shape
(examples use short names; runtime files must use the `<id>` suffix).

## Run discovery

Every skill resolves the run id in this order — do **not** pick by mtime:

1. User gave a plan path (e.g. `.agent-relay/plan-V1StGXR8_Z.md`) or an explicit
   run id → use that id (from the path via `^plan-(.+)\.md$`, or as given).
1. Else read `.agent-relay/CURRENT` (one trimmed line).
1. Else if exactly **one** file matches `plan-*.md` → take the id from its name.
1. Else ask the user for a path or id.

After resolving or creating an id, write/overwrite `.agent-relay/CURRENT`.

## Review section headings

Self-review **writes** (creates/overwrites) each review file with:

```markdown
## Self-Review — YYYY-MM-DD
```

Cross-review **appends** (never overwrites the prior section):

```markdown
## Cross-Review — YYYY-MM-DD
```

## Legacy fixed names

If `.agent-relay/plan.md` exists (no suffix) and there is **no** `plan-*.md`, a
skill may read that legacy set once (`implement-plan.md`, etc.), then when it
writes new artifacts it must migrate to `*-<id>.md` plus `CURRENT`. Do not create
new unsuffixed names.

## Notes

- The planning step itself is intentionally **not** a skill in this repo — it's
  whatever your planning tool/mode produces. Land the output at
  `.agent-relay/plan-<id>.md` (and set `CURRENT`) before running `atry-implement`.
- `atry-cross-review` appends to the review files rather than overwriting them, so
  you keep a record of what each tool found.
- Add `.agent-relay/` to your project's `.gitignore` if you don't want these
  working files committed, or commit them if you want an audit trail per
  feature branch — both are reasonable; this repo doesn't enforce either.
  `install.sh` prints a reminder tip after every install.
