# Install

Two paths. Both copy the same six bundles.

```bash
npm i -g @tranthethang/agent-relay@latest
atry skills install --tool claude-code
atry skills status --tool claude-code
```

```bash
npx skills add tranthethang/agent-relay -g --copy
```

The npm tarball holds `dist/atry.js` and `skills/`. `atry skills install`
copies the six bundles from that tarball into one tool directory, so the CLI
and the six bundles come from one version: `0.10.7`. `--dir <path>` replaces
the tool path. It runs on every install: a missing bundle is `installed`, a
bundle whose canonical files changed is `updated`, and an identical bundle is
`unchanged`. The copy overwrites `SKILL.md` and `references/` and keeps extra
local files. A second install after an upgrade therefore updates the canonical
files and leaves extra local files alone.

The release sets the package version before the build. A post-publish job
installs the published tarball into a temporary prefix and checks `atry
version`, `atry preflight`, `atry skills install`, and `atry skills status`.
Upgrade the CLI, then run `atry skills install` again to update the bundles.

`atry skills status` compares each installed bundle with the bundled one. A
bundle is `ok` when its floor fits and its content matches. It is `stale` when
only the content differs, `mismatch` when the floor is too high, and `missing`
when `SKILL.md` is absent. With no `--tool` or `--dir` it checks the tool
directories that exist. `--all` checks every directory, so an absent tool
fails. It exits 1 and prints the exact install command.

`atry doctor` checks the installed bundles and the version that `atry` on
`PATH` reports. It fails when a bundle is stale or missing, or when `PATH`
runs a different base version from the running CLI.

| Tool        | `skills` agent id | `atry skills install` directory |
| ----------- | ----------------- | ------------------------------- |
| Cowork      | `cowork`          | `~/.agents/skills/<name>/`      |
| Cursor      | `cursor`          | `~/.agents/skills/<name>/`      |
| Codex       | `codex`           | `~/.agents/skills/<name>/`      |
| Antigravity | `antigravity`     | `~/.agents/skills/<name>/`      |
| Claude Code | `claude-code`     | `~/.claude/skills/<name>/`      |
| Kiro        | `kiro-cli`        | `~/.kiro/skills/<name>/`        |

`skills add` copies `skills/*/SKILL.md` and `references/` into tool skill
directories. `--copy` avoids symlinks. `-g` writes under the user home.

Cursor, Codex, and Antigravity share one directory because those agents use
the universal `.agents/skills` layout. Cowork reads that layout too. Claude
Code and Kiro get their own copies.

## Install deadlocks and stale bundles

- An `@latest` tag that still points at an older release cannot satisfy a
  bundle floor of `>=0.10.7`. Install `@0.10.7` by name. Do not lower
  `requires-atry` to clear the error.
- A stale bundle has a floor that fits and content that differs. Run
  `atry skills install --tool <tool>` again. The copy updates `SKILL.md` and
  `references/` and keeps extra local files.
- A content hash mismatch is `stale` when only the content differs and
  `mismatch` when the floor is too high. `stale` needs a reinstall; `mismatch`
  needs a newer CLI.
- `atry doctor` compares the running CLI with the `atry` on `PATH`. If
  `path-version` fails, the shell runs a different base version from the one
  you upgraded. Put the intended `atry` first on `PATH`, then rerun
  `atry skills install` and `atry skills status`.

`npm i -g` installs the `atry` binary from `dist/atry.js`. It requires
Node.js 22 or newer.

There is no `install.sh` and no migration from an older `~/.agent-relay`
tree. Remove an old skill directory by hand or with `skills remove`.

A local check uses the repo path:

```bash
npx skills add /path/to/agent-relay -g --copy -y --json \
  -a cursor -a claude-code -a codex -a antigravity -a kiro-cli
```

Set `HOME` (and `USERPROFILE` on Windows) when the check must not touch the
real home directory.

## Dev build

`npm run build` writes `dist/atry.js` and `dist/package.json`. Because
`package.json` in git stays at `0.0.0`, the build writes `0.10.7-dev` there.
`node dist/atry.js version` prints that value and a `dev build` marker.
`node dist/atry.js preflight` refuses a dev build and prints the install
command, unless `ATRY_DEV=1` is set or `--allow-dev` is passed. The `atry`
binary on `PATH` does not read this build. The release workflow sets a real
version before the build, so a published package reports that version and no
marker. Use `--allow-dev` or `ATRY_DEV=1` only for a local build. Do not use a
dev build for a real run.
