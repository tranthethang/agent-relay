# Skill authoring

How to edit or add bundles under `skills/`. Installed copies are what users
run; this repo’s `skills/` tree is the source.

## Bundle layout

```text
skills/<name>/
  SKILL.md              # required — front matter + instructions
  references/           # optional but every current skill ships file-conventions.md
    file-conventions.md # MUST match docs/file-conventions.md (sync script)
  scripts/              # optional — copies of repo scripts/<same-name>.sh
```

Front matter (checked loosely by smoke after install):

```yaml
---
name: atry-example
description: One or two sentences; tools use this for discovery.
---
```

`name:` should match the directory name tools expect.

## Authoring rules

1. **Instructions, not a runtime.** The agent may ignore you. Prefer clear
   steps and explicit “do not invent” / “ask if unsure” over pretending the
   filesystem will enforce behavior.  
2. **Provenance is a record.** Use the HTML comment form with real
   `tool=` / `model=` when known, else `unknown`. Do not invent. Date via
   `date +%F`.  
3. **Id resolution** — follow [file-conventions.md](file-conventions.md):
   user path/id → `CURRENT` → single `plan-*.md` → ask. Write `CURRENT` only
   when **creating** a new id.  
4. **Project rules in the target repo** — typical precedence called out in
   implement skill: `AGENTS.md`, then tool-native rules, then `CLAUDE.md`-like
   files. Do not impose a foreign style guide.  
5. **Parallel mode** — if `implement-plan-<id>/` exists, require
   `task-claim.sh` for status/report writes; forbid hand-editing rollups; point
   at `check`. See [task-claim.md](task-claim.md).  
6. **Cross-review** — ask for a different tool/model than self-review.
   `review-section.sh` may **warn** on matching provenance; it must not hard-
   fail the upsert (project philosophy).  

## Sync workflow

| Source | Copy |
| --- | --- |
| `docs/file-conventions.md` | `skills/*/references/file-conventions.md` |
| `scripts/<file>.sh` | `skills/<skill>/scripts/<file>.sh` (only if the bundle lists that script) |

```bash
# after editing docs/file-conventions.md or scripts/*.sh
bash scripts/sync-references.sh
bash scripts/sync-references.sh --check
```

Hand-editing only the copy under `skills/*/references/` or `skills/*/scripts/`
will be overwritten or fail CI `--check`. Add a new helper by placing it in
`scripts/` first, then copying into the skill(s) that need it (or extend the
sync script’s expectations by adding the file under the bundle and syncing).

Skills with **no** `scripts/` (e.g. `atry-plan`) are fine; sync skips empty
script dirs (bash 3.2 + `set -u` safe).

## Adding a skill

1. Create `skills/<name>/SKILL.md` with valid front matter.  
2. Add `references/file-conventions.md` via `sync-references.sh`.  
3. Add any `scripts/` needed; keep them byte-identical to `scripts/`.  
4. Re-run `./bin/install.sh` (or `--skill <name>`) to dogfood.  
5. Extend smoke if the skill should appear in default install expectations.  
6. Mention it in the root README stages table if it is part of the public flow.  

## Dogfooding

Install from the clone overwrites user skill dirs for selected tools. Use
`--only` / `--skill` to limit blast radius. `--no-clobber` skips existing
destinations (useful when you do not want to clobber local edits in `~`).

## Anti-patterns

- Promising “enforcement” in skill text when only a script warning or nothing
  exists  
- Duplicating long convention text inside `SKILL.md` instead of pointing at
  `references/file-conventions.md`  
- Committing divergent bundle script copies without updating `scripts/`  
