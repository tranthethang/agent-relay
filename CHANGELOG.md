# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions use calendar versioning `YY.M.D` (UTC day of release); see
[`docs/release.md`](docs/release.md).

## [Unreleased]

## [26.10.17] — 2026-10-17

### Added

- TypeScript `atry` CLI, published as `@tranthethang/agent-relay`.
- Vitest coverage for a sequential run from `run new` to `close`, and for
  two sessions that claim, refuse an overlapping path, finish, and close.
- Skill install with `npx skills add tranthethang/agent-relay -g --copy`.

### Changed

- npm publish uses dist-tag `latest`.
- Question card: one shape for brainstorm and review (`- Q1: <question>`),
  with no checkbox. When the evidence does not support two real options,
  the agent writes one `Need: <missing data>` line instead of inventing
  `a` / `b`. Rule text lives in `docs/partials/writing.md`.

### Removed

- Bash installer (`bin/`, `lib/`, `targets.conf`), shell tests, and the
  GitHub tarball release.
