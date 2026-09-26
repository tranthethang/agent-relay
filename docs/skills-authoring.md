# Skill authoring

How to edit or add bundles under `skills/`. Installed copies are what users
run; this repo’s `skills/` tree is the source.

## Bundle layout

```text
skills/<name>/
  SKILL.md              # required — front matter + instructions
  references/           # optional but every current skill ships file-conventions.md
    file-conventions.md # MUST match docs/file-conventions.md (sync script)
    *-template.md       # empty outlines for artifacts that skill writes
```

Bundles must **not** contain `scripts/`. Runtime helpers are the `atry` CLI
(`scripts/atry` + `scripts/runtime/`), installed under `~/.agent-relay/`.

Front matter (checked loosely by smoke after install):

```yaml
---
name: atry-example
description: Use when <concrete trigger condition>, not a summary of the workflow.
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
   user path/id → single `{YMD}-{id}-{slug}` folder → ask. Use `atry resolve`.  

4. **Project rules in the target repo** — typical precedence called out in
   implement skill: `AGENTS.md`, then tool-native rules, then `CLAUDE.md`-like
   files. Do not impose a foreign style guide.  
5. **Parallel mode** — if `implement-plan/` exists, require `atry` claim
   helpers for status/report writes; forbid hand-editing rollups; point at
   `atry check`. See [task-claim.md](task-claim.md).  
6. **Cross-review** — ask for a different tool/model than self-review.
   `atry review` may **warn** on matching provenance; it must not hard-fail
   the upsert (project philosophy). Both review skills share
   `reviewer-conduct.md` (escalate genuine tradeoffs; re-derive evidence
   before accepting claims). Self-review adds a broad-vision lens; cross-review
   uses inverted-question framing — see those `SKILL.md` files.  
7. **Call `atry`, not long absolute paths.** Skills should document short
   `atry …` commands so agents do not expand helper paths under each tool’s
   skill directory.
8. **`description:` states only the trigger, never the workflow.** Write it as
   "Use when …", naming the concrete conditions an agent should match against
   -- not a summary of what the skill does. Agents can take the description as
   a shortcut and skip the body; a description that already explains the
   workflow invites that skip. Put the "what it does" sentence(s) in a short
   `## Overview` right under the H1 instead, where they only get read once the
   skill is actually loaded.

## Sync workflow

| Source | Copy |
| --- | --- |
| `docs/file-conventions.md` | `skills/*/references/file-conventions.md` |
| `skills/atry-self-review/references/review-*-template.md` | `skills/atry-cross-review/references/review-*-template.md` (must stay byte-identical) |
| `skills/atry-self-review/references/reviewer-conduct.md` | `skills/atry-cross-review/references/reviewer-conduct.md` (must stay byte-identical) |

```bash
# after editing docs/file-conventions.md, review templates, or reviewer-conduct.md
bash scripts/maint/sync-references.sh
bash scripts/maint/sync-references.sh --check
```

Hand-editing only the copy under `skills/*/references/` will be overwritten or
fail CI `--check`. Runtime helpers: edit `scripts/runtime/` (and `scripts/atry`
if the dispatcher changes), then re-run `./bin/install.sh` to refresh
`~/.agent-relay`.

Empty artifact outlines live in each skill's `references/*-template.md`.
`SKILL.md` should tell the agent to read those files before writing the
matching runtime artifact. Review report/walkthrough templates and
`reviewer-conduct.md` are duplicated under `atry-self-review` and
`atry-cross-review`; edit the self-review copy and re-run sync so both stay
identical.

## Adding a skill

1. Create `skills/<name>/SKILL.md` with front matter.  
2. Add `references/` as needed; include `file-conventions.md` via sync.  
3. Document `atry` commands the agent should run.  
4. Extend `tests/smoke.sh` if the new skill should be installed in smoke.  
5. Document the stage in the root README table if it is part of the public
   flow.  

Then `./bin/install.sh` and `./bin/verify.sh`.
