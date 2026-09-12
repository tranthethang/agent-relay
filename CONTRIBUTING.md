# Contributing

Agent-oriented constraints for editing this repo (bash 3.2, sync scripts,
honest limits): [`AGENTS.md`](AGENTS.md). Deeper maintainer guides:
[`docs/INDEX.md`](docs/INDEX.md).

## Quick start

```bash
git clone https://github.com/tranthethang/agent-relay.git
cd agent-relay
./bin/install.sh
./bin/verify.sh
```

That copies skills into your user skill directories. It does not exercise
implement or review.

## Tests

Detail: [`docs/testing.md`](docs/testing.md).

```bash
make test              # local smoke + tasks + remote smoke
./tests/smoke.sh       # install/uninstall/verify (fake HOME)
./tests/tasks.sh       # task-init / task-claim / report helpers
./tests/smoke-remote.sh  # offline remote-mode stubs
```

Requires bash ≥ 3.2. All three scripts are offline. Remote smoke stubs
`curl` and uses `tests/fixtures/`.

CI also runs `shellcheck -S error` on `bin/*.sh`, `scripts/*.sh`, `lib/*.sh`,
and `tests/*.sh`. The floor is **error**, not warning: warning-level findings
still exist and would drown the signal. The commitment is to clear warnings
and raise the floor to `-S warning`, then style, over time — not to disable
the job.

CI runs `scripts/sync-references.sh --check` so
`skills/*/references/file-conventions.md` cannot drift from
`docs/file-conventions.md`.

There is no Markdown formatter and no Python toolchain in this repo.

## Reporting install or smoke failures

Include:

- OS and version
- `bash --version`
- Tools selected (`--only …`, or the default set)
- The command and the relevant output

## Where things live

- Installer: `bin/`
- Skill bundles: `skills/<name>/` (`SKILL.md`, `references/`, `scripts/`)
- Install destinations: [`targets.conf`](targets.conf) (sourced after
  `validate_targets_conf`)
- Artifact names: [`docs/file-conventions.md`](docs/file-conventions.md)
- Empty outlines (not a sample run): [`templates/`](templates/)
- Task helpers (repo + bundled copies): `scripts/task-*.sh`,
  `scripts/review-section.sh`
- Release version: [`VERSION`](VERSION) (must match the `v*` tag)

Install support for a tool is not the same as having used the stages in that
tool. This repo does not keep a log of either.
