# Run metrics (`atry metrics`)

Deterministic benchmark fields for one agent-relay run, computed from files
already on disk. The helper never estimates tokens or cost, never writes the
git index, and never trusts provenance as proof — it only records what the
files say.

```bash
atry metrics <run-dir-or-id> [--write <run-note>]
```

Stdout is flat `key: value` lines (frontmatter-ready). With `--write`, those
keys are replaced (or inserted) inside the note's **first** `---` … `---`
block; the body after the closing `---` stays byte-identical.

`atry-distill` runs this with `--write` on the run note under
`$RUN_DIR/distill/` before bank push. The LLM must not invent metric values.

Exit non-zero only when the run cannot be resolved or `base:` is missing /
unreadable to git. A missing stage artifact leaves **only that stage's keys**
empty.

## Keys and sources

| Key                                                                                   | Source                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dur_implement_min`, `dur_self_review_min`, `dur_cross_review_min`, `dur_distill_min` | Sum over rounds of (`completed` − `started`) from `history.log` for that stage; floor minutes. Empty when the stage has no complete pair. Gaps between stages are never counted. `plan` has no duration (only `created`). |
| `tool_implement`, `tool_self_review`, `tool_cross_review`, `tool_distill`             | Distinct `tool=` values from that stage's `history.log` lines, comma-separated in first-seen order.                                                                                                                       |
| `model_implement`, `model_self_review`, `model_cross_review`, `model_distill`         | Distinct `model=` values from `<!-- relay: stage=… -->` provenance comments in run artifacts (plan / implement report / review report / distill notes).                                                                   |
| `model_source`                                                                        | Always `self-reported`.                                                                                                                                                                                                   |
| `diff_base`                                                                           | The ref the change size is measured from: the `head=` that `atry history append … implement started` records automatically (first implement round), else `base:` from `plan.md` / `meta.md`.                              |
| `files_changed`, `lines_added`, `lines_deleted`                                       | `GIT_OPTIONAL_LOCKS=0 git diff --numstat <diff_base>` against the working tree, excluding `.agent-relay/`.                                                                                                                |
| `tasks_planned`                                                                       | Numbered (or checkbox) items under `## Tasks` in `plan.md`.                                                                                                                                                               |
| `tasks_implemented`                                                                   | Task count in `implement-plan/` (`*.status`) when that directory exists; otherwise checkbox lines in `implement-plan.md`.                                                                                                 |
| `review_findings`                                                                     | Bullet items under every `### Issues found` in `review-report.md` (placeholder `- none` skipped).                                                                                                                         |
| `review_rounds`                                                                       | Count of `self-review` / `cross-review` `completed` events that close a `started` one in `history.log` (a repeated `completed` is not a new round).                                                                       |
| `tokens`, `cost`                                                                      | Always empty (never estimated).                                                                                                                                                                                           |

## Caveats

- **Self-reported models.** Provenance `model=` / `tool=` claims are recorded
  as written. Nothing verifies which runtime actually ran.
- **Wall-clock inside stages only.** Durations are sums of complete
  started→completed pairs for that stage. Idle time between stages, and
  unfinished pairs, are excluded. Minutes are integer floor of total seconds.
- **Working-tree diff.** Change-size metrics include uncommitted edits relative
  to `diff_base`, not only the commits that landed during the run. Using the
  implement-start `head=` keeps chained plans that share one `base:` from
  counting each other's changes; commits made _after_ this run (another run
  committed before you compute metrics) are still included, so run
  `atry metrics` at distill time, before the next run lands.
- **`dur_distill_min` is usually empty.** Distill runs `atry metrics` before
  it records `distill completed`, so its own duration has no closed pair yet.
- **No “plan too large” warning.** These fields exist so an author can build a
  table over many runs and decide thresholds later.

## Obsidian Bases example

With run notes in a flat bank folder (`type: run`), a Base can show a
benchmark table. Example filter and columns (Obsidian Bases UI labels vary by
version):

- Filter: `type == "run"`
- Columns: `run` (or filename), `dur_implement_min`, `dur_self_review_min`,
  `dur_cross_review_min`, `tasks_planned`, `tasks_implemented`,
  `files_changed`, `lines_added`, `review_findings`, `review_rounds`,
  `tool_implement`, `model_implement`

Sort by `dur_implement_min` or `tasks_planned` when judging whether recent
plans are too large for a single implement pass.

## Tests

```bash
make metrics          # ./tests/metrics.sh
make smoke            # includes metrics
```

Offline fixtures cover a complete run, missing cross-review, parallel
`implement-plan/`, and multiple review rounds.
