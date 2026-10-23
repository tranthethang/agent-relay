# Skill evals

The eval harness shows what a stage skill does for a given run state. It has
two layers.

| Layer         | Command         | Runs in CI                        | Uses a model |
| ------------- | --------------- | --------------------------------- | ------------ |
| Deterministic | `npm run evals` | Yes, on macOS, Linux, and Windows | No           |
| Model-backed  | by hand         | No                                | Yes          |

The deterministic layer is the one this folder holds. The model-backed layer
runs the same scenarios by hand and compares the commands that the agent
issues with the recorded steps.

## Files

| Path             | Role                                                                        |
| ---------------- | --------------------------------------------------------------------------- |
| `scenarios.json` | The collection. One entry for each run state to cover.                      |
| `fake-atry.ts`   | Stands in for `atry`. Prints the response of one step and records the call. |
| `run.ts`         | Drives each scenario and checks the four rules.                             |

## Run

```bash
npm run evals
npm run evals -- --list
npm run evals -- --scenario out-of-scope-edit
npm run evals -- --root . --scenarios evals/scenarios.json
```

`run.ts` exits 0 when every scenario passes. It exits 1 when one fails and
prints `fail: <scenario>: step <n>: <reason>` on stderr. It exits 2 on a usage
error.

## The four checks

1. **Command sequence.** Each step runs through the fake. The fake refuses an
   argv that differs from the recorded step. The skill bundle must also name
   the command, as `atry <verb>`, in `SKILL.md`.
2. **JSON schema.** An object response must set `schema` to `1`. It must also
   hold the keys that its command returns, for example `next` needs `actions`
   and `command`.
3. **Step count.** The number of calls must equal the number of steps, and the
   count must not pass `maxSteps`.
4. **Token count.** `scripts/maint/skill-tokens.ts` must report fewer tokens
   than `maxTokens` for that skill. The default is 4,500.

## Add a scenario

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

## Limits

- The harness checks a recorded transcript. It does not prove that a model
  reads the skill and makes the same decision.
- A step is data. Keep it equal to what the real CLI prints. A stale response
  passes the checks and teaches the wrong contract.
- The harness does not use the network and does not call a model.
- `npm test -- test/evals.test.ts` runs the harness and checks that a wrong
  command fails.
