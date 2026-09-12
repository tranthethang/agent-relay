# Security and trust boundaries

Honest scope for maintainers and careful users. This project is a skill
installer plus markdown instructions — not a hardened supply-chain product.

## Trust model (short)

| Surface | What you get | What you do not get |
| --- | --- | --- |
| Git clone + `./bin/install.sh` | Copies files from the tree you checked out | Proof the tree is free of malice |
| Release `SHA256SUMS` | Detection of **truncated** / wrong-file downloads | Proof GitHub assets were not replaced by an attacker with publish access |
| `validate_targets_conf` | Refuse obvious RCE shapes and non-assignment lines before `source` | A non-executing config parser; obfuscated bash can still be theoretically possible |
| Provenance HTML comments | A **claim** of tool/model/date | Verification of which runtime actually ran |
| Same-tool cross-review warning | stderr heads-up when recorded `tool=`/`model=` match | Blocking cross-review or detecting spoofed provenance |
| Parallel `claim` locks | Serialization of task **status** / report files | Protection of application source edits |

## Installer specifics

- `targets.conf` is still **`source`d** as bash after the allowlist check.  
- Allowlist accepts only simple `KEY=value` / `KEY=(...)` full lines and blocks
  `$()`, backticks, pipes, redirects, control operators, and bare commands.  
- Paths like `$HOME/.resource/...` must remain valid (substring keyword
  blocklists historically false-positived on `source` inside `resource`).  
- Download path (`--ref`) uses the same bootstrap helpers; pinning `--sha256`
  for commit tarballs is available and recommended when you need a content pin.  

Treat a downloaded `install.sh` like any other script you run as your user:
read it, prefer pins, limit `--only` if experimenting.

## Skill text

Skills can instruct an agent to run shell, edit files, or call tools in the
**target** repo. That power is the host agent product’s sandbox (or lack of
one), not agent-relay’s. Do not document agent-relay as providing isolation.

## Reporting

For installer / smoke failures, follow `CONTRIBUTING.md` (OS, bash version,
command, output). Security-sensitive findings about the allowlist or release
path should describe a concrete bypass against current `validate_targets_conf`
or checksum handling — not generic “please make it secure.”

## Related docs

- [installer.md](installer.md) — mechanics  
- [release.md](release.md) — how assets are built  
- [troubleshooting.md](troubleshooting.md) — operational failures (usually not security)  
