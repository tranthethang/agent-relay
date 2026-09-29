## Review headings

Self-review creates or replaces that day's section in each review file:

```markdown
## Self-Review — YYYY-MM-DD
```

If run again on the same day, it replaces only that section. Cross-review
appends and must not remove the self-review section:

```markdown
## Cross-Review — YYYY-MM-DD
```

Both review skills read shared `references/reviewer-conduct.md` (kept
byte-identical by `sync-references.sh`). When a genuine tradeoff cannot be
resolved interactively, record it as an optional `### Open decisions`
subsection **inside** that day's Self-Review or Cross-Review body — not a new
top-level `##` kind.

## Review notes worth flagging explicitly

Reviewers (`atry-self-review`, `atry-cross-review`) routinely touch package
manager files as part of a change. Two are worth calling out by name in the
review report's notes rather than only mentioning in passing, because they
tend to recur silently across runs otherwise:

- **Dual lockfiles.** A diff that updates more than one lockfile for the same
  package manager ecosystem (for example both `pnpm-lock.yaml` and
  `package-lock.json`) for a project whose own rules (e.g. `AGENTS.md`) name
  one preferred package manager is a maintenance smell: the second lockfile
  drifts the moment someone forgets to update it by hand. Note it explicitly
  in the review report even if fixing it is out of scope for the current
  plan.
- **Directory/rollup drift.** If `implement-plan/` or
  `implement-report/` exists for the run under review, run
  `atry check <run-dir-or-id>` before writing the review. A
  `MISMATCH` means the rollup `.md` was hand-edited outside the claim
  protocol and the per-task `.status`/report files are stale — call this out
  in the review rather than treating the rollup `.md` as ground truth.
