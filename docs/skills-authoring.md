# Skill authoring

Each skill is `skills/<name>/SKILL.md` plus `references/`. Bundles do not
contain `scripts/`.

Front matter needs `name`, `description`, and `requires-atry`. All six skills share one `requires-atry` value. That value is not higher than the version the release workflow computes. A release does not bump `requires-atry`. A skill change that needs a newer CLI bumps it. The preflight
block between `<!-- BEGIN PREFLIGHT -->` and `<!-- END PREFLIGHT -->` is copied
from `docs/partials/preflight.md` by `npm run sync`.

Shared writing rules live in `docs/partials/writing.md`. The same command copies
them to `references/writing.md` for brainstorm, plan, implement, self-review,
and cross-review.

`references/file-conventions.md` is generated from `docs/conventions/`. Edit
the parts, then run:

```bash
npm run sync
npm run sync:check
```

A new skill needs a `SKILL_PARTS` entry in `scripts/maint/sync-references.ts`.
The skill text calls `atry` verbs. It does not tell the agent to run files under
`scripts/`.

After you edit a skill, install it again with `npx skills add` if you dogfood
from a global skill directory.
