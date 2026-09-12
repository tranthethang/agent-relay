# Installer

How `bin/install.sh`, `bin/uninstall.sh`, and `bin/verify.sh` work, and how to
change install targets without breaking CI.

## Entry points

| Script | Role |
| --- | --- |
| `bin/install.sh` | Copy skill bundles into each selected tool’s directory under `$HOME` |
| `bin/uninstall.sh` | Remove those copies (and known legacy paths) |
| `bin/verify.sh` | Check expected files exist after install |

All three:

- Require bash ≥ 3.2  
- Never use `sudo`  
- Write only under `$HOME`  
- Load destinations from `targets.conf` after `validate_targets_conf`  
- Can run from a clone **or** download a release via `--ref` / env vars  

Shared download / checksum / validation logic lives in `lib/bootstrap.sh` and is
inlined between `# BEGIN BOOTSTRAP` / `# END BOOTSTRAP` in each bin script.
After editing `lib/bootstrap.sh`, run:

```bash
bash scripts/sync-bootstrap.sh
bash scripts/sync-bootstrap.sh --check
```

## `targets.conf`

One block per tool, plus `TOOLS=(...)` listing names in install order:

```bash
CURSOR_DIR="$HOME/.cursor/skills"
CURSOR_FORMAT="skill-folder"
CURSOR_LEGACY_DIRS=("$HOME/.cursor/rules")   # optional
TOOLS=(CURSOR ANTIGRAVITY CLAUDE CODEX)
```

Only `FORMAT=skill-folder` is supported: install copies the whole
`skills/<name>/` tree (`SKILL.md`, `references/`, `scripts/`).

### Validation before `source`

`validate_targets_conf` (in `lib/bootstrap.sh`) allowlists full-line shapes:

- `NAME="..."` / `NAME='...'` / `NAME=simple`  
- `NAME=( ... )` with quoted paths or simple tokens  

It refuses `$(…)`, backticks, `;`, `&&`, `||`, `|`, redirects, `$IFS`, and any
non-assignment line (bare commands, `VAR=value cmd`). This is a **mitigation**:
the file is still executed as bash afterward. See [security.md](security.md).

## Common flags

Same family of flags on install / uninstall / verify (details in each script’s
`--help`):

| Flag | Meaning |
| --- | --- |
| `--only TOOL[,TOOL…]` | Subset of `TOOLS` (case-insensitive names, e.g. `cursor`) |
| `--skill NAME[,NAME…]` | Subset of `skills/` directories |
| `--ref REF` | Download that release tag or commit instead of using the working tree |
| `--sha256 HEX` | Pin checksum when fetching a commit tarball |
| `--dry-run` | Print actions; write nothing |
| `--no-clobber` | Skip destinations that already exist (install) |

Env overrides: `AGENT_RELAY_REF`, `AGENT_RELAY_SHA256` (same idea as CLI).
`--ref` / env **always** fetch even when run from a clone so a pin cannot be
silently ignored.

Re-running install **without** `--no-clobber` overwrites prior installs of the
same skills.

## Adding a tool

1. Add `NAME_DIR`, `NAME_FORMAT="skill-folder"`, optional `NAME_LEGACY_DIRS=(…)`  
2. Append `NAME` to `TOOLS=(…)`  
3. Keep paths under `$HOME`  
4. Ensure lines pass `validate_targets_conf` (plain assignments only)  
5. Extend `tests/smoke.sh` if the new path should be exercised  
6. Document the destination in the root README table  

You should **not** need to edit `install.sh` unless you introduce a new
`FORMAT` (none is planned).

## Legacy cleanup

Install and uninstall remove leftovers when configured:

- Cursor: old `.mdc` under `CURSOR_LEGACY_DIRS`  
- Antigravity: previous roots in `ANTIGRAVITY_LEGACY_DIRS`  
- Global `~/.agent-relay/scripts/` from pre-1.0 helper installs  

Absence of those paths is not an error.

## Release-mode install

Users may download `install.sh` + `SHA256SUMS` from a GitHub Release and run
`bash ./install.sh --ref vX.Y.Z`. Checksums catch **truncated** downloads; they
do not prove the release asset was not replaced. See [release.md](release.md)
and [security.md](security.md).
