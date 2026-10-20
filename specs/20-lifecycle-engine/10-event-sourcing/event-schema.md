# Event Schema

`events.jsonl` is the source of truth for one run. Each line is one JSON object. `src/core/event.ts` parses it with `eventLineSchema`.

## Envelope

Every line has `schema` (`1`), `ts` (UTC timestamp, such as `2026-10-19T06:00:00.000Z`), `stage`, and `action`.

`stage` is one of `brainstorm`, `plan`, `implement`, `self-review`, `cross-review`, `distill`, or `run`.

`action` is one of `created`, `started`, `completed`, `decided`, `approved`, `closed`, `waived`, `abandoned`, `task-started`, `task-done`, `task-skipped`, `claimed`, `released`, `stolen`, `rebased`, `cleaned`, or `drifted`.

Optional fields, when the command records them:

| Field                       | Use                                                             |
| --------------------------- | --------------------------------------------------------------- |
| `tool`, `detected`, `model` | Declared tool, detected tool, and model id.                     |
| `actor`                     | `agent-env` or `unknown`.                                       |
| `via`                       | `confirm` or `arg`.                                             |
| `head`, `tree`              | Git commit and working-tree hash (40 or 64 hex characters).     |
| `size`, `delta`             | `{ files, added, deleted }` counts.                             |
| `tests`                     | `not-configured`, or `{ exit, ms, tree }`.                      |
| `task`, `session`           | Task id (`T1`, `T2`, ...) and claim session.                    |
| `reason`, `extra`           | Skip, waive, abandon, or allow-extra text, and the extra paths. |
| `question`, `answer`, `ref` | A decision and the review file it answers.                      |
| `prev`                      | sha256 hex of the previous raw line.                            |

## Hash chain

`appendChained` in `src/core/cache.ts` writes every event after the first. It sets `prev` to the sha256 hex of the previous raw line, after CRLF becomes LF. `run new` writes the `created` line without `prev`.

`rebuildRun` checks the chain on each read:

- Lines before the first line with `prev` are valid without it. Runs from before the chain still load.
- After that line, a line without `prev` fails with `prev is missing` at `events.jsonl:lines[n].prev`.
- A `prev` that does not match the previous raw line fails with `prev does not match the previous line`. A `prev` on line 0 fails the same way.

The chain makes a plain edit, insert, or delete evident. It is not a signature. A writer who recomputes each hash, or who removes every `prev`, is not detected.

There is no `event` type field. The pair `stage` + `action` names the record.

`run` `rebased` records that `stage start implement` moved `base` to `HEAD` on a run without a worktree. Its `ref` is the new base commit. It does not change lifecycle, stage, or tasks.

`run` `drifted` records that `rebuildRun` found a `run.json` state that differs from the replay of `events.jsonl`. `rebuildRun` appends it under the run lock before it writes the rebuilt cache. It does not change lifecycle, stage, or tasks. `atry status` reports the count as `drift`, and `atry close --preview` lists it as a reason.
