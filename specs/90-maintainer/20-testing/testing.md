# Testing

```bash
npm test
npm run check
npm run sync:check
```

`npm test` builds `dist/atry.js` and runs vitest. CLI tests spawn that binary.
They do not call the `atry` on `PATH`.

End-to-end tests live in `test/e2e-sequential.test.ts` and
`test/e2e-parallel.test.ts`. They drive `run new` through `close`, and a
two-session claim with an overlap refusal. CI runs the same `npm test` on
macOS, Linux, and Windows.

`test/skills-install.test.ts` runs `npx skills@1.7.2 add <repo> -g --copy` with a
temporary `HOME`. It needs network access the first time `npx` fetches
`skills`.

`npm run check` runs dprint and `tsc --noEmit`. `tsconfig.json` sets
`noUnusedLocals` and `noUnusedParameters`, so an unused import fails the check.
CI does the same. CI does not
prove that an agent follows a skill.

`.githooks/pre-commit` runs `npm run build`. When that exits zero, it runs
`npm run coverage:report`. When that exits zero, it runs `dprint check`. The hook
exits non-zero when one command exits non-zero. Enable it with
`git config core.hooksPath .githooks`. The hook does not call Sonar.

`npm run coverage:report` applies three bars to `src/**` and `scripts/maint/**`:
overall lines plus branches at least 95%, each file's lines plus branches above
90%, and each file's branches at least 90%. A file at exactly 90% branches passes.
A file with no branches passes. `npm run coverage:sonar` then checks duplicated
lines density. The density must be at most 1%. That command needs `sonar-scanner`
on `PATH`, plus `SONAR_HOST_URL` and `SONAR_TOKEN`. Linux CI runs the report.

## Skill evals

`npm run evals` runs two layers and prints one combined summary.

The fake layer replays `evals/scenarios.json` through `evals/fake-atry.ts`. It
checks the command surface, the JSON shape, the step count, and each skill's
token budget. It does not use a model and does not use the network. A fake pass
is not behavioral evidence.

The real layer is the behavioral check and the release evidence. It drives
`node dist/atry.js` through `evals/real.ts`. It creates a temporary git
repository and a temporary `HOME`, then asserts exit codes, JSON fields, file
contents, and git state. It covers the plan gate, the worktree commit rule,
stale installed skills, and close acknowledgement. It also does not use a
model or the network. Build first with `npm run build`, because the layer runs
the built CLI. The release evidence checklist is in
[`../30-release/release.md`](../30-release/release.md).

CI runs both layers on macOS, Linux, and Windows after `npm test`. A real
failure is not hidden behind a fake pass: the command exits 1 and the summary
counts both layers. `--drift` flips one recorded real expectation so the layer
must fail; the test suite uses it to show that behavior drift is caught. See
[`evals/README.md`](../../../evals/README.md) for the files, the options, and
the steps to add a scenario.

The model-backed layer is `npm run evals:model`. It is not part of
`npm run evals`. It drives `claude -p` and `codex exec` through four scenarios
(`brainstorm-readonly`, `plan-small`, `implement-approved`, `self-review`) and
matches each run's `events.jsonl` against a trajectory. It reports a compliance
rate per tool. It is a sample, not proof that a skill works in every case, and
it never gates a release.

The `Model evals` workflow runs it on `ubuntu-latest` at `0 19 * * *` UTC and on
`workflow_dispatch`. It does not run on push, pull request, or a fork. It reads
two repository secrets, `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`, in the eval
step only. A tool with a missing binary or key is `skipped`, not a pass. The
workflow writes the table to the job summary and uploads `report.json` and each
`events.jsonl` as an artifact.

To run it with one tool on a developer machine:

```bash
npm run build
ANTHROPIC_API_KEY=... npm run evals:model -- --tool claude-code --out /tmp/model-report
```

`codex` is not installed on every machine. Without it, or without its key, the
local run reports `codex` as `skipped`. See
[`evals/README.md`](../../../evals/README.md) for the scenarios and the match rule.

The eval layers do not replace `test/skills-*.test.ts`. A skill test checks
text, such as a heading or a shared reference. The fake eval checks a recorded
command sequence and the token budget. The real eval checks what the built CLI
does to a temporary repository. None of them proves that an agent followed a
skill.
