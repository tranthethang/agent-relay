# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions use calendar versioning `YY.MM.DD` (UTC day of release); see
[`docs/release.md`](docs/release.md).

## [Unreleased]

## [26.09.30] — 2026-09-30

### Added

- `atry distill <run>` (`scripts/runtime/distill-manifest.sh`): writes
  `$RUN_DIR/distill/manifest` (schema 1 — run_id, distilled_at, lifecycle
  state, per-file sha256). Export only: no history append, no `meta.md`
  edit, no close. Coverage: `tests/distill.sh` / `make distill`.
- Convention parts under `docs/conventions/` (`core`, `review-headings`,
  `parallel`, `manifest`, `notes`); `sync-references.sh` generates
  `docs/file-conventions.md` and a per-skill subset. `manifest.md` is the
  distill manifest contract. Shared Preflight
  paragraph from `docs/partials/preflight.md` synced between markers in all
  six `SKILL.md` files (with `--check`).
- Human cockpit commands: `atry status`, `atry approve <run> plan`,
  `atry stamp <run> <stage> tool=… model=…`, `atry decide <run> <id> "…"`,
  and `atry close` / `atry close --abandon` (`scripts/runtime/run-status.sh`,
  `run-cockpit.sh`). Records only (`by=human`); no enforcement.
  `$RUN_DIR/decisions.md` is append-only from `decide`. Coverage:
  `tests/status.sh` / `make status` (also in `make smoke` and CI).
- `sync-references.sh --root DIR` (and `AGENT_RELAY_SYNC_ROOT`) so drift/orphan
  checks can run against a temp copy; test suites assert
  `git status --porcelain` is unchanged under the real repo.
- `bin/verify.sh` `[WARN]` when a clone's `VERSION` or `scripts/runtime/`
  differs from `~/.agent-relay` (fix: `./bin/install.sh`; never `[FAIL]`),
  and when an installed helper is missing or `bin/atry` is stale.

### Changed

- `atry-distill` is a thin skill around `atry distill` (manifest export at
  any run state). Distill is no longer a lifecycle stage: removed from
  `run-history` meta stage updates, `atry stamp` stages, and `atry status`
  (stage row / distilling|distilled states). Next hint after cross-review:
  `atry close (optionally atry distill first)`.
- `atry history append … implement started` prints a stderr warning when the
  run has no `stage=plan action=approved` event, then still appends (exit 0).
- Skill text: agents must not run `approve` / `decide` / `stamp` / `close`
  unless the user asked; `atry-implement` relays `atry status` / approval
  warnings; review skills mention `atry decide`.
- `atry history append` records `head=` on `completed` for `implement`,
  `self-review`, and `cross-review` (explicit `head=` still wins), plus a
  `size_base=` / `size=` working-tree snapshot on those events — raw data
  for downstream readers.
- `atry review` Cross-Review warns when the reviewer's tool matches the
  implement author's tool (history.log / implement-report fallback).

### Removed

- Knowledge bank: `atry bank …` verbs, `bank-*.sh`, `bank.conf.example`,
  `docs/bank.md`, convention part `bank.md`, and bank troubleshooting /
  README sections. Existing local `bank.conf` / `bank-status.md` files are
  ignored (no migration).
- agentmemory sink and optional MCP enrich steps (`memory_smart_search` /
  `memory_recall`) from plan / self-review / cross-review / distill; plan
  `## Context used` / Prior lessons sections.
- `atry metrics` / `run-metrics.sh` / `docs/metrics.md` / `tests/metrics.sh`.
- Typed distill notes: `note-schema.md`, `note-*-template.md`, and the
  judgment-heavy `atry-distill` workflow that wrote them.
- `atry distill finalize` / `distill-finalize.sh` / `tests/distill-finalize.sh`
  (never shipped in a tagged release).

### Fixed

- Test suites no longer mutate the source tree for sync-references
  drift/orphan probes (temp `--root` copy + porcelain identity guard).
- Untracked `.DS_Store`; `.gitignore` ignores it at any depth.
- `atry status` detail: use the latest non-attested `tool=` per stage (and
  latest provenance `model=`) so a restarted stage does not keep the first
  tool; also fill plan tool/model from history/provenance when not attested.

## [26.09.28] — 2026-09-28

CalVer cutover. Folds the earlier SemVer history (`v0.1.0`–`v4.0.0`, tags
and GitHub Releases since removed) into one entry. Summary of what this
release contained:

### Added

- Skills: `atry-brainstorm` (read-only, optional), `atry-plan`,
  `atry-implement`, `atry-self-review`, `atry-cross-review`, `atry-distill`.
  Each is a bundle (`SKILL.md` + `references/`) with a Preflight step
  (`atry version`) and a commands table. Shared `reviewer-conduct.md` for
  both review skills (escalate tradeoffs, re-derive evidence, rationalizations
  table).
- Installer for Cursor, Antigravity, Claude, Codex, and Kiro; `verify.sh`
  checks `atry` is runnable from PATH; `.agent-relay-owned` ownership marker
  (uninstall refuses unmarked dirs unless `--force`; install refuses skill
  dirs that symlink outside the tool dir).
- `atry` CLI (`~/.agent-relay/bin/atry`, shim `~/.local/bin/atry`) with
  flattened verbs: `resolve`, `run-init`, `history`, `review`, `task-init`,
  and task helpers `claim` / `steal` / `update` / `release` / `list` /
  `rollup` / `check` / `report-*`.
- Per-run layout `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/` (Unix-seconds id,
  agent-written slug) with `meta.md` and append-only `history.log`;
  `history append … implement started` records `head=`.
- Parallel tasks: per-task `.status` files with deps, `mkdir` locks,
  per-task mutex, explicit `steal` (compare-and-swap on owner, host-aware
  stale reclaim), `check` for hand-edited rollups.
- `review-section.sh` upsert with fence-aware parsing and a non-blocking
  same-`tool=`/`model=` Cross-Review warning.
- `validate_targets_conf` allowlist before `targets.conf` is sourced.
- Knowledge-bank helpers (`atry bank init|check|push|set-status`, Obsidian
  vault and agentmemory sinks), typed distill notes, `atry metrics`, and
  optional agentmemory enrich steps in skills. (Removed after this release —
  see `[Unreleased]`.)
- Maintainer docs under `docs/`, `AGENTS.md`, `CONTRIBUTING.md`; CI with
  smoke, task, remote-smoke, sync `--check`, and shellcheck jobs.

### Removed

- Legacy layouts and all migration code (`run-migrate.sh`, flat
  `plan-<id>.md`, `YMD_nanoid` dirs, `.agent-relay/CURRENT`,
  `~/.agent-relay/scripts/`, `resolve-task-bin.sh`), top-level `templates/`
  (outlines moved into each skill's `references/`), `examples/case-study/`
  (constructed, not a recorded run), and the Python/uv toolchain.

### Fixed

- `~/.local/bin/atry` shim now follows its own symlink to find helpers.
- `find_agent_relay_dir` no longer treats `~/.agent-relay` as a run root and
  no longer guesses `$PWD/.agent-relay`.
- `--ref` / `AGENT_RELAY_REF` fetch that ref even from a clone; remote
  install/verify/uninstall forward `--only`, `--skill`, `--dry-run`,
  `--no-clobber`.
