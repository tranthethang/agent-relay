# Troubleshooting

Common failure modes when developing or using agent-relay. Prefer fixing the
cause over disabling sync/CI checks.

## Install / verify

| Symptom | Likely cause | What to try |
| --- | --- | --- |
| `targets.conf line N … not allowed` / `not a plain KEY=value` | Allowlist rejected a line | Fix the line to a simple assignment; no bare commands, no `VAR=x cmd`, no `$()` |
| Install “succeeds” but the app never shows the skill | Tool ignores that path, or path moved (seen with Antigravity) | Confirm path in `targets.conf`; open the tool’s own skill docs; smoke only checks files + front-matter on disk |
| `verify` fails after partial uninstall | Expected — skill removed for one tool | Re-install or narrow `--only` / `--skill` |
| `--ref` installs unexpected tree | Forgot that `--ref` always fetches, even inside a clone | Pass the tag/sha you intend; or run without `--ref` to use the working tree |
| Checksum mismatch on release install | Truncated download or wrong `SHA256SUMS` | Re-download; confirm `REF` matches the sums file |

## Sync / CI

| Symptom | Likely cause | What to try |
| --- | --- | --- |
| `Drift: skills/…/file-conventions.md` | Edited docs or only one side | `bash scripts/sync-references.sh` then commit both sides |
| `Drift: skills/…/scripts/foo.sh` | Edited only the bundle copy or only `scripts/` | Edit `scripts/foo.sh`, then `sync-references.sh` |
| `Orphan: skills/…/scripts/bar.sh` | Bundle script with no `scripts/bar.sh` | Add the canonical script or remove the orphan |
| Bootstrap `--check` fails | `lib/bootstrap.sh` edited without sync | `bash scripts/sync-bootstrap.sh` |
| shellcheck job fails | New error-level finding | Fix the script; do not lower `-S error` casually |

## Parallel tasks

| Symptom | Likely cause | What to try |
| --- | --- | --- |
| `MISMATCH` from `task-claim.sh check` | Rollup `.md` hand-edited or stale vs `*.status` | Treat directory files as truth; regenerate via claim/update/report-write, or restore rollup deliberately — `check` will not repair |
| Second `claim` fails, prints owner | Lock held | Wait; or `steal` if takeover is intentional |
| `claim` prints steal hint for old lock | Stale lock, no auto-steal | Run the printed `steal` command if appropriate |
| Deps blocked | Upstream not `done` | Finish deps, or `--allow-skipped-deps` only when skipping is intended |
| Nested unexpected `.agent-relay/` | Ran helpers from wrong cwd without walk-up finding the real root | Run from the target repo; helpers walk up to `.agent-relay/` / git root |

## Reviews

| Symptom | Likely cause | What to try |
| --- | --- | --- |
| stderr: Cross-Review provenance matches Self-Review | Same recorded `tool=`/`model=` | Use a different tool/model, or accept that it is not a second opinion — upsert still succeeds |
| Section truncated / weird upsert | Historical fence bugs | Current `review-section.sh` is fence-aware; update bundles via re-install if the installed copy is old |

## Tests locally

| Symptom | Likely cause | What to try |
| --- | --- | --- |
| smoke cannot mkdir under fake `HOME` | Sandbox / OS permission on temp | Run outside restrictive sandboxes; suite uses `mktemp` under `$TMPDIR` |
| `smoke-remote` missing fixtures | `tests/fixtures/` incomplete | Restore fixtures from the repo; script exits with a clear message |

## Still stuck

Collect OS, `bash --version`, exact command, and relevant stderr (see
`CONTRIBUTING.md`). For design questions (does X enforce Y?), check
[architecture.md](architecture.md) and [security.md](security.md) before
assuming a guarantee exists.
