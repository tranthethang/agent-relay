# Skill authoring

Each skill is `skills/<name>/SKILL.md` plus `references/`. Bundles do not
contain `scripts/`.

Front matter needs `name`, `description`, and `requires-atry`. The preflight
block between `<!-- BEGIN PREFLIGHT -->` and `<!-- END PREFLIGHT -->` is copied
from `docs/partials/preflight.md` by `scripts/maint/sync-references.sh`.

Shared writing rules live in `docs/partials/writing.md`. The same script copies
them to `references/writing.md` for brainstorm, plan, implement, self-review,
and cross-review.

`references/file-conventions.md` is generated from `docs/conventions/`. Edit
the parts, then run:

```bash
bash scripts/maint/sync-references.sh
bash scripts/maint/sync-references.sh --check
```

A new skill needs a `skill_parts` line in that script. The skill text calls
`atry` verbs. It does not tell the agent to run files under `scripts/`.

After you edit a skill, install it again with `npx skills add` if you dogfood
from a global skill directory.
