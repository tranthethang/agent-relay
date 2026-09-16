# Architecture

Short map of agent-relay for maintainers. This is descriptive of the current
tree, not a roadmap.

## What runs where

```text
┌─────────────────────────────────────────────────────────────┐
│  Human opens Cursor / Claude / Codex / Antigravity          │
│  and invokes a skill by name                                │
└───────────────────────────┬─────────────────────────────────┘
                            │ reads installed bundle
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  ~/.…/skills/<name>/                                        │
│    SKILL.md          ← instructions to the agent            │
│    references/       ← e.g. file-conventions.md (copy)      │
│    scripts/          ← optional helpers the agent may run   │
└───────────────────────────┬─────────────────────────────────┘
                            │ agent writes under target repo
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  <target-repo>/.agent-relay/{YMD}_{RUN_ID}/plan.md          │
│                   meta.md / history.log                     │
│                   implement-plan / report / review-*        │
└─────────────────────────────────────────────────────────────┘
```

Separately, **this** repo’s installer only copies bundles into those global
skill directories. It does not call agents, pick models, or watch `.agent-relay/`.

## Layers

| Layer | Location | Job |
| --- | --- | --- |
| Skill text | `skills/<name>/SKILL.md` | Tell an agent what to do; **record**, rarely enforce |
| Shared conventions | `docs/file-conventions.md` | Artifact names / id / per-run layout (copied into every bundle) |
| Helpers | `scripts/*.sh` (canonical) → `skills/*/scripts/` (copies) | Optional bash the agent runs (`resolve-run`, `task-claim`, `review-section`, …) |
| Installer | `bin/install.sh`, `uninstall.sh`, `verify.sh` | Copy / remove / check files under `$HOME` |
| Shared install logic | `lib/bootstrap.sh` | Download, checksum verify, `validate_targets_conf` (inlined into bin via `sync-bootstrap.sh`) |
| Manifest | `targets.conf` | Per-tool install roots; still `source`d after allowlist validation |
| Tests | `tests/*.sh` | Offline smoke of install + task helpers; not “did the agent obey the skill?” |

## Stage flow (expected usage)

1. **plan** → create run directory via `run-init.sh`, write `plan.md`  
2. **implement** → code + `implement-plan.md` / `implement-report.md` (or parallel dirs)  
3. **self-review** → upsert dated Self-Review section in review reports  
4. **cross-review** → upsert Cross-Review (skill asks for a different tool; nothing enforces it)

Nothing in this repo schedules that order. Skipping a stage is always possible.

## Sync gates (do not skip)

Two copy-vs-source checks keep installable bundles from silently diverging:

- `scripts/sync-references.sh` — `docs/file-conventions.md` and `scripts/<name>.sh` → skill bundle copies  
- `scripts/sync-bootstrap.sh` — `lib/bootstrap.sh` body → marked regions in `bin/*.sh`

CI runs both with `--check`.

## Explicit non-goals

- No message bus, orchestrator, or agent runtime  
- No cryptographic proof of which tool/model wrote a provenance line  
- No protection of overlapping source-file edits in parallel mode (only task **status** / report files)

For trust detail see [security.md](security.md). For install mechanics see
[installer.md](installer.md).
