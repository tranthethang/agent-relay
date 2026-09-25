# Testing

Offline suites. They do **not** prove an agent followed a skill or that a host
app loaded an installed bundle.

## Commands

```bash
make test                 # smoke + tasks + remote smoke
make smoke                # same as test today
./tests/smoke.sh          # install / uninstall / verify under fake HOME
./tests/tasks.sh          # atry task-init / claim / review helpers
./tests/smoke-remote.sh   # --ref path with stubbed curl + fixtures
```

Also required before claiming a change that touches sync surfaces:

```bash
bash scripts/maint/sync-bootstrap.sh --check
bash scripts/maint/sync-references.sh --check
bash -n bin/*.sh lib/*.sh scripts/atry scripts/runtime/*.sh scripts/maint/*.sh tests/*.sh
```

CI (`.github/workflows/ci.yml`):

- Matrix: `ubuntu-latest`, `macos-latest` — both sync checks + all three test
  scripts  
- `shellcheck -S error` on `bin/`, `scripts/atry`, `scripts/runtime/`,
  `scripts/maint/`, `lib/`, `tests/`  

Severity floor is **error**, not warning: warning-level findings still exist
on purpose until cleaned up (see `CONTRIBUTING.md`).

## What each suite covers

### `tests/smoke.sh`

- Installs into a temporary `HOME` (never your real skill dirs)  
- Per-tool skill-folder paths for cursor / antigravity / claude / codex / kiro  
- Front-matter: each installed `SKILL.md` starts with `---` and has non-empty
  `name:` / `description:` inside that block  
- Bundle `references/` present; no skill `scripts/`; `~/.agent-relay` `atry`
  CLI + PATH shim  
- Ownership marker `.agent-relay-owned`; uninstall refuses unmarked dirs;
  `--force` uninstall; symlink destination outside tool dir refused  
- Flag edge cases: `--only`, unknown tool/skill, `--no-clobber`, `--target`
  rejected  
- `validate_targets_conf`: real `targets.conf`, benign `.resource` path, bare
  command line, `VAR=value cmd`, command substitution  

### `tests/tasks.sh`

- Happy path claim → update → release → list  
- `check` OK → hand-edited rollup → `MISMATCH` → restore → OK  
- Lock collision, concurrent claim, steal mutex, deps / cycles / sorting  
- Cross-operation races (barrier + N iterations): steal vs release, claim vs
  steal, update vs steal, release vs release  
- Rejected inputs: invalid init status / dependency id, failed-init cleanup,
  unowned `report-write` (and `--force` history)  
- `atry review` upsert idempotency, fenced headings (char/length/indent),
  same-tool warning, fence-aware provenance  
- `scripts/maint/sync-references.sh --check` and drift / orphan-scripts
  detection  

### `tests/smoke-remote.sh`

- Stubbed `curl` + `tests/fixtures/` tarball / `SHA256SUMS`  
- Honors `--ref` / `--sha256` and `AGENT_RELAY_*` env  
- Bad checksum / layout failures  

Requires fixtures under `tests/fixtures/` (script errors clearly if missing).

## Adding a regression

1. Prefer extending the suite that already owns the surface (`smoke` vs
   `tasks`).  
2. Keep tests offline (no network, no real `$HOME`).  
3. For bash heredocs that embed `` ``` `` or `$()`, use `printf` / quoted
   heredocs — unquoted `<<EOF` expands backticks (already burned once in
   review-section tests).  
4. After changing `scripts/runtime/` or `docs/file-conventions.md`, run
   `scripts/maint/sync-references.sh` (not only `--check`) and reinstall so
   `~/.agent-relay` matches before dogfooding.  
5. After changing `lib/bootstrap.sh`, run `scripts/maint/sync-bootstrap.sh`.  

## What green CI does *not* mean

- A listed IDE loads the skill  
- Provenance `tool=` / `model=` were truthful  
- Parallel agents did not race the same source file  
