# Command reference

Every `atry` verb with its flags, then the behavior notes that apply to
several verbs. Module and flag mapping per command is in
[`command-routing.md`](../00-router-and-options/command-routing.md).

## Verbs

Text is the default. `--json` adds `"schema": 1`.

```bash
atry version
atry preflight --requires ">=X.Y.Z" [--allow-dev]
atry doctor
atry resolve [run]
atry status [run]
atry next <run>
atry stats [run] [--since <ISO date>] [--failed]
atry context <run> --json [--task T1]
atry brainstorm new --slug <slug>
atry brainstorm done <dir>
atry run new --slug <slug> --title <title> [--from <brainstorm>]
atry plan new <run>
atry plan done <run>
atry plan amend <run>
atry approve <run> --via confirm|arg
atry approve <run> --preview
atry stage start <run> implement --tool <tool> [--model <model>]
atry stage done <run> implement --tool <tool> [--model <model>] [--allow-extra "<reason>"]
atry task start <run> T1
atry task done <run> T1 [--session <tag>] [--allow-extra "<reason>"]
atry task skip <run> T1 --reason "<text>" [--session <tag>]
atry claim <run> T1 --session <tag>
atry release <run> T1 --session <tag> [--force --reason "<text>"]
atry steal <run> T1 --session <tag> --ttl <minutes>
atry integrate <run> T1
atry guard <run> <path> [--session <tag>]
atry list <run>
atry review new <run> self --tool <tool> [--model <model>]
atry review new <run> cross --tool <tool> --model <model>
atry review done <run> self|cross [--run-tests]
atry review decide <run> Q<n> <answer>
atry close <run> --preview
atry close <run> --via confirm|arg [--ack-open] [--ack-fixes] [--ack-warnings]
atry close <run> --waive-review "<reason>" [--ack-open] [--ack-warnings]
atry close <run> --abandon "<reason>"
atry policy init [--preset lenient|standard|strict]
atry policy check
atry skills install --tool <tool> [--dir <path>]
atry skills status [--tool <tool>] [--dir <path>] [--all]
atry worktree cleanup [run]
atry hook install --tool claude-code
atry hook check
atry distill <run> [--include-test-logs]
atry distill verify <run>
```

## Behavior notes

### Coordinator verbs and preflight

`atry approve` and `atry close` are for the person who coordinates the run.
`atry preflight --requires ">=X.Y.Z"` exits 0 when the installed version meets that range.
A lower version prints the exact install command for that range, such as
`npm i -g @tranthethang/agent-relay@X.Y.Z`, and exits 1.
A dev build is refused the same way. Add `--allow-dev`, or set `ATRY_DEV=1`,
only when you dogfood a build from this repo.

### Stats and doctor

`atry stats` reads `events.jsonl` across runs. `atry stats <run>` reads one run.
A row reports stage time, review rounds, waivers, failed tests, drift, and findings.
The text row ends with `findings=<total> high-open=<n> fixed=<n>`. The JSON row ends with
`findings: { high, medium, low, open, fixed, rejected, highOpen }`, summed over every review of the run.
A review with no `findings` counts as zero.
Stage time is a number of milliseconds. The command does not write an event.
`--since <ISO date>` keeps a run with at least one event at or after the date.
`--failed` keeps a run with at least one failed test. Both filters combine, and
they apply to a single run too. An invalid date exits 2. The JSON keeps
`schema: 1` and adds no filter field.
`atry doctor` checks Node 22, git, the CLI version, the bundled skills, the
installed bundles, the policy file, `atry` on `PATH`, and the version that
`PATH` reports. It prints one line per check. It exits 1 when a check fails,
when an installed bundle is stale, or when `PATH` runs a different base version
from the running CLI.
A missing policy file passes and reports `default`.

`atry status <run>` ends with `findings: <open> open, <highOpen> high open`, counted from
the latest review of each kind. The JSON detail adds `findings: { open, highOpen }`.

### Next and previews

`atry next <run>` prints the next command. `--json` adds `command`, `reason`, `needsHuman`, and `read`.
Before approval, `next` follows the plan files: `plan new` when the overview or
task input is missing, `plan done` when `10-plan/index.json` is missing,
`approve --preview` when a task file lacks Detail or Acceptance, and `approve`
when the plan is complete.
`atry approve <run> --preview` prints Goal, Non-goals, Constraints, Decisions,
each task file, and `ready: yes` or `ready: no` with the missing items.
`atry close <run> --preview` prints `recommend: y` or `recommend: n` and the reasons.
Each preview then prints `question: <question>` and `on yes: <command or none>`.
With `--json`, each preview adds `decision`: `{ question: string, onYes: string | null,
onYesArg: string | null, onNo: null }`. `onYes` is the command with `--via confirm`,
and `onYesArg` is the same command with `--via arg`. Both are `null` when the run
must not go on, and `question` says why.
Neither preview records an event.
In `next --json`, an action adds `question` (string, only when `needsHuman` is true).
Its `approve` and `close` commands end in `--preview`. `stage start`, `stage done`, and
`review new` carry `--tool <tool>`. A cross-review start also carries `--model <model>`.
A `review-done` action adds `--run-tests` and sets `needsHuman` when the base policy
sets `testCommand`.

### Plan and approval gates

`atry approve` refuses a plan with no `10-plan/index.json`, zero tasks, or an
empty Detail or Acceptance section. `atry plan done` and `atry plan amend`
refuse zero tasks. A `plan amend` after approval returns the run to `planned`,
so it needs approval again.
The skills ask before they run those verbs. Implement start refuses when the
plan is not approved or is no longer complete. Close checks the required
reviews for its policy, the latest completed review tree against the current
code tree, open questions, and changes made during the latest review.

### Close gates

With `strict.reviewIntegrity` false (the default) and `--via` set, `close`
treats the review checks as warnings. It lists each warning and refuses until
you add `--ack-warnings`. `--ack-warnings` accepts warnings only: it closes
and records them in the `closed` event, and it changes nothing else. The review
skills pass `--via` and ask the user before they add `--ack-warnings`. Without
`--via`, or with `strict.reviewIntegrity` true, `close` refuses until each
check passes; `--ack-warnings` does not change that. `--ack-open` accepts an
open question. Open questions are a gate in every close, so `--ack-warnings`
does not accept them. `--ack-fixes` applies to a strict close with changes made
during the latest review. In a soft close, `--ack-warnings` accepts that delta,
and `--ack-fixes` does not replace `--ack-warnings`. When a cross-review
records a delta, close needs a self-review completed after it. `--ack-warnings`
does not skip that self-review.
`--waive-review <reason>` records a review waiver
and skips the required-review and tree checks. It does not skip the
open-question check, the cross-delta rule, or the warning gate.
`close` refuses with exit 4 while the latest review of a required kind has an open `high`
finding. The preview lists `open high finding: <kind> <id>` and recommends `n`.
No ack flag and no waiver passes that gate. `--abandon` does.
`atry close --abandon <reason>` stops a run from any open state.

### Distill and verify

`atry distill <run>` writes `90-distill/manifest.json` with a run header, a label on each file, and an `atEvent` anchor.
`atry distill verify <run>` reports a manifest that is older than the event log as `stale: yes` with `new events: <n>`.
It lists `events.jsonl` and `run.json` as `stale: <path>`, not as `mismatched`, and exits 1.
The `--json` result adds `stale` and `newEvents` and keeps `schema` 1.
See `specs/70-storage-and-git/30-distill-manifest/manifest-export.md`.
