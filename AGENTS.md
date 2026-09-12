# AGENTS.md — working on agent-relay

Guidance for agents (and humans) editing **this** repository. It is not a
runtime, not a guarantee that installed skills are followed, and not install
docs for end users — see [`README.md`](README.md).

## What this repo is

- Markdown skill **bundles** (`skills/<name>/SKILL.md` + `references/` +
  optional `scripts/`) plus bash install/verify/uninstall.
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
  `sync-references.sh --check`, and `sync-bootstrap.sh --check`.

## Layout

| Path | Role |
| ---- | ---- |
| `bin/` | `install.sh`, `uninstall.sh`, `verify.sh` |
| `lib/bootstrap.sh` | Shared download / checksum / `targets.conf` validation |
| `targets.conf` | Install destinations (`source`d after allowlist validation) |
| `skills/<name>/` | Skill bundles (edit here; install copies them out) |
| `docs/` | Maintainer docs — start at [`docs/INDEX.md`](docs/INDEX.md) |
| `docs/file-conventions.md` | Source of truth for `.agent-relay/` names (synced into bundles) |
| `scripts/` | Canonical helpers; skill `scripts/` copies must match |
| `tests/` | Offline smoke / tasks / remote-smoke stubs |
| `VERSION` | Release version; must match the `v*` git tag |

## Editing skills and docs

1. Edit `docs/file-conventions.md` (not the per-skill copies) for run-id /
   artifact rules.
2. Run `bash scripts/sync-references.sh` so
   `skills/*/references/file-conventions.md` and bundled `scripts/` match
   sources. CI fails on drift (`--check`).
3. After changing skill files locally, re-run `./bin/install.sh` to refresh
   your user skill dirs if you dogfood from this clone.
4. Keep skill text honest: provenance is a record; same-tool cross-review is a
   **warning** in `review-section.sh`, not a hard failure; parallel `claim`
   serializes task **status**, not overlapping source edits.

## Editing bootstrap (`lib/bootstrap.sh`)

1. Edit **only** [`lib/bootstrap.sh`](lib/bootstrap.sh). Do not hand-edit the
   `# BEGIN BOOTSTRAP` … `# END BOOTSTRAP` blocks in `bin/install.sh`,
   `bin/uninstall.sh`, or `bin/verify.sh`.
2. Run `bash scripts/sync-bootstrap.sh` so those three bin scripts match.
3. Confirm with `bash scripts/sync-bootstrap.sh --check` before claiming done.
   CI fails on drift the same way as `sync-references.sh --check`.

### Case study — CI failed after adding `validate_targets_conf`

`lib/bootstrap.sh` gained `validate_targets_conf()`, but the bootstrap blocks
in `bin/*.sh` were left unchanged. Local/PR work looked fine until CI ran
`sync-bootstrap.sh --check` and reported all three bin scripts out of sync.
Fix: `bash scripts/sync-bootstrap.sh`, commit the updated `bin/*.sh`, re-run
`--check`. Any change under `lib/bootstrap.sh` implies a sync step — treat it
as mandatory, not optional.

## Tests before you claim “done”

```bash
make test                          # smoke + tasks + remote smoke
bash scripts/sync-references.sh --check
bash scripts/sync-bootstrap.sh --check   # required after any lib/bootstrap.sh edit
bash -n bin/*.sh lib/*.sh scripts/*.sh tests/*.sh
```

`shellcheck -S error` runs in CI; warning-level findings still exist.

## Release checklist (humans)

Full steps: [`docs/release.md`](docs/release.md). Short form:

1. Bump [`VERSION`](VERSION) and [`CHANGELOG.md`](CHANGELOG.md) together.
2. Tag `v$(cat VERSION)` — the release workflow refuses a mismatched tag.
3. `scripts/build-release-assets.sh` builds `dist/` (tarball, install scripts,
   `SHA256SUMS`). Checksums detect truncation, not a maliciously replaced asset.

## Tone

Match the README: say what the code does, what it does not, and what is still
manual. Prefer short, concrete notes over marketing language.
