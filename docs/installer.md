# Install

Two commands. They do not share files.

```bash
npx skills add tranthethang/agent-relay -g --copy
npm i -g @tranthethang/agent-relay
```

`skills add` copies `skills/*/SKILL.md` and `references/` into tool skill
directories. `--copy` avoids symlinks. `-g` writes under the user home.

The `skills` CLI chooses the directories. Current global paths for the five
tools this repo documents:

| Tool        | `skills` agent id | Path                       |
| ----------- | ----------------- | -------------------------- |
| Cursor      | `cursor`          | `~/.agents/skills/<name>/` |
| Codex       | `codex`           | `~/.agents/skills/<name>/` |
| Antigravity | `antigravity`     | `~/.agents/skills/<name>/` |
| Claude Code | `claude-code`     | `~/.claude/skills/<name>/` |
| Kiro        | `kiro-cli`        | `~/.kiro/skills/<name>/`   |

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
