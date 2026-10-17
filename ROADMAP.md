# Roadmap

## History

### v1 bash

The first product was markdown skill bundles plus a bash `atry` CLI. An installer copied skills into Cursor, Antigravity, Claude, Codex, and Kiro. Each run lived under `.agent-relay/{YMD}-{id}-{slug}/` with `meta.md` and `history.log`.

The bash CLI added flattened verbs for resolve, history, review, and parallel task claims. A later cut added a human cockpit: `status`, `approve`, `stamp`, `decide`, and `close`. Those commands recorded a choice. They did not enforce it. Calendar versions `YY.M.D` replaced the earlier SemVer tags (`v0.1.0` through `v4.0.0`).

The same line added a knowledge bank, typed distill notes, and run metrics, then removed them. Distill became a manifest export, not a lifecycle stage. Legacy run layouts and the migration scripts were deleted. Shared writing rules and a plan size note landed in skill text.

### v2 TypeScript

P1 through P11 replace the bash CLI with a TypeScript package, `@tranthethang/agent-relay`. State is `events.jsonl` plus a `run.json` cache. Skills install with `npx skills add`. The person still opens each stage.

| Run | Slug                       | What landed                                          |
| --- | -------------------------- | ---------------------------------------------------- |
| P1  | `next-ts-scaffold`         | TypeScript CLI and the `version` command             |
| P2  | `next-core-schemas`        | Vocabulary, schemas, and errors                      |
| P3  | `next-state-cli-base`      | `resolve`, `status`, and `context`                   |
| P4  | `next-run-lifecycle`       | Run, brainstorm, approve, and close                  |
| P5  | `next-plan-tasks`          | Plan scaffold and task status                        |
| P6  | `next-parallel-claim`      | Claim, release, and steal                            |
| P7  | `next-review-distill`      | Review scaffold and distill manifest                 |
| P8  | `next-skills-rewrite`      | Skill text for the TypeScript CLI                    |
| P9  | `next-integration-cutover` | Sequential and parallel end-to-end tests             |
| P10 | `next-cli-hardening`       | Lock, plan, and usage fixes from review              |
| P11 | `next-release-readiness`   | Docs, npm-only tree, and the `NPM_TOKEN` publish job |

P12 `next-version-scheme` changes the version scheme and publishes.

## Limits and next

The README lists the current limits. Cross-review in the same tool is a warning. `claim` checks the paths recorded on the task. v1 run directories are not read.

P11 removed the bash script, the pnpm files, and the shfmt step, and extended the parallel end-to-end test to `close`. v2 uses `X.M.Z` from the first release. P12 published `0.10.1` by hand, then moved the release workflow to npm trusted publishing (OIDC).
