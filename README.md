# agent-relay

agent-relay ships a reusable, tool-agnostic pipeline of AI coding skills —
**implement → self-review → cross-review** — for multi-agent workflows like
Cursor + Antigravity. One neutral markdown source per stage under `skills/`,
one installer that adapts and installs it globally into each tool's native
rules/skills format. Extensible to Codex, Claude, and beyond.

## Why

Running plan → implement → review across *different* tools/models catches
more bugs than looping a single model over its own output — but rewriting
the same review logic per tool, per project, gets old fast. agent-relay keeps
one source of truth per stage and adapts it to wherever it needs to run.

## Pipeline

| Stage           | Skill                                                        | Typical runner                   |
| --------------- | ------------------------------------------------------------ | -------------------------------- |
| 1. Plan         | *(not included — bring your own planning step/mode)*         | e.g. Cursor Plan Mode            |
| 2. Implement    | [`skills/atry-implement.md`](skills/atry-implement.md)       | fast/cheap model                 |
| 3. Self-review  | [`skills/atry-self-review.md`](skills/atry-self-review.md)   | stronger model, same tool family |
| 4. Cross-review | [`skills/atry-cross-review.md`](skills/atry-cross-review.md) | a *different* tool/model family  |

All stages read/write a **run-scoped** set of files under `.agent-relay/`
(`plan-<id>.md`, `implement-*-<id>.md`, `review-*-<id>.md`, plus `CURRENT`) —
see [`docs/file-conventions.md`](docs/file-conventions.md). A shared NanoID per
run avoids collisions when several features are in flight; skills resolve the
active run via user path/id, then `CURRENT`, then a single matching plan.
A shape reference lives in [`examples/`](examples/). Re-run `./install.sh`
after pulling skill changes so installed Cursor/Antigravity copies stay in sync.

## Quick Start

Requires **bash ≥ 3.2** (macOS system `/bin/bash` is fine).

**Install:**

```bash
curl -fsSL https://raw.githubusercontent.com/tranthethang/agent-relay/main/install.sh | bash
```

**Verify:**

```bash
curl -fsSL https://raw.githubusercontent.com/tranthethang/agent-relay/main/verify.sh | bash
```

**Uninstall:**

```bash
curl -fsSL https://raw.githubusercontent.com/tranthethang/agent-relay/main/uninstall.sh | bash
```

Pass flags after `--` when piping:

```bash
curl -fsSL https://raw.githubusercontent.com/tranthethang/agent-relay/main/install.sh | bash -s -- --only cursor
```

## Install

Skills install **globally** into:

- `~/.cursor/rules/*.mdc` for Cursor
- `~/.gemini/config/skills/<name>/SKILL.md` for Antigravity

From a local checkout:

```bash
git clone https://github.com/tranthethang/agent-relay.git
cd agent-relay
./install.sh
./verify.sh
```

Options (install / uninstall / verify where noted):

```
--only TOOL[,TOOL]    Limit to specific tools (case-insensitive;
                      e.g. --only cursor or --only CURSOR,antigravity)
--skill NAME[,NAME]   Limit to specific skills (e.g. --skill atry-implement)
--dry-run             Show what would be written/removed, without changing anything
                      (install, uninstall)
--no-clobber          Skip destinations that already exist (install only;
                      default is to overwrite prior installs of the same files)
```

Unknown tool/skill names are rejected. Re-running install without `--no-clobber`
silently overwrites previously installed copies of these skills.

Installer smoke checks: `./tests/smoke.sh`

## Adding a new target tool

1. Add a `<TOOL>_DIR` / `<TOOL>_FORMAT` pair to [`targets.conf`](targets.conf)
   and list the tool in `TOOLS=(...)`.
1. If the tool's format isn't `mdc-flat` or `skill-folder` yet, add a small
   `write_<format>` helper to `install.sh` (and matching remove/check logic in
   `uninstall.sh` / `verify.sh`).

No changes to the skill content itself are needed — that's the point of
keeping it neutral.

## Status

Currently supports Cursor and Antigravity. Codex and Claude support are
planned — see the commented-out entries in `targets.conf`.

## License

MIT — see [LICENSE](LICENSE).
