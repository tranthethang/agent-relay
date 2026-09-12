# agent-relay

[![CI](https://github.com/tranthethang/agent-relay/actions/workflows/ci.yml/badge.svg)](https://github.com/tranthethang/agent-relay/actions/workflows/ci.yml)

Markdown skill **bundles** plus a bash installer. Each skill is a folder
(`SKILL.md`, `references/`, optional `scripts/`) that tells an agent how to
plan, implement, self-review, and cross-review work under `.agent-relay/`. The
installer copies each bundle into every supported tool’s global skill directory.

This repo does **not** run the stages, pick a model, talk to an agent runtime,
or prove that following the skills improves outcomes. CI checks the installer,
shellcheck, reference sync, and the task scripts. It does not check whether an
agent follows a skill.

## What this is not

- Not a message bus, orchestrator, or multi-agent runtime. You open a tool and
  invoke a skill yourself.
- Not a measured result. Provenance comments record which tool/model a stage
  *claims* to have used; nothing verifies that claim.
- Not a guarantee that every listed tool loads the installed files the same
  way. Install only copies files to known paths.

## Stages

| Order | Skill | What it is expected to do |
| ----- | ----- | ------------------------- |
| 1 | [`skills/atry-plan/`](skills/atry-plan/) | Write `.agent-relay/plan-<id>.md` (schema + `CURRENT`) |
| 2 | [`skills/atry-implement/`](skills/atry-implement/) | Implement that plan; write implement-plan / implement-report |
| 3 | [`skills/atry-self-review/`](skills/atry-self-review/) | Review the diff; upsert a dated `Self-Review` section |
| 4 | [`skills/atry-cross-review/`](skills/atry-cross-review/) | Upsert a `Cross-Review` section. The skill asks you to use a different tool than self-review. Nothing enforces that. |

Names, `CURRENT`, and the run id:
[`docs/file-conventions.md`](docs/file-conventions.md) (also shipped as
`references/file-conventions.md` inside every installed bundle). Empty outlines
are in [`templates/`](templates/).

After you change files under `skills/`, run `./bin/install.sh` again. Keep
`docs/file-conventions.md` and the copies under `skills/*/references/` in sync
with `bash scripts/sync-references.sh` (CI runs `--check`).

## Working files

Skills read and write under `.agent-relay/` in the **target** repo. Whether you
commit that directory is your choice.

Default mode is sequential: one shared `implement-plan-<id>.md` and
`implement-report-<id>.md`.

## Parallel helpers

If several agents share one run id, use the helpers shipped **inside** the
implement skill bundle (`scripts/task-init.sh`, `scripts/task-claim.sh` next to
`SKILL.md`). They use per-task files and `mkdir` locks.

Covered by `tests/tasks.sh` (including concurrent steal with a try-once mutex,
ident validation, dependency cycles, and portable sorting):

- Exactly one winner when two agents race a `steal`
- `claim` never auto-steals a stale lock (use explicit `steal`)
- Status whitelist; release ownership checks; `--session` in both positions

Still true:

- Serializes **task status** (and per-task reports), not overlapping source edits
- Use disjoint paths or separate worktrees when files overlap

## Install

Requires bash ≥ 3.2. No `sudo`. Writes only under `$HOME`. Each skill installs
as a **bundle**:

| Tool | Destination |
| ---- | ----------- |
| Cursor | `~/.cursor/skills/<name>/` (`SKILL.md`, `references/`, `scripts/`) |
| Antigravity | `~/.gemini/config/skills/<name>/` |
| Claude | `~/.claude/skills/<name>/` |
| Codex | `~/.codex/skills/<name>/` |

```bash
git clone https://github.com/tranthethang/agent-relay.git
cd agent-relay
./bin/install.sh
./bin/verify.sh
```

### Release install

Checksums catch truncated downloads. They do **not** stop a replaced release:
`targets.conf` is `source`d by the installer, so a maliciously swapped release
asset is arbitrary code execution under your user. Treat release trust like any
other script you download.

```bash
REF="v1.0.0"
curl -fLO "https://github.com/tranthethang/agent-relay/releases/download/${REF}/install.sh"
curl -fLO "https://github.com/tranthethang/agent-relay/releases/download/${REF}/SHA256SUMS"
shasum -a 256 -c SHA256SUMS
bash ./install.sh --ref "$REF"
```

### Migration v0.4 → v1.0

- Skills are directories (`skills/<name>/SKILL.md`), not flat `skills/<name>.md`.
- Helpers live in each skill’s `scripts/`, not `~/.agent-relay/scripts/`.
  Install/uninstall remove the old global scripts directory.
- `resolve-task-bin.sh` is gone — call `scripts/task-claim.sh` beside `SKILL.md`.
- Stale locks are not auto-stolen; use `task-claim.sh steal …`.
- `CURRENT` is written only when creating a new id.
- Only `skill-folder` format remains (the old Cursor `.mdc` writer is gone;
  leftover `.mdc` files are still cleaned from legacy dirs).

## Honest limits

- Nothing forces an agent to follow a skill or to use a different tool for
  cross-review. Provenance lines are **records**, not enforcement.
- Parallel claim does not protect overlapping source-file edits.
- Antigravity’s skills path has moved before; install can “succeed” while the
  app ignores the files.
- `targets.conf` is executed as bash by install/uninstall/verify.

## Development

```bash
make test                 # smoke + tasks + remote smoke
bash scripts/sync-bootstrap.sh --check
bash scripts/sync-references.sh --check
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`CHANGELOG.md`](CHANGELOG.md).
