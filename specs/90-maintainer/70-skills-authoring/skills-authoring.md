# Skill authoring

Each skill is `skills/<name>/SKILL.md` plus `references/`. Bundles do not
contain `scripts/`.

Front matter needs `name`, `description`, and `requires-atry`. All six skills share one `requires-atry` value. That value is not higher than the version the release workflow computes. A release does not bump `requires-atry`. A skill change that needs a newer CLI bumps it. The preflight
block between `<!-- BEGIN PREFLIGHT -->` and `<!-- END PREFLIGHT -->` is copied
from `specs/80-skills-integration/00-skill-bridge/preflight.md` by `npm run sync`.

Shared writing rules live in `specs/80-skills-integration/00-skill-bridge/writing.md`. The same command copies
them to `references/writing.md` for brainstorm, plan, implement, self-review,
and cross-review.

`references/file-conventions.md` is generated from `specs/70-storage-and-git/00-directory-conventions/`. Edit
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

## Token baseline

`npm run tokens` counts characters in each `SKILL.md` plus every
`references/*.md` path that file names. It divides by 4 and rounds to the
nearest integer. The total row is the sum of the stage rows. This baseline
is commit `ce19460998b550cb7ccca955bbb4cb1905bbef4d`.

| stage        | references                                            | chars | tokens |
| ------------ | ----------------------------------------------------- | ----: | -----: |
| brainstorm   | references/writing.md                                 |  5473 |   1368 |
| plan         | references/writing.md                                 |  5821 |   1455 |
| implement    | references/writing.md                                 |  6257 |   1564 |
| self-review  | references/writing.md, references/reviewer-conduct.md |  6710 |   1678 |
| cross-review | references/writing.md, references/reviewer-conduct.md |  7912 |   1978 |
| distill      | (none)                                                |  1393 |    348 |
| total        |                                                       | 33566 |   8391 |

## Token count after the skill rewrite

The same `npm run tokens` command, after preflight moved into the CLI and the stage skills loop on `atry next`.

| stage        | references                                            | chars | tokens |
| ------------ | ----------------------------------------------------- | ----: | -----: |
| brainstorm   | references/writing.md                                 |  5011 |   1253 |
| plan         | references/writing.md                                 |  5525 |   1381 |
| implement    | references/writing.md                                 |  5951 |   1488 |
| self-review  | references/writing.md, references/reviewer-conduct.md |  6840 |   1710 |
| cross-review | references/writing.md, references/reviewer-conduct.md |  7018 |   1755 |
| distill      | (none)                                                |   931 |    233 |
| total        |                                                       | 31276 |   7820 |
