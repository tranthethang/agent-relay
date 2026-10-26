# Skill evals

The eval harness has three layers. The fake and real layers do not call a model.
The model-backed layer does, and it runs nightly, not on a push.

| Layer        | Command                         | What it proves                                                                | Runs in CI                        |
| ------------ | ------------------------------- | ----------------------------------------------------------------------------- | --------------------------------- |
| Fake         | `npm run evals -- --layer fake` | The recorded command surface, JSON shape, step count, and skill token budget. | Yes, on macOS, Linux, and Windows |
| Real         | `npm run evals -- --layer real` | The built CLI's exit codes, JSON fields, file contents, and git state.        | Yes, on macOS, Linux, and Windows |
| Model-backed | `npm run evals:model`           | A compliance rate: how often an agent's events match a trajectory.            | Nightly report, never a gate      |

`npm run evals` runs the fake layer and the real layer, in that order. A real
failure is never hidden behind a fake pass: the summary counts both layers and
the command exits 1 when either layer has a failure.

The real layer is the behavioral evidence for this repository. It does not prove
that a model reads a skill and makes the same decision. The model-backed layer
samples that decision. See below.

## Files

| Path             | Role                                                                          |
| ---------------- | ----------------------------------------------------------------------------- |
| `scenarios.json` | Fake collection. One entry for each run state to cover.                       |
| `fake-atry.ts`   | Stands in for `atry`. Prints the response of one step and records the call.   |
| `real.ts`        | Real scenarios. Creates temp repositories and drives `node dist/atry.js`.     |
| `run.ts`         | Single entry point. Runs the selected layers and prints one combined summary. |
| `model/`         | The model-backed layer: scenarios, fixtures, runners, matcher, and report.    |

## Run

```bash
npm run evals
npm run evals -- --list
npm run evals -- --layer fake
npm run evals -- --layer real
npm run evals -- --scenario out-of-scope-edit
npm run evals -- --scenario real-plan-gate
npm run evals -- --layer real --scenario real-plan-gate --drift
npm run evals -- --root . --scenarios evals/scenarios.json
```

With no arguments both layers run. `--scenario NAME` runs the layer that owns
the name. A name from `scenarios.json` selects the fake layer; a name from
`real.ts` selects the real layer. `--scenarios FILE` selects the fake layer.
`--layer all` forces both layers.

The real layer runs the build at `dist/atry.js`. Run `npm run build` first.
`npm run evals` does not build for you.

`run.ts` exits 0 when every selected scenario passes. It exits 1 when one fails
and prints `fail: <scenario>: <reason>` on stderr. It exits 2 on a usage error,
including a missing `dist/atry.js` or `--drift` without the real layer.

## Fake layer checks

1. **Command sequence.** Each step runs through the fake. The fake refuses an
   argv that differs from the recorded step. The skill bundle must also name
   the command, as `atry <verb>`, in `SKILL.md`. A verb that `next` or a preview
   `decision` hands out (`approve`, `close`, `review new`, `review done`,
   `stage start`, `stage done`, `task start`, `integrate`) is exempt. For those
   verbs the skill must hold the synced `<!-- BEGIN LOOP -->` block instead.
2. **JSON schema.** An object response must set `schema` to `1`. It must also
   hold the keys that its command returns, for example `next` needs `actions`
   and `command`.
3. **Step count.** The number of calls must equal the number of steps, and the
   count must not pass `maxSteps`.
4. **Token count.** `scripts/maint/skill-tokens.ts` must report fewer tokens
   than `maxTokens` for that skill. The default is 4,500.

## Real scenarios

| Scenario             | Behavior it covers                                                                  |
| -------------------- | ----------------------------------------------------------------------------------- |
| `real-plan-gate`     | An empty plan and an incomplete task file are refused; a filled plan is approved.   |
| `real-worktree-flow` | A dirty task worktree fails `task done`; a dirty `integrate` prints `merged: no`.   |
| `real-stale-skills`  | An edited installed bundle is stale until the next install; six `ok` rows after it. |
| `real-close-ack`     | A soft close needs `--ack-open`; a cross-review delta needs a later self-review.    |

Each real scenario creates a temporary git repository and a temporary `HOME`.
It runs `node dist/atry.js` with `ATRY_DEV=1` and deletes both directories in a
`finally` block. It never uses the network.

`--drift` flips one recorded expectation on purpose, so the real layer must fail.
The test suite uses it to show that a behavior drift is caught rather than only a
missing command.

## Model-backed layer

`npm run evals:model` drives `claude -p` and `codex exec` through four
scenarios. It is not part of `npm run evals`. It needs `npm run build` first.

| Scenario              | Fixture                      | Required events                                         | Forbidden            |
| --------------------- | ---------------------------- | ------------------------------------------------------- | -------------------- |
| `brainstorm-readonly` | clean repo                   | none                                                    | a run, a source edit |
| `plan-small`          | repo with one small file     | run created, plan started, plan completed               | plan approved        |
| `implement-approved`  | approved run with two tasks  | implement started, two `task-done`, implement completed | run closed           |
| `self-review`         | run with implement completed | self-review started, self-review completed              | run closed           |

Each run builds a temp git repo, installs the skills from this checkout with
`atry skills install --dir`, and puts a shim for `dist/atry.js` first on `PATH`.
The agent gets a 15 minute timeout. A timeout is a fail.

A trajectory is an ordered list of required `{ stage, action }` pairs plus a
list of forbidden pairs. A scenario passes when the required pairs appear in
`events.jsonl` in order as a subsequence, no forbidden pair appears, and the
scenario's file check holds. The report also gives matched over required pairs,
so a partial run shows progress. `*` matches any stage.

The rate per tool is passed scenarios divided by scenarios that ran. A tool with
no binary on `PATH` or an empty API key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`)
is `skipped`. A skipped row is not a pass and is left out of `ran`.

```bash
npm run build
npm run evals:model -- --tool claude-code --scenario plan-small --repeat 3 --out /tmp/model-report
```

The output is `report.json`, `report.md`, and each run's `events/<tool>/*.jsonl`.
The exit code is 0 when the harness ran, whatever the rate. Exit 2 is a usage
error or a missing `dist/atry.js`. The `Model evals` workflow runs it nightly at
`0 19 * * *` UTC and on `workflow_dispatch`. It is not in CI on push or pull request.

## Add a fake scenario

1. Add one object to `scenarios.json` under `scenarios`.
2. Set `name`, `skill`, and `summary`. Use the bundle name, such as
   `atry-implement`.
3. Add one object to `steps` for each CLI call that the skill issues, in order.
4. Set `argv` without the `atry` word. For example `["next", "<run>", "--json"]`.
5. Set `exit` to the exit code that the real CLI returns.
6. Set `stdout` to the JSON object or the text that the real CLI prints. Set
   `stderr` for an error.
7. Run `npm run evals -- --scenario <name>`.
8. Add the failure that the scenario covers to this file when it is new.

The fake uses a fixed command table. Add a verb to `commands` in
`fake-atry.ts` when the real CLI adds one, or a step will fail as a wrong
command.

## Add a real scenario

1. Add a `run` function and one `Scenario` entry to `scenarios` in `real.ts`.
2. Use the `check` helpers so a failure names the scenario and the step.
3. Drive the CLI with `cli(check, ctx, [...])`; use `git` and `write` for state.
4. Assert an exit code, a JSON field, a file, or the git tree.
5. Run `npm run build` and `npm run evals -- --scenario <name>`.
6. Update the table above.

## Limits

- The fake layer checks a recorded transcript. It proves the command surface and
  the token budget. It does not prove that the real CLI behaves the same way.
- The real layer runs the real build and catches exit-code, file, and git drift.
  It still does not prove that a model reads the skill or makes a decision.
- A step is data. Keep it equal to what the real CLI prints. A stale response
  passes the checks and teaches the wrong contract.
- The model-backed layer is a sample. A model is not deterministic, four
  scenarios are few, and a pass shows only that the recorded events matched the
  trajectory on that run. It does not prove a skill works in every case, and it
  does not gate a release.
- `npm test -- test/evals.test.ts` runs the fake layer, checks that a wrong
  command and a wrong schema fail, and checks that `--drift` fails the real
  layer.
