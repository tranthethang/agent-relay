# Contributing

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

```bash
make test              # local smoke + tasks + remote smoke
./tests/smoke.sh       # install/uninstall/verify (fake HOME)
./tests/tasks.sh       # task-init / task-claim / report helpers
./tests/smoke-remote.sh  # offline remote-mode stubs
```

Requires bash ≥ 3.2. All three scripts are offline. Remote smoke stubs
`curl` and uses `tests/fixtures/`.

There is no Markdown formatter and no Python toolchain in this repo.

## Reporting install or smoke failures

Include:

- OS and version
- `bash --version`
- Tools selected (`--only …`, or the default set)
- The command and the relevant output

## Where things live

- Installer: `bin/`
- Skill text: `skills/`
- Install destinations: [`targets.conf`](targets.conf)
- Artifact names: [`docs/file-conventions.md`](docs/file-conventions.md)
- Empty outlines (not a sample run): [`templates/`](templates/)
- Optional parallel helpers: `scripts/task-*.sh`, `scripts/resolve-task-bin.sh`
  (installed to `~/.agent-relay/scripts/`)

Install support for a tool is not the same as having used the stages in that
tool. This repo does not keep a log of either.
