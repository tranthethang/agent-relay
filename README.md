# agent-relay

[![CI](https://github.com/tranthethang/agent-relay/actions/workflows/ci.yml/badge.svg)](https://github.com/tranthethang/agent-relay/actions/workflows/ci.yml)

Three markdown skills and a bash installer. The skills tell an agent how to
implement a plan, review that work, and append a second review. The installer
copies each skill into global skill directories. It does not run the stages,
pick a model, or talk to any agent runtime.

CI checks the installer (local and remote smoke tests). It does not check
whether an agent follows a skill.

## What this is not

- Not a message bus, orchestrator, or multi-agent runtime. You open a tool and
  invoke a skill yourself.
- Not a measured result. This repo does not include a recorded run, and it
  does not show that a second tool catches bugs the first one missed.
- Not a format adapter for the current targets. Cursor, Antigravity, Claude,
  and Codex all use `skill-folder`. Install copies `skills/<name>.md` to
  `<tool-dir>/<name>/SKILL.md`. An unused `mdc-flat` writer remains in
  `bin/install.sh` for the old Cursor rules layout.

## Stages

There is no plan skill here. Write `.agent-relay/plan-<id>.md` yourself, or
with whatever planning mode you already use, then invoke the skills in order.

| Order | Skill | What it is expected to do |
| ----- | ----- | ------------------------- |
| 1 | *(not in this repo)* | Produce `.agent-relay/plan-<id>.md` |
| 2 | [`skills/atry-implement.md`](skills/atry-implement.md) | Implement that plan; write `implement-plan-<id>.md` and `implement-report-<id>.md` |
| 3 | [`skills/atry-self-review.md`](skills/atry-self-review.md) | Review the diff against the plan; overwrite `review-*-<id>.md` with a `Self-Review` section |
| 4 | [`skills/atry-cross-review.md`](skills/atry-cross-review.md) | Append a `Cross-Review` section. The skill asks you to use a different tool than self-review. Nothing enforces that. |

File names, `CURRENT`, and the run id are specified in
[`docs/file-conventions.md`](docs/file-conventions.md). Empty templates (not a
sample run) are in [`templates/`](templates/).

After you change files under `skills/`, run `./bin/install.sh` again. Installed
copies are not updated until you do. Default install overwrites the same
skill files.

## Install

Requires bash ≥ 3.2. macOS `/bin/bash` is enough. No `sudo`. Writes only under
`$HOME`:

| Tool | Destination |
| ---- | ----------- |
| Cursor | `~/.cursor/skills/<name>/SKILL.md` |
| Antigravity | `~/.gemini/config/skills/<name>/SKILL.md` |
| Claude | `~/.claude/skills/<name>/SKILL.md` |
| Codex | `~/.codex/skills/<name>/SKILL.md` |

Antigravity's global skills path has moved before. `targets.conf` matches the
shared `~/.gemini/config/skills` location documented for current Antigravity
surfaces. If a given app does not load skills from there, the install still
"succeeds" and the skill will not appear.

Re-running install deletes previous copies of these skills at
`~/.cursor/rules/atry-*.mdc` and the Antigravity legacy dirs listed in
`targets.conf`.

### Release install

Download the release script and `SHA256SUMS`, check the checksum, then run.
These are checksums, not a signature. Both files come from the same GitHub
Release, so a replaced release would still match. The check catches a truncated
or corrupted download.

Chain the steps so a failed check does not continue. On Linux, `sha256sum -c`
is the usual tool; macOS has `shasum`.

```bash
REF="v0.3.0"
curl -fLO "https://github.com/tranthethang/agent-relay/releases/download/${REF}/install.sh"
curl -fLO "https://github.com/tranthethang/agent-relay/releases/download/${REF}/SHA256SUMS"
if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 -c --ignore-missing SHA256SUMS
else
  sha256sum -c --ignore-missing SHA256SUMS
fi
bash ./install.sh
```

The downloaded file is still named `install.sh`. In a clone the same script is
`bin/install.sh`. The release script has `DEFAULT_REF` set to that tag. It then downloads
`agent-relay-${REF}.tar.gz`, checks that file against the release `SHA256SUMS`,
and copies skills from the archive. A checkout of this repo runs in local mode
and does not download anything.

`--ignore-missing` skips `SHA256SUMS` entries you did not download (the
tarball, `verify.sh`, `uninstall.sh`). It still fails if `install.sh` itself
does not match.

### Verify and uninstall

Use the same tag. Download `SHA256SUMS` again if it is not already in the
current directory. Do not assume `$REF` is still set.

```bash
REF="v0.3.0"
curl -fLO "https://github.com/tranthethang/agent-relay/releases/download/${REF}/SHA256SUMS"
curl -fLO "https://github.com/tranthethang/agent-relay/releases/download/${REF}/verify.sh"
if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 -c --ignore-missing SHA256SUMS
else
  sha256sum -c --ignore-missing SHA256SUMS
fi
bash ./verify.sh
```

```bash
REF="v0.3.0"
curl -fLO "https://github.com/tranthethang/agent-relay/releases/download/${REF}/SHA256SUMS"
curl -fLO "https://github.com/tranthethang/agent-relay/releases/download/${REF}/uninstall.sh"
if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 -c --ignore-missing SHA256SUMS
else
  sha256sum -c --ignore-missing SHA256SUMS
fi
bash ./uninstall.sh
```

`verify.sh` checks that the installed `SKILL.md` files match the release
archive. It does not check that a tool loads them.

### From a clone

```bash
git clone https://github.com/tranthethang/agent-relay.git
cd agent-relay
./bin/install.sh
./bin/verify.sh
```

### Pin a commit

A 40-character commit SHA is refused unless you pass the archive checksum.
That checksum is not published by this repo for arbitrary commits; you have
to compute it yourself for the GitHub archive tarball of that SHA.

```bash
bash ./bin/install.sh --ref <40-char-commit-sha> --sha256 <archive-sha256-hex>
```

`--ref` or `AGENT_RELAY_REF` always downloads that ref, including from a
clone. It does not install the working tree. Flags such as `--only` and
`--dry-run` apply to the extracted archive. Remote install of `main` or
`master` is refused. Use a release tag or a pinned SHA plus checksum.

## Options

`bin/install.sh`, `bin/uninstall.sh`, and `bin/verify.sh`
(release downloads use the same filenames without the `bin/` prefix):

```
--only TOOL[,TOOL]    Limit to tools (case-insensitive; e.g. --only cursor)
--skill NAME[,NAME]   Limit to skills (e.g. --skill atry-implement)
--ref REF             Release tag or 40-char commit SHA (remote mode)
--sha256 HEX          Required for a commit SHA
--dry-run             Print paths; do not write or delete (install, uninstall)
--no-clobber          Skip destinations that already exist (install only)
```

Unknown tool or skill names are rejected. Without `--no-clobber`, install
overwrites existing copies of these skills, including local edits.

```bash
make test
```

runs `tests/smoke.sh` and `tests/smoke-remote.sh`. Both are offline.
`smoke-remote.sh` stubs `curl` and uses `tests/fixtures/`.

## Adding a tool

Add a `<TOOL>_DIR` / `<TOOL>_FORMAT` pair to [`targets.conf`](targets.conf)
and append the name to `TOOLS`. If the format is not `skill-folder` or
`mdc-flat`, add a writer in `bin/install.sh` and matching remove/check logic in
`bin/uninstall.sh` / `bin/verify.sh`.

That copies the same skill text. It does not make the stage work in that
tool. Skill text assumes a git checkout, and it refers to `AGENTS.md` /
`CLAUDE.md` when those files exist.

## Limits

- Global install only. There is no per-repo pin.
- Nothing records which model or tool ran a stage.
- Self-review overwrites the review files. Cross-review appends. Re-running
  self-review drops the previous self-review section.
- Each skill repeats the run-id order. `docs/file-conventions.md` lives only
  in this repo. It is not copied next to the installed `SKILL.md`.
- Run ids are supposed to be 10 URL-safe characters. The documented `npx`
  command downloads a package. The `openssl` fallback can yield fewer than
  10 characters after filtering.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Release notes are in
[CHANGELOG.md](CHANGELOG.md).

## License

MIT — see [LICENSE](LICENSE).
