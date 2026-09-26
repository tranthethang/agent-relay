# Troubleshooting

Common failure modes when developing or using agent-relay. Prefer fixing the
cause over disabling sync/CI checks.

## Install / verify

| Symptom                                                                     | Likely cause                                                                                                                                               | What to try                                                                                                                                                              |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `targets.conf line N … not allowed` / `not a plain KEY=value`               | Allowlist rejected a line                                                                                                                                  | Fix the line to a simple assignment; no bare commands, no `VAR=x cmd`, no `$()`                                                                                          |
| Install “succeeds” but the app never shows the skill                        | Tool ignores that path, or path moved (seen with Antigravity)                                                                                              | Confirm path in `targets.conf`; open the tool’s own skill docs; smoke only checks files + front-matter on disk                                                           |
| `verify` fails after partial uninstall                                      | Expected — skill removed for one tool                                                                                                                      | Re-install or narrow `--only` / `--skill`                                                                                                                                |
| `--ref` installs unexpected tree                                            | Forgot that `--ref` always fetches, even inside a clone                                                                                                    | Pass the tag/sha you intend; or run without `--ref` to use the working tree                                                                                              |
| Checksum mismatch on release install                                        | Truncated download or wrong `SHA256SUMS`                                                                                                                   | Re-download; confirm `REF` matches the sums file                                                                                                                         |
| `Error: cannot find atry helpers` when running the `~/.local/bin/atry` shim | Old shim bug: `resolve_lib()` didn't follow the shim's own symlink to `~/.agent-relay/bin/atry`, so it looked for helpers next to `~/.local/bin/` instead  | Reinstall (`./bin/install.sh`) to pick up the fixed `scripts/atry`; `./bin/verify.sh` also now checks the shim is actually runnable, not just present                    |
| `atry` works in a terminal but not for the agent                            | The agent's shell doesn't load the same profile as your interactive terminal (e.g. a non-login or non-interactive shell skips `~/.zprofile` / `~/.bashrc`) | Put the `PATH` line in the profile file that shell actually reads (check the tool's docs for which shell/profile it uses), or configure the tool to invoke a login shell |

## Sync / CI

| Symptom                               | Likely cause                               | What to try                                                    |
| ------------------------------------- | ------------------------------------------ | -------------------------------------------------------------- |
| `Drift: skills/…/file-conventions.md` | Edited docs or only one side               | `bash scripts/maint/sync-references.sh` then commit both sides |
| `Orphan: skills/…/scripts/`           | Unexpected `scripts/` under a skill bundle | Remove it; runtime is `atry` under `~/.agent-relay`            |
| Bootstrap `--check` fails             | `lib/bootstrap.sh` edited without sync     | `bash scripts/maint/sync-bootstrap.sh`                         |
| shellcheck job fails                  | New error-level finding                    | Fix the script; do not lower `-S error` casually               |

## Run discovery

| Symptom                                  | Likely cause              | What to try                                                   |
| ---------------------------------------- | ------------------------- | ------------------------------------------------------------- |
| `atry resolve`: multiple run directories | Ambiguous `.agent-relay/` | Pass an explicit `RUN_ID`, slug, or path under the run folder |

## Parallel tasks

| Symptom                                                                 | Likely cause                                                                                                                                                                    | What to try                                                                                                                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MISMATCH` from `atry check`                                            | Rollup `.md` hand-edited or stale vs `*.status`                                                                                                                                 | Treat directory files as truth; regenerate via claim/update/report-write, or restore rollup deliberately — `check` will not repair                                     |
| Second `claim` fails, prints owner                                      | Lock held                                                                                                                                                                       | Wait; or `steal` if takeover is intentional                                                                                                                            |
| `claim` prints steal hint for old lock                                  | Stale lock, no auto-steal                                                                                                                                                       | Run the printed `steal` command if appropriate                                                                                                                         |
| Deps blocked                                                            | Upstream not `done`                                                                                                                                                             | Finish deps, or `--allow-skipped-deps` only when skipping is intended                                                                                                  |
| `Error: no .agent-relay/ directory or git repository found above <dir>` | Ran `atry resolve` / `atry run-init` from outside any git repo and no `.agent-relay/` exists yet — this errors now instead of silently creating one under the current directory | Run from inside the target repo (or a subdirectory of it), or `git init`, or `mkdir .agent-relay` at the project root as a one-time escape hatch for a non-git project |
| Nested unexpected `.agent-relay/`                                       | Ran helpers from wrong cwd without walk-up finding the real root                                                                                                                | Run from the target repo; helpers walk up to `.agent-relay/` / git root                                                                                                |

## Reviews

| Symptom                                             | Likely cause                   | What to try                                                                                   |
| --------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------- |
| stderr: Cross-Review provenance matches Self-Review | Same recorded `tool=`/`model=` | Use a different tool/model, or accept that it is not a second opinion — upsert still succeeds |
| Section truncated / weird upsert                    | Fence mismatch in review body  | Re-install so `atry review` matches the repo; upsert is fence-aware                           |

## Tests locally

| Symptom                              | Likely cause                    | What to try                                                            |
| ------------------------------------ | ------------------------------- | ---------------------------------------------------------------------- |
| smoke cannot mkdir under fake `HOME` | Sandbox / OS permission on temp | Run outside restrictive sandboxes; suite uses `mktemp` under `$TMPDIR` |
| `smoke-remote` missing fixtures      | `tests/fixtures/` incomplete    | Restore fixtures from the repo; script exits with a clear message      |

## Knowledge bank

| Symptom                                                                        | Likely cause                                                       | What to try                                                                                                                      |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `atry bank push` exits 2 (`skipped`)                                           | Bank not configured or reachable per `bank-status.md`              | Run `atry bank check` first to probe reachability; verify path/endpoint in `.agent-relay/bank.conf`                              |
| `atry bank push` exits 1                                                       | Missing arguments or `bank-status.md` missing                      | Run `atry bank check` before pushing, and supply all four required arguments                                                     |
| `atry bank check` exits 1                                                      | Malformed `.agent-relay/bank.conf`                                 | Check `bank.conf`: lines must strictly match `BANK_KEY=value` with no shell metacharacters                                       |
| `atry bank check` / `atry bank push` exits 2 with "no .agent-relay/ ... found" | No `.agent-relay/` and no git repo above the given start directory | Treat as "not configured" (same as no `bank.conf`) — this is not a crash; run from inside the target repo if a bank was expected |

## Still stuck

Collect OS, `bash --version`, exact command, and relevant stderr (see
`CONTRIBUTING.md`). For design questions (does X enforce Y?), check
[architecture.md](architecture.md) and [security.md](security.md) before
assuming a guarantee exists.
