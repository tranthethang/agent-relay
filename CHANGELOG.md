# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
