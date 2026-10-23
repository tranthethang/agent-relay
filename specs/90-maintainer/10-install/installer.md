# Install

Two paths. Both copy the same six bundles.

```bash
npm i -g @tranthethang/agent-relay
atry skills install --tool claude-code
atry skills status --tool claude-code
```

```bash
npx skills add tranthethang/agent-relay -g --copy
```

The npm tarball holds `dist/atry.js` and `skills/`. `atry skills install`
copies the six bundles from that tarball into one tool directory, so the CLI
and the skills come from one version. `--dir <path>` replaces the tool path.
It runs on every install: a missing bundle is `installed`, a bundle whose
canonical files changed is `updated`, and an identical bundle is `unchanged`.
The copy overwrites `SKILL.md` and `references/` and keeps extra local files.

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
| Cursor      | `cursor`          | `~/.agents/skills/<name>/`      |
| Codex       | `codex`           | `~/.agents/skills/<name>/`      |
| Antigravity | `antigravity`     | `~/.agents/skills/<name>/`      |
| Claude Code | `claude-code`     | `~/.claude/skills/<name>/`      |
| Kiro        | `kiro-cli`        | `~/.kiro/skills/<name>/`        |

`skills add` copies `skills/*/SKILL.md` and `references/` into tool skill
directories. `--copy` avoids symlinks. `-g` writes under the user home.

Cursor, Codex, and Antigravity share one directory because those agents use
the universal `.agents/skills` layout. Claude Code and Kiro get their own
copies.

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
marker.
