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
make test              # local + remote smoke
./tests/smoke.sh       # local install/uninstall/verify only
```

Requires bash ≥ 3.2. Both smoke scripts are offline. Remote smoke stubs
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

Install support for a tool is not the same as having used the stages in that
tool. This repo does not keep a log of either.
