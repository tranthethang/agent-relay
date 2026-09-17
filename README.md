# agent-relay

[![CI](https://github.com/tranthethang/agent-relay/actions/workflows/ci.yml/badge.svg)](https://github.com/tranthethang/agent-relay/actions/workflows/ci.yml)

Markdown skill **bundles** plus a bash installer. Each skill is a folder
(`SKILL.md`, `references/`, optional `scripts/`) that tells an agent how to
plan, implement, self-review, and cross-review work under `.agent-relay/`. The
installer copies each bundle into every supported tool’s global skill directory.

This repo does **not** run the stages, pick a model, talk to an agent runtime,
or prove that following the skills improves outcomes. CI checks the installer
(local and simulated release-download smoke), shellcheck, reference and
bootstrap sync, and the task scripts. It does not check whether an agent
follows a skill.

Agent-oriented notes for editing **this** repo: [`AGENTS.md`](AGENTS.md).
Maintainer docs (architecture, installer, tests, release, …):
[`docs/INDEX.md`](docs/INDEX.md).

## What this is not

- Not a message bus, orchestrator, or multi-agent runtime. You open a tool and
  invoke a skill yourself.
- Not a measured result. Provenance comments record which tool/model a stage
  *claims* to have used; nothing verifies that claim.
- Not a guarantee that every listed tool loads the installed files the same
  way. Install only copies files to known paths. Smoke tests check that each
  installed `SKILL.md` has non-empty front-matter `name:` / `description:` —
  not that Cursor, Antigravity, Claude, or Codex actually load the skill.

## Stages

| Order | Skill | What it is expected to do |
| ----- | ----- | ------------------------- |
| 1 | [`skills/atry-plan/`](skills/atry-plan/) | Write `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/plan.md` (schema + `run-init.sh`) |
| 2 | [`skills/atry-implement/`](skills/atry-implement/) | Implement that plan; write `implement-plan` / `implement-report` |
| 3 | [`skills/atry-self-review/`](skills/atry-self-review/) | Review the diff; upsert a dated `Self-Review` section |
| 4 | [`skills/atry-cross-review/`](skills/atry-cross-review/) | Upsert a `Cross-Review` section. The skill asks you to use a different tool than self-review. Nothing enforces that. |
| 5 | [`skills/atry-distill/`](skills/atry-distill/) | Write `distillation.md`: lessons + case study from the finished run; optionally push a condensed note to a configured knowledge bank |

Names, run directory layout, and id resolution:
[`docs/file-conventions.md`](docs/file-conventions.md) (also shipped as
`references/file-conventions.md` inside every installed bundle). Empty
outlines for each artifact live in that skill's `references/*-template.md`
(installed with the bundle). Writing or changing skills:
[`docs/skills-authoring.md`](docs/skills-authoring.md).

After you change files under `skills/`, run `./bin/install.sh` again. Keep
`docs/file-conventions.md` and the copies under `skills/*/references/` in sync
with `bash scripts/sync-references.sh` (CI runs `--check`).

## Working files

Skills read and write under `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/` in the
**target** repo. Whether you commit that directory is your choice.

Default mode is sequential: one shared `implement-plan.md` and
`implement-report.md` inside the run folder.

## Knowledge bank (optional)

`atry-distill` (stage 5) can push a condensed note to an external knowledge
bank after a run finishes — today, a plain folder on disk such as an
Obsidian vault. Opt in per repo with `.agent-relay/bank.conf`; nothing reads
the bank back into the other three stages yet. Format, trust boundaries, and
how to add another backend: [`docs/bank.md`](docs/bank.md).

## Parallel helpers

If several agents share one run id, use the helpers shipped **inside** the
implement skill bundle (`scripts/task-init.sh`, `scripts/task-claim.sh` next to
`SKILL.md`). They use per-task files and `mkdir` locks. Protocol detail:
[`docs/task-claim.md`](docs/task-claim.md).

Covered by `tests/tasks.sh` (including concurrent steal with a per-task mutex,
ident validation, dependency cycles, and portable sorting):

- Exactly one winner when two agents race a `steal`
- `claim` never auto-steals a stale lock (use explicit `steal`)
- Status whitelist; release ownership checks; `--session` in both positions
- `task-claim.sh check <id>` compares generated rollups to per-task files and
  exits non-zero on `MISMATCH` (detects hand-edited rollups; does not repair)
- `task-claim.sh rollup <id>` regenerates the plan rollup on demand; most
  other subcommands already do this as their last step, so you rarely need
  it directly

Still true:

- Serializes **task status** (and per-task reports), not overlapping source edits
- Use disjoint paths or separate worktrees when files overlap
- If `implement-plan/` already exists, `atry-implement` tells the agent to
  use `task-claim.sh` and not hand-edit the rollup `.md` files — that is skill
  text, not a lock on the filesystem

## Install

Requires bash ≥ 3.2. No `sudo`. Writes only under `$HOME`. Each skill installs
as a **bundle**. Flags, `targets.conf`, and adding a tool:
[`docs/installer.md`](docs/installer.md). Trust boundaries:
[`docs/security.md`](docs/security.md).

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

Checksums catch truncated downloads. They do **not** stop a replaced release.
`targets.conf` is still `source`d by install/uninstall/verify. Before that,
the scripts run an **allowlist** check (`validate_targets_conf`): only plain
`KEY=value` / `KEY=(...)` lines, with command substitution, backticks, pipes,
redirects, and control operators refused. That is a mitigation, not a proof
that sourcing is safe. Treat release trust like any other script you download.

```bash
REF="v3.1.1"
curl -fLO "https://github.com/tranthethang/agent-relay/releases/download/${REF}/install.sh"
curl -fLO "https://github.com/tranthethang/agent-relay/releases/download/${REF}/SHA256SUMS"
shasum -a 256 -c SHA256SUMS
bash ./install.sh --ref "$REF"
```

### Upgrading from 3.0.x

3.0.x installs have no `.agent-relay-owned` marker, so 3.1.x refuses to
overwrite them. Remove first, then reinstall:

```bash
./bin/uninstall.sh --force
./bin/install.sh
```

Details: [`docs/installer.md`](docs/installer.md). Pre-3.0 run directories
are unsupported; start new runs under `{YMD}-{RUN_ID}-{RUN_SLUG}/`.

## Honest limits

- Nothing forces an agent to follow a skill or to use a different tool for
  cross-review. Provenance lines are **records**, not enforcement.
  `review-section.sh` prints a **non-blocking** warning when a Cross-Review
  provenance `tool=`/`model=` matches the latest Self-Review in the same file
  (fence-aware; `unknown` is ignored).
- Parallel claim does not protect overlapping source-file edits.
- Antigravity’s skills path has moved before; install can “succeed” while the
  app ignores the files.
- `targets.conf` is still executed as bash after the allowlist check above.

## Development

```bash
make test                 # smoke + tasks + remote smoke
bash scripts/sync-bootstrap.sh --check
bash scripts/sync-references.sh --check
```

| Doc | Topic |
| --- | --- |
| [`docs/INDEX.md`](docs/INDEX.md) | Full maintainer doc index |
| [`docs/architecture.md`](docs/architecture.md) | How layers fit; non-goals |
| [`docs/installer.md`](docs/installer.md) | Install/uninstall/verify mechanics, `targets.conf`, adding a tool |
| [`docs/skills-authoring.md`](docs/skills-authoring.md) | Bundle layout, sync workflow, adding a skill |
| [`docs/file-conventions.md`](docs/file-conventions.md) | `.agent-relay/` artifact names, per-run directory layout, id resolution |
| [`docs/task-claim.md`](docs/task-claim.md) | Parallel task helpers, locks, `check` |
| [`docs/testing.md`](docs/testing.md) | Suites, CI, adding regressions |
| [`docs/release.md`](docs/release.md) | `VERSION`, tag, `dist/` assets |
| [`docs/security.md`](docs/security.md) | Trust boundaries, what checksums do and do not prove |
| [`docs/troubleshooting.md`](docs/troubleshooting.md) | Install / sync / lock triage |

Also: [`CONTRIBUTING.md`](CONTRIBUTING.md), [`AGENTS.md`](AGENTS.md),
[`CHANGELOG.md`](CHANGELOG.md).
