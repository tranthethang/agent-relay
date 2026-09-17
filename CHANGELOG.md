# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.0.0] — 2026-09-16

### Removed

- Removed legacy migration tool `scripts/run-migrate.sh` and its skill bundle copies.
- Removed `--migrate` flag from `scripts/task-init.sh`.
- Removed legacy flat layout (`.agent-relay/plan-<id>.md`) and legacy `YMD_nanoid` format resolution from `scripts/resolve-run.sh` and `scripts/task-claim.sh`.
- Removed legacy destination directory cleanup (`*_LEGACY_DIRS`) and legacy scripts cleanup from installer/uninstaller/verifier (`bin/install.sh`, `bin/uninstall.sh`, `bin/verify.sh`, `targets.conf`).
- Removed all legacy migration and historical layout sections from documentation (`README.md`, `docs/file-conventions.md`, `docs/troubleshooting.md`, `docs/task-claim.md`, `docs/skills-authoring.md`, `docs/installer.md`, `docs/testing.md`, `templates/README.md`, and skill guides).

### Changed

- Strictly enforced single standard run directory format: `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/`.
- Updated `AGENTS.md` with explicit hard constraint: changes need not support or migrate older versions or historical layouts; no backward-compatibility code or fallbacks.
- Modernized all test suites (`tests/smoke.sh`, `tests/tasks.sh`) to operate exclusively on per-run directories with explicit rejection of legacy structures.

## [2.0.1] — 2026-09-16

### Changed

- Run directory naming now uses human-sortable, readable timestamp + slug format:
  `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/` (e.g. `20260916-1789539317-create-new-home-page`).
- `RUN_ID` is generated offline via `date +%s` (Unix epoch seconds) without requiring `npx nanoid` or network.
- `RUN_SLUG` is an agent-authored descriptive slug (3–48 chars, lowercase `a-z` and single hyphens).
- `meta.md` records `id: <UNIX_TS>` and adds `slug: <RUN_SLUG>`.
- `run-init.sh` requires `--slug <slug>`, validates timestamp and slug, and automatically handles same-second collision retries (+1 bump up to 5 retries).
- `resolve-run.sh` recognizes both `{YMD}-{RUN_ID}-{RUN_SLUG}` and legacy 2.0.0 `{YMD}_{RUN_ID}` formats, supporting lookup by timestamp, slug, full dirname, or legacy id.
- `run-migrate.sh` shapes new migrations into `{YMD}-{UNIX_TS}-{slug}/` with `slug:` in `meta.md`, without rewriting existing `{YMD}_{nanoid}` folders.
- `skills/atry-plan/SKILL.md` documents offline Unix timestamp and slug generation.

Re-install skill bundles after upgrading. Existing `{YMD}_{RUN_ID}/` folders from
v2.0.0 still resolve; new runs use the slug format.

## [2.0.0] — 2026-09-16

### Added

- Per-run folder layout: all artifacts for a run live in
  `.agent-relay/{YMD}_{RUN_ID}/` (eight-digit date prefix + run id).
- Run metadata and history logging: `meta.md` tracks structured run attributes
  (`stage:`, `status:`, …) and `history.log` is an append-only event audit trail.
- Shared Bash 3.2 helpers (canonical under `scripts/`, synced into skill
  bundles via `sync-references.sh`):
  - `resolve-run.sh`: resolves a run directory from a path, run id, or the
    single run folder under `.agent-relay/` — no `CURRENT`. Legacy flat
    `plan-<id>.md` layouts still resolve with a stderr migration hint.
  - `run-init.sh`: creates `{YMD}_{RUN_ID}/`, seeds `meta.md`, creates
    `history.log`.
  - `run-history.sh`: appends timestamped events to `history.log` and keeps
    `stage:` / `status:` in `meta.md` in sync.
  - `run-migrate.sh`: moves a legacy flat `plan-<id>.md` run (and sibling
    artifacts / parallel dirs) into the per-run folder layout; removes a
    matching `.agent-relay/CURRENT` when present.
- New artifact templates: `templates/meta.md` and `templates/history.log`.
- Tests: `tests/tasks.sh` covers per-run dirs, `run-init`, `run-history`,
  `run-migrate`, and `resolve-run`; `tests/smoke.sh` checks that installed
  implement bundles ship `run-migrate.sh`.
- README / troubleshooting notes for Migration v1.x → v2.0 and common
  legacy-layout errors.

### Changed

- Artifact names inside a run directory are short and stable: `plan.md`,
  `meta.md`, `history.log`, `implement-plan.md`, `implement-report.md`,
  `review-report.md`, `review-walkthrough.md` (no longer
  `plan-<id>.md` / `implement-plan-<id>.md` at the `.agent-relay/` root for
  new runs).
- Parallel task directories live inside the run folder: `implement-plan/` and
  `implement-report/` (not `implement-plan-<id>/` at the root).
- `task-init.sh`, `task-claim.sh`, and `review-section.sh` resolve the run
  via `resolve-run.sh`, write short names under `$RUN_DIR`, and still fall
  back to legacy flat paths when needed.
- All four skills (`atry-plan`, `atry-implement`, `atry-self-review`,
  `atry-cross-review`) document and use the per-run layout and shared helpers.
- `sync-references.sh` copies the new run helpers into the skill bundles that
  need them; maintainer docs (`file-conventions`, architecture, task-claim,
  skills-authoring, troubleshooting) match the new conventions.

### Removed

- `.agent-relay/CURRENT` is no longer required or written for new runs; each
  run directory is self-contained.
- Central index files (`composer.csv`, `runs.md`) are not part of the layout.

### Migration

See README “Migration v1.x → v2.0”. Short form:

1. Re-run `./bin/install.sh` (or install from the `v2.0.0` release) so skill
   bundles pick up the new helpers and `SKILL.md` text.
2. For each legacy flat run: `bash scripts/run-migrate.sh <id>` (or the copy
   next to `atry-implement`’s `SKILL.md`).
3. New work uses `run-init.sh` / skill plan stage — no `CURRENT` file.

## [1.0.1] — 2026-09-12

### Added

- `validate_targets_conf` in `lib/bootstrap.sh`: before install/uninstall/verify
  `source` `targets.conf`, only allow plain `KEY=value` / `KEY=(...)` lines;
  refuse command substitution, backticks, pipes, redirects, control operators,
  and non-assignment lines. Mitigation only — the file is still sourced.
- `task-claim.sh check <id>`: compare on-disk rollups to a fresh regeneration
  from per-task files; print `MISMATCH` and exit non-zero on drift (no repair).
- Non-blocking same-`tool=`/`model=` warning in `review-section.sh` when
  upserting Cross-Review (fence-aware; skips `tool=unknown`).
- Smoke checks that each installed `SKILL.md` has front-matter `name:` and
  `description:`; smoke cases for the targets.conf allowlist.
- `atry-implement` mode check: if `implement-plan-<id>/` exists, instruct the
  agent to use `task-claim.sh` and not hand-edit rollups.
- `atry-self-review` note to prefer a stronger model when cross-review may
  never run.
- Reviewer notes in `docs/file-conventions.md` for dual lockfiles and
  directory/rollup drift (synced into skill `references/`).
- [`AGENTS.md`](AGENTS.md) for contributors editing this repository.
- Maintainer documentation under [`docs/`](docs/INDEX.md) (architecture,
  installer, task-claim, testing, release, security, troubleshooting,
  skills-authoring), with [`docs/INDEX.md`](docs/INDEX.md) as the entry point.

### Changed

- README documents the allowlist, `check`, advisory cross-review warning, and
  front-matter smoke limits without claiming enforcement or load guarantees;
  links into the new `docs/` set.

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
