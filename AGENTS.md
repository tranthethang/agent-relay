# AGENTS.md — working on agent-relay

Guidance for agents (and humans) editing **this** repository. It is not a
runtime, not a guarantee that installed skills are followed, and not install
docs for end users — see [`README.md`](README.md).

## What this repo is

- Markdown skill **bundles** (`skills/<name>/SKILL.md` + `references/`) plus
  bash install/verify/uninstall and the `atry` CLI.
- Stages are invoked by a person in a tool. Nothing here schedules agents or
  verifies provenance `tool=` / `model=` claims.

## Hard constraints

- Bash ≥ 3.2 (macOS default). Prefer POSIX tools. Use `set -euo pipefail` where
  existing scripts already do.
- No `sudo`. Installer writes only under `$HOME`.
- Do not invent orchestration, schedulers, or “enforcement” that the code does
  not implement. Prefer “record, don’t enforce” unless a check is cheap and
  clearly safe (then document it as advisory or a hard refuse, accurately).
- Do not claim CI proves skills work end-to-end. CI covers installer smoke
  (`tests/smoke.sh`), task-helper smoke (`tests/tasks.sh`), remote-download
  smoke (`tests/smoke-remote.sh`), shellcheck (`-S error`),
  `scripts/maint/sync-references.sh --check`, and
  `scripts/maint/sync-bootstrap.sh --check`.
- Sole-maintainer repo: changes need not support or migrate older versions or
  historical layouts. Do not reintroduce migration paths, layout fallbacks, or
  backward-compatibility code.

## Layout

| Path | Role |
| ---- | ---- |
| `bin/` | `install.sh`, `uninstall.sh`, `verify.sh` |
| `lib/bootstrap.sh` | Shared download / checksum / `targets.conf` validation |
| `targets.conf` | Install destinations (`source`d after allowlist validation) |
| `skills/<name>/` | Skill bundles (`SKILL.md` + `references/`; no `scripts/`) |
| `docs/` | Maintainer docs — start at [`docs/INDEX.md`](docs/INDEX.md) |
| `docs/file-conventions.md` | Source of truth for `.agent-relay/` names (synced into bundles) |
| `scripts/atry` | CLI entrypoint (installed to `~/.agent-relay/bin/atry`) |
| `scripts/runtime/` | Helpers behind `atry` (installed to `~/.agent-relay/lib/`) |
| `scripts/maint/` | Maintainer sync/release scripts (not installed for agents) |
| `tests/` | Offline smoke / tasks / remote-smoke stubs |
| `VERSION` | Release version; must match the `v*` git tag |

## Editing skills and docs

1. Edit `docs/file-conventions.md` (not the per-skill copies) for run-id /
   artifact rules.
2. Run `bash scripts/maint/sync-references.sh` so
   `skills/*/references/file-conventions.md` match the source. CI fails on
   drift (`--check`). Skill bundles must **not** contain `scripts/`.
3. After changing skill files or `scripts/runtime/`, re-run `./bin/install.sh`
   to refresh user skill dirs and `~/.agent-relay` if you dogfood from this
   clone.
4. Keep skill text honest: provenance is a record; same-tool cross-review is a
   **warning** in `atry review`, not a hard failure; parallel `atry claim`
   serializes task **status**, not overlapping source edits.
5. Skill text calls `atry …` (flattened verbs). Do not teach absolute paths
   under each tool’s skill directory for helpers.

## Editing bootstrap (`lib/bootstrap.sh`)

1. Edit **only** [`lib/bootstrap.sh`](lib/bootstrap.sh). Do not hand-edit the
   `# BEGIN BOOTSTRAP` … `# END BOOTSTRAP` blocks in `bin/install.sh`,
   `bin/uninstall.sh`, or `bin/verify.sh`.
2. Run `bash scripts/maint/sync-bootstrap.sh` so those three bin scripts match.
3. Confirm with `bash scripts/maint/sync-bootstrap.sh --check` before claiming
   done. CI fails on drift the same way as `sync-references.sh --check`.

### Case study — CI failed after adding `validate_targets_conf`

`lib/bootstrap.sh` gained `validate_targets_conf()`, but the bootstrap blocks
in `bin/*.sh` were left unchanged. Local/PR work looked fine until CI ran
`sync-bootstrap.sh --check` and reported all three bin scripts out of sync.
Fix: `bash scripts/maint/sync-bootstrap.sh`, commit the updated `bin/*.sh`,
re-run `--check`. Any change under `lib/bootstrap.sh` implies a sync step —
treat it as mandatory, not optional.

## Tests before you claim “done”

```bash
make test                          # smoke + tasks + remote smoke
bash scripts/maint/sync-references.sh --check
bash scripts/maint/sync-bootstrap.sh --check   # required after any lib/bootstrap.sh edit
bash -n bin/*.sh lib/*.sh scripts/atry scripts/runtime/*.sh scripts/maint/*.sh tests/*.sh
```

`shellcheck -S error` runs in CI; warning-level findings still exist.

## Release checklist (humans)

Full steps: [`docs/release.md`](docs/release.md). Short form — **commit the
docs in the same tree you tag**, then push the tag. The release workflow
builds `dist/` from the tagged commit; it does not rewrite README.

1. Bump [`VERSION`](VERSION) and [`CHANGELOG.md`](CHANGELOG.md) together.
2. Update [`README.md`](README.md) so user-facing pins match that version:
   - Release-install `REF="vX.Y.Z"` must equal `v` + contents of `VERSION`.
   - If install/upgrade behavior changed (ownership marker, `uninstall --force`,
     unsupported layouts), refresh the README upgrade section and
     [`docs/installer.md`](docs/installer.md) in the same commit.
   - Keep README claims honest for what shipped (locks, steal, installer).
3. Commit on the branch you intend to tag (usually the default branch).
4. Tag `v$(cat VERSION)` and push it — the workflow refuses a mismatched tag.
5. Confirm the GitHub Release has assets.
   `scripts/maint/build-release-assets.sh` produces the tarball, install
   scripts, and `SHA256SUMS` (checksums detect truncation, not a maliciously
   replaced asset).

## Tone

Match the README: say what the code does, what it does not, and what is still
manual. Prefer short, concrete notes over marketing language.
