# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] — 2026-09-12

### Added

- Skill **bundles** (`skills/<name>/SKILL.md` + `references/` + `scripts/`).
- `atry-plan` skill and `review-section.sh` upsert helper.
- Provenance HTML comments and `date +%F` guidance in all four skills.
- Explicit `task-claim.sh steal` with try-once mutex; concurrent steal harness.
- Ident validation, dependency cycle detection, portable task sorting, base-dir
  walk-up, status whitelist, release ownership checks, `--allow-skipped-deps`.
- `scripts/sync-references.sh` (+ CI `--check`) so `docs/file-conventions.md`
  stays the single source for run-id rules.
- Shellcheck job and `tests/tasks.sh` in CI.

### Fixed

- `sync-references.sh --check` on macOS (bash 3.2 + `set -u`) no longer
  fails when a skill bundle has no `scripts/` (e.g. `atry-plan`).

### Changed

- Installer copies whole skill directories; helpers no longer install to
  `~/.agent-relay/scripts/`.
- `claim` refuses stale locks (prints the `steal` command) instead of
  auto-stealing after two hours.
- `CURRENT` is written only when creating a new id.
- `--session` accepted before the subcommand or in `update`/`release` args;
  ambient `SESSION` / `SESSION_TAG` ignored for auth.
- `task-init` uses a global `T1…Tn` counter, requires `## Tasks`, rejects
  nested numbered lists and duplicate ids.

### Removed

- `resolve-task-bin.sh` and the `~/.agent-relay/scripts/` install path.
- `mdc-flat` writer (legacy `.mdc` cleanup on install/uninstall remains).
- Flat `skills/*.md` sources.

### Migration

See README “Migration v0.4 → v1.0”. Re-run `./bin/install.sh` from v1.0.0;
legacy global scripts and flat skill files are replaced by bundles.

## [0.4.0] — 2026-09-11

### Added

- Experimental parallel task execution via `task-init.sh` / `task-claim.sh`,
  installed to `~/.agent-relay/scripts/` (override with `.agent-relay/scripts/`).
- `resolve-task-bin.sh` to locate claim/init binaries.
- Optional `deps:` on per-task `.status` files; `claim` refuses unmet deps.
- Append-safe `implement-report-<id>/` per-task reports with `report-write` /
  `report-list` / `report-rollup` (rollup file is generated only).
- Working-tree isolation notes and script resolution order in
  `docs/file-conventions.md`.
- Templates for `implement-plan/<task>.status` and `implement-report/<task>.md`.
- Smoke coverage for script install, `resolve-task-bin` override, and
  `--no-clobber` per-file restore; `tests/tasks.sh` for claim/init/report helpers.

### Changed

- Release tarball includes `scripts/` and `templates/`.
- Review skills prefer `implement-report-<id>/` (via `report-list`) over the
  rollup when the directory exists.
- `atry-implement` parallel mode uses `report-write` instead of appending a
  shared report file.
- README reframed: sequential path first; parallel helpers documented as
  optional/experimental with explicit isolation limits.
- Install / verify / uninstall cover the three task helper scripts.

## [0.3.0] — 2026-09-09

### Removed

- Python / uv / mdformat toolchain (`pyproject.toml`, `uv.lock`, `.python-version`, `make format`). Nothing in CI used it.
- `examples/case-study/`. It was a constructed before/after, not a recorded pipeline run.

### Fixed

- `--ref` and `AGENT_RELAY_REF` fetch that ref even from a clone. They no longer install the working tree.
- Remote install, verify, and uninstall forward `--only`, `--skill`, `--dry-run`, and `--no-clobber` into the extracted script.

### Changed

- README, `docs/file-conventions.md`, `templates/`, and `CONTRIBUTING.md` describe what the installer and skills actually do. Templates no longer invent a feature, test result, or review outcome.
- `install.sh`, `verify.sh`, and `uninstall.sh` live in `bin/`. Release downloads are still named `install.sh` / `verify.sh` / `uninstall.sh`.
- `examples/` renamed to `templates/`. Those files are empty outlines, not a sample run.

## [0.2.0] — 2026-09-07

### Added

- README case study (`examples/case-study/`) showing self-review vs cross-review catches
- CI status badge pointing at `.github/workflows/ci.yml`
- Claude and Codex as `skill-folder` install targets (`~/.claude/skills`, `~/.codex/skills`)
- Smoke coverage for `--only claude` / `--only codex` install and uninstall
- `CONTRIBUTING.md` and this changelog

### Changed

- README Status/Install wording: verified pipeline remains Cursor + Antigravity;
  Claude/Codex are install-supported, not yet dogfooded end-to-end
- Recommended install docs: show curl download progress (`curl -fLO` instead of `-fsSLO`)

## [0.1.0] — baseline

Initial public baseline: implement / self-review / cross-review skills, installer
for Cursor and Antigravity, local and remote smoke tests, release workflow.
