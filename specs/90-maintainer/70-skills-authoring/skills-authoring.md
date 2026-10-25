# Skill authoring

Each skill is `skills/<name>/SKILL.md` plus `references/`. Bundles do not
contain `scripts/`.

Front matter needs `name`, `description`, and `requires-atry`. Each
`description` is 200 to 400 characters. Say what the skill does, when to use
it, and when not to use it. Include a `Do not use` clause. Name `atry` or
`agent-relay`. Do not use the skill name as the only trigger. All six skills share one `requires-atry` value. That value is not higher than the version the release workflow computes. A release does not bump `requires-atry`. A skill change that needs a newer CLI bumps it. The preflight
block between `<!-- BEGIN PREFLIGHT -->` and `<!-- END PREFLIGHT -->` is copied
from `specs/80-skills-integration/00-skill-bridge/preflight.md` by `npm run sync`.

## When to bump the shared minimum

The value lives in `scripts/maint/next-version.ts` as `skillMinimumVersion`, and
`skillMinimumRange` is the `>=X.M.Z` range that follows from it. Tests read both,
so the value is not repeated as a source of truth. Change it only when a skill
starts naming a verb, flag, or file shape that the installed CLI does not have.
Set it to the next release that ships that behavior, then update all six
`SKILL.md` files to the same range. A release alone never bumps it. The verb
test (`test/skills-verbs.test.ts`) fails when a skill names a command the built
CLI does not know.

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

## Examples

Each stage skill that fills a file names one example under `references/`.
The agent reads the example before it writes that file.

| Skill               | Example                              | Shows                                                   |
| ------------------- | ------------------------------------ | ------------------------------------------------------- |
| `atry-plan`         | `references/example-overview.md`     | The overview headings and one `tasks.input.json` object |
| `atry-implement`    | `references/example-implement.md`    | The task report headings                                |
| `atry-self-review`  | `references/example-review.md`       | One review pair with one card and one `open` item       |
| `atry-cross-review` | `references/example-cross-review.md` | One review pair with one card and one `open` item       |

Keep one example under 500 tokens. Keep the example small: one task and one
small change. Use the writing rules, and use no secret and no real user data.
The example shows the headings that the skill asks for, so the agent sees the
quality bar and not only prose.

An example counts toward the stage token budget. `npm run tokens` must stay
under 4,500 tokens for each stage. `evals/scenarios.json` sets `maxTokens` to
4500, and the eval fails at that number. A new example can push a review stage
over that line, so check the count after you add one.

`test/skills-examples.test.ts` checks that each skill names its example, that
the file exists, that the headings are present, and that a review example has
one card and one `open` item.

## Token snapshot

`npm run tokens` counts characters in each `SKILL.md` plus every
`references/*.md` path that file names. It divides by 4 and rounds to the
nearest integer. The total row is the sum of the stage rows.

The table below is a snapshot. The command is the source. Run the command
after you edit a skill, and replace the rows with its output.

| stage        | references                                                                                                                                                | chars | tokens |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----: | -----: |
| brainstorm   | references/writing.md, references/file-conventions.md                                                                                                     |  8648 |   2162 |
| plan         | references/writing.md, references/file-conventions.md, references/example-overview.md                                                                     | 10887 |   2722 |
| implement    | references/writing.md, references/file-conventions.md, references/example-implement.md                                                                    | 13799 |   3450 |
| self-review  | references/writing.md, references/reviewer-conduct.md, references/review-checklist.md, references/file-conventions.md, references/example-review.md       | 17699 |   4425 |
| cross-review | references/writing.md, references/reviewer-conduct.md, references/review-checklist.md, references/file-conventions.md, references/example-cross-review.md | 17724 |   4431 |
| distill      | references/file-conventions.md                                                                                                                            |  4987 |   1247 |
| total        |                                                                                                                                                           | 73744 |  18437 |

`test/skill-tokens.test.ts` reads `maxTokens` from `evals/scenarios.json`. It
fails when a stage reaches `maxTokens` minus 50. It also fails when the total
row does not equal the sum of the stage rows.
