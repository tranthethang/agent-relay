# Contributing

## Quick start

```bash
git clone https://github.com/tranthethang/agent-relay.git
cd agent-relay
./install.sh
./verify.sh
```

## Tests

```bash
make test              # local + remote smoke
./tests/smoke.sh       # local install/uninstall/verify only
```

Requires **bash ≥ 3.2**. Remote smoke needs network access to GitHub releases.

## Reporting results

When filing an issue about install or smoke failures, include:

- OS and version (e.g. macOS 15, Ubuntu 24.04)
- `bash --version`
- Which tools you installed (`--only …` or full default set)
- Command run and pass/fail (paste relevant smoke output)

## Scope notes

Skill sources live under `skills/`. Global install destinations are listed in
[`targets.conf`](targets.conf). See [README](README.md) Status for what is
dogfooded vs install-only.
