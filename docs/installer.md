# Installer

How `bin/install.sh`, `bin/uninstall.sh`, and `bin/verify.sh` work, and how to
change install targets without breaking CI.

## Entry points

| Script | Role |
| --- | --- |
| `bin/install.sh` | Copy skill bundles into each selected tool’s directory under `$HOME`; install `atry` under `~/.agent-relay` |
| `bin/uninstall.sh` | Remove those copies (and `~/.agent-relay` on a full uninstall) |
| `bin/verify.sh` | Check expected files exist after install (skills + `atry`) |

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
bash scripts/maint/sync-bootstrap.sh
bash scripts/maint/sync-bootstrap.sh --check
```

## `targets.conf`

One block per tool, plus `TOOLS=(...)` listing names in install order:

```bash
CURSOR_DIR="$HOME/.cursor/skills"
CURSOR_FORMAT="skill-folder"
TOOLS=(CURSOR ANTIGRAVITY CLAUDE CODEX KIRO)
```

Only `FORMAT=skill-folder` is supported: install copies `SKILL.md` +
`references/` (not `scripts/`). Runtime helpers install once under
`~/.agent-relay/` via `atry`.

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
| `--no-clobber` | Skip skill bundle directories that already exist (install) |
| `--force` | Uninstall only: remove destinations even without a valid ownership marker |

Env overrides: `AGENT_RELAY_REF`, `AGENT_RELAY_SHA256` (same idea as CLI).
`--ref` / env **always** fetch even when run from a clone so a pin cannot be
silently ignored.

Re-running install **without** `--no-clobber` overwrites prior installs of the
same skills **when** the destination has a valid `.agent-relay-owned` marker.
Unmanaged directories (no marker) are refused rather than wiped.

## Reinstall / ownership marker

Install refuses directories that lack a valid `.agent-relay-owned` marker
(`refusing to modify unmanaged skill directory`). To replace an unmanaged
skill install:

```bash
./bin/uninstall.sh --force
./bin/install.sh
```

After reinstalling, `./bin/verify.sh` reports the marker for each skill.

## Adding a tool

1. Add `NAME_DIR`, `NAME_FORMAT="skill-folder"`  
2. Append `NAME` to `TOOLS=(…)`  
3. Keep paths under `$HOME`  
4. Ensure lines pass `validate_targets_conf` (plain assignments only)  
5. Extend `tests/smoke.sh` if the new path should be exercised  
6. Document the destination in the root README table  

You should **not** need to edit `install.sh` unless you introduce a new
`FORMAT` (none is planned).


## Allowing atry in your tool

Every stage skill's first move is `atry version` (see `docs/file-conventions.md`,
"atry preflight"), and later steps run `atry resolve`, `atry run-init`, `atry
history`, `atry review`, and (in parallel mode) the `atry claim`/`update`/
`release`/... verbs. If your tool asks you to allow, trust, or allowlist
commands before an agent can run them, allow commands starting with `atry`
(a prefix allowlist such as `Bash(atry:*)`, if your tool supports that shape)
rather than allowing arbitrary shell. Skill text always calls the literal
`atry ...` command (never `$ATRY` variables, an absolute path, or a `cd ... &&
atry ...` chain) specifically so a prefix allowlist like this covers every
call the skills make.

Exact allowlist/config syntax differs per tool and changes over time; check
your tool's own documentation for how it expresses "allow this command
prefix" today rather than assuming the shape above matches exactly.

## Release-mode install

Users may download `install.sh` + `SHA256SUMS` from a GitHub Release and run
`bash ./install.sh --ref vX.Y.Z`. Checksums catch **truncated** downloads; they
do not prove the release asset was not replaced. See [release.md](release.md)
and [security.md](security.md).
