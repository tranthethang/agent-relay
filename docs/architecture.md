# Architecture

Short map of agent-relay for maintainers. This is descriptive of the current
tree, not a roadmap.

## What runs where

```text
┌─────────────────────────────────────────────────────────────┐
│  Human opens Cursor / Claude / Codex / Antigravity / Kiro   │
│  and invokes a skill by name                                │
└───────────────────────────┬─────────────────────────────────┘
                            │ reads installed bundle
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  ~/.…/skills/<name>/                                        │
│    SKILL.md          ← instructions to the agent            │
│    references/       ← e.g. file-conventions.md (copy)      │
└───────────────────────────┬─────────────────────────────────┘
                            │ agent runs `atry …` (PATH)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  ~/.agent-relay/bin/atry + lib/*.sh                         │
└───────────────────────────┬─────────────────────────────────┘
                            │ agent writes under target repo
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  <target-repo>/.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/      │
│                   plan.md / meta.md / history.log           │
│                   implement-plan / report / review-*        │
└─────────────────────────────────────────────────────────────┘
```

Separately, **this** repo’s installer copies bundles into those global skill
directories and installs the `atry` CLI under `~/.agent-relay/`. It does not
call agents, pick models, or watch project `.agent-relay/` run dirs.

## Layers

| Layer | Location | Job |
| --- | --- | --- |
| Skill text | `skills/<name>/SKILL.md` | Tell an agent what to do; **record**, rarely enforce |
| Shared conventions | `docs/file-conventions.md` | Artifact names / id / per-run layout (copied into every bundle) |
| Helpers | `scripts/atry` + `scripts/runtime/` → `~/.agent-relay/` | Bash the agent runs (`atry resolve`, `atry claim`, `atry review`, …) |
| Maintainer scripts | `scripts/maint/` | Sync / release only (not installed for agents) |
| Installer | `bin/install.sh`, `uninstall.sh`, `verify.sh` | Copy / remove / check files under `$HOME` (+ atry home) |
| Shared install logic | `lib/bootstrap.sh` | Download, checksum verify, `validate_targets_conf` (inlined into bin via `sync-bootstrap.sh`) |
| Manifest | `targets.conf` | Per-tool install roots; still `source`d after allowlist validation |
| Tests | `tests/*.sh` | Offline smoke of install + task helpers; not “did the agent obey the skill?” |

## Stage flow (expected usage)

1. **plan** → create run directory via `atry run-init`, write `plan.md`  
2. **implement** → code + `implement-plan.md` / `implement-report.md` (or parallel dirs)  
3. **self-review** → upsert dated Self-Review section; broad-vision analysis;
   escalate tradeoffs per `reviewer-conduct.md`  
4. **cross-review** → upsert Cross-Review with inverted-question framing
   (skill asks for a different tool; nothing enforces it)  
5. **distill** → summarize reusable patterns/lessons into `distillation.md`;
   optionally push the full distillation note to an external knowledge bank
   (e.g., Obsidian vault) via `atry bank push`

Nothing in this repo schedules that order. Skipping a stage is always possible.

## Sync gates (do not skip)

Two copy-vs-source checks keep installable bundles from silently diverging:

- `scripts/maint/sync-references.sh` — `docs/file-conventions.md` → skill
  bundle copies; also keeps review `*-template.md` and `reviewer-conduct.md`
  byte-identical between `atry-self-review` and `atry-cross-review`; refuses
  orphan `skills/*/scripts/`
- `scripts/maint/sync-bootstrap.sh` — `lib/bootstrap.sh` body → marked regions in `bin/*.sh`

CI runs both with `--check`.

## Explicit non-goals

- No message bus, orchestrator, or agent runtime  
- No cryptographic proof of which tool/model wrote a provenance line  
- No protection of overlapping source-file edits in parallel mode (only task **status** / report files)  
- No automatic prompt enrichment from the knowledge bank (bank is an external, write-only sink in this MVP)

For trust detail see [security.md](security.md). For install mechanics see
[installer.md](installer.md).
