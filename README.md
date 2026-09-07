# agent-relay

agent-relay ships a reusable, tool-agnostic pipeline of AI coding skills —
**implement → self-review → cross-review** — for multi-agent workflows like
Cursor + Antigravity. One neutral markdown source per stage under `skills/`,
one installer that adapts and installs it globally into each tool's native
rules/skills format. Extensible to Codex, Claude, and beyond.

## Table of contents

- [Why](#why)
- [Pipeline](#pipeline)
- [Install](#install)
  - [Recommended: verified release install](#recommended-verified-release-install)
  - [Verify and uninstall](#verify-and-uninstall)
  - [Advanced: clone locally](#advanced-clone-locally)
  - [Advanced: pin commit SHA](#advanced-pin-commit-sha)
  - [Safety notes](#safety-notes)
- [Options](#options)
- [Adding a new target tool](#adding-a-new-target-tool)
- [Status](#status)
- [License](#license)

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

## Install

Requires **bash ≥ 3.2** (macOS system `/bin/bash` is fine). Skills install
**globally** into:

- `~/.cursor/skills/<name>/SKILL.md` for Cursor (Agent Skills)
- `~/.gemini/config/skills/<name>/SKILL.md` for Antigravity

Re-running install also removes prior Cursor rule copies at
`~/.cursor/rules/atry-*.mdc` (legacy layout).

### Recommended: verified release install

Download the release script and checksum file, verify the SHA-256 signature, then run locally:

```bash
# 1. Choose release tag
REF="v0.1.0"

# 2. Download install script and checksums
curl -fLO "https://github.com/tranthethang/agent-relay/releases/download/${REF}/install.sh"
curl -fLO "https://github.com/tranthethang/agent-relay/releases/download/${REF}/SHA256SUMS"

# 3. Verify SHA-256 checksum (macOS: shasum, Linux: sha256sum)
shasum -a 256 -c --ignore-missing SHA256SUMS

# 4. Run installer
bash ./install.sh
```

The installer will automatically download the release archive, verify its integrity against `SHA256SUMS`, and extract and configure the skills.

### Verify and uninstall

Follow the same download-verify-run pattern for verification and removal:

**Verify:**

```bash
curl -fLO "https://github.com/tranthethang/agent-relay/releases/download/${REF}/verify.sh"
shasum -a 256 -c --ignore-missing SHA256SUMS
bash ./verify.sh
```

**Uninstall:**

```bash
curl -fLO "https://github.com/tranthethang/agent-relay/releases/download/${REF}/uninstall.sh"
shasum -a 256 -c --ignore-missing SHA256SUMS
bash ./uninstall.sh
```

### Advanced: clone locally

Clone the repo when you want a local checkout, custom edits, or to run smoke tests:

```bash
git clone https://github.com/tranthethang/agent-relay.git
cd agent-relay
./install.sh
./verify.sh
```

### Advanced: pin commit SHA

In remote mode, installs targeting a specific 40-character commit SHA require an explicit `--sha256` checksum:

```bash
bash ./install.sh --ref <40-char-commit-sha> --sha256 <expected-sha256-hex>
```

Or via environment variables:

```bash
export AGENT_RELAY_REF="<40-char-commit-sha>"
export AGENT_RELAY_SHA256="<expected-sha256-hex>"
bash ./install.sh
```

### Safety notes

- **No `curl | bash`**: agent-relay encourages downloading and verifying scripts before running them, preventing execution of truncated downloads or unauthorized payload changes.
- **No floating refs**: Remote installs from floating branches (like `main` or `master`) are refused for security. Use immutable release tags or explicit commit hashes with checksums.
- **No `sudo`**: agent-relay never requires elevated privileges.
- **Scoped to `$HOME`**: All files are written strictly to user configuration directories under `$HOME`.

## Options

Supported by `install.sh`, `uninstall.sh`, and `verify.sh` where noted:

```
--only TOOL[,TOOL]    Limit to specific tools (case-insensitive;
                      e.g. --only cursor or --only CURSOR,antigravity)
--skill NAME[,NAME]   Limit to specific skills (e.g. --skill atry-implement)
--ref REF             Target release tag (e.g. v0.1.0) or commit SHA (remote mode)
--sha256 HEX          Explicit SHA-256 checksum (required for commit SHA)
--dry-run             Show what would be written/removed, without changing anything
                      (install, uninstall)
--no-clobber          Skip destinations that already exist (install only;
                      default is to overwrite prior installs of the same files)
```

Unknown tool/skill names are rejected. Re-running install without `--no-clobber`
silently overwrites previously installed copies of these skills.

Smoke test commands:

```bash
make test        # run both local and remote smoke tests
```

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
