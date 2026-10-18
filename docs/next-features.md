# Next features

This note records the gaps found in a review of the v2 tree (October 2026)
and the intent behind each fix. It is a design note, not a plan. Each plan
that takes an item cites the item id, such as `N1`.

## Phase constraints

- The repo changes fast. Code, fixes, and refactors land every day.
- The author is the only user.
- Do not write migration or backward compatibility for run data. A schema
  change may break old runs. Delete `.agent-relay/` and start again.
- Do not add code that handles old or malformed run layouts.

## Decisions

Settled on 2026-10-18:

- Old review JSON and event shapes are not read. A schema change breaks old
  runs (Q1a).
- Policy is a committed `.agent-relay.json` at the repo root. `atry` reads it
  from the run `base` (Q2a).
- Default `requireReviews` is `["self", "cross"]`. A change below
  `smallChange` lines (added plus deleted) needs only `self` (Q3b).
- An edit outside a task's `files` refuses `task done` unless
  `--allow-extra <reason>` is set (Q4b).
- Event `seq` and the hash chain are deferred. The run lock fixes the race.
  `seq` would touch every test fixture for little gain in a one-user phase.

## Principle

Data in a run has three trust levels:

| Level | Example                                                | Trust |
| ----- | ------------------------------------------------------ | ----- |
| 1     | `atry` measures it: `base`, `size`, event order, tests | High  |
| 2     | Agent fills JSON: `fixed`, `open`, `tool`, `model`     | Low   |
| 3     | Skill prose only: "edit only listed files"             | None  |

Some gates still read level 2 or level 3 data. The rule for new work:

- When `atry` can measure a value, `atry` measures it. The agent does not
  report it.
- When a step needs a person, the tool's own approval prompt decides. An
  agent claim does not.

## N1. Review gate is not bound to the code — done in P13

Problem:

- `close` passes when no review exists. `latestReview` returns `null` and
  `assertNoOpenQuestions` returns early.
- `nextStep` suggests self, then cross, then close. The gate does not
  enforce that order.
- `diffSize` ignores `head` (`void head`). It measures base to the working
  tree. With uncommitted work, `head` equals `base` and does not name the
  reviewed content.
- `close` does not compare the current code with the reviewed code.
- The cross-review skill tells the reviewer to fix bugs before
  `review done`. Nobody reviews those fixes.

Intent: a closed run means that this exact code was reviewed.

Implemented in P13:

- Compute a tree hash of the working tree without `.agent-relay/`. Copy the
  index. Update tracked files except `.agent-relay`. Add untracked files that
  Git does not ignore. Then run `git write-tree`.
- Record `tree` on `implement completed`, `review started`, and
  `review completed`.
- When the tree at `review done` differs from the tree at `review new`,
  record `delta` (files, added, deleted). Show it in `status`.
- `close` requires the reviews that policy names, a latest review tree equal
  to the current tree, and no reviewer delta unless `--ack-fixes` is set.
- `close --waive-review <reason>` records a waiver event. `status` shows the
  waiver state.
- Policy lives in a committed file at the repo root, read from `base`.
  Example: `{ "requireReviews": ["self"], "smallChange": 20 }`.

## N2. Agent-reported data can bypass gates — done in P14

Problem:

- Review JSON previously supplied tool, model, and test results without
  checks against measured events.
- Open-question checks previously trusted only JSON and ignored Markdown.

Intent: gates read measured data.

Implemented:

1. Lock provenance at `review new`. `review done` refuses when the JSON
   `tool` or `model` differs from the started event.
2. Require `--model` for cross-review.
3. Record a `detected` tool from environment markers next to the declared
   tool. Warn on mismatch.
4. Check diversity at two levels: same vendor warns, and the same model line
   adds a separate warning. The vendor map lives in `model.ts`.
5. Add `testCommand` to policy, read from `base`. `review done` runs it and
   records exit code, duration, and tree. The result leaves review JSON.
6. Count `- Q<n>:` lines at column 0 in the review Markdown. Compare the
   count with `open.length` and refuse a mismatch.
7. Add `atry review decide <run> <Q> <a|b|text>` as an event. A question that leaves
   `open` between reviews needs a decide event. Close treats a decided item
   as resolved.

The current environment detector recognizes Codex through `CODEX_THREAD_ID`.
Other tools remain undetected until a marker is documented or observed.

## N3. A person and an agent look the same to `atry` — in-repo part done in P14

Problem: `--via confirm` and `--via arg` are labels. An agent in the same
shell can run `atry approve <run> --via confirm`.

Intent: approve and close carry an honest actor label now. Real human
approval comes from tool config later.

Implemented in this repo: when `atry` detects the supported Codex environment,
it records `actor: "agent-env"` on approve and close. Other environments
record `unknown`. `status` shows the actor label. This still does not prove a
person approved.

Later (tool integration, not this repo yet): ship config that makes the tool
ask the person before `atry approve` and `atry close`. Example for Claude
Code: `"permissions": { "ask": ["Bash(atry approve:*)", "Bash(atry close:*)"] }`.
Bypass modes defeat this. The README must say so.

## N4. Implement scope is not checked

Problem: `task done` does not read the diff. "Edit only the listed files" is
prose. `claim` checks only declared `files`.

Intent: edits outside a task's `files` are visible and need a reason.

Fix in this repo:

- Record `tree` on `task-started`.
- `task done` diffs the start tree with the current tree. A path outside
  `files` refuses unless `--allow-extra <reason>` is set.
- Add `atry guard <run> <path> [--session <tag>]`. It exits non-zero when the path
  is outside the claimed or started task. A tool hook can call it later.

In parallel mode on one working tree, a diff cannot say which session made a
change. Worktree per claim fixes that. It is later work.

## N5. Event writes have no run lock — done in P13

Problem: `appendEvent` checks a gate on a loaded snapshot, then appends with
no lock. `commitState` writes `run.json` from that snapshot. `nextLabel` for
reviews checks then writes, so two `review new` calls can collide. `claim`
is safe: it writes its own lock, then reads others.

Intent: every state change is check-then-write under one lock.

Implemented in P13:

- Add `locks/run.lock`, opened with `wx`, with pid, host, time, a 30 second
  stale threshold, and retry with backoff.
- Inside the lock: read events, reduce, check the gate, append, write the
  cache.

## N6. Skills carry logic that the CLI should own

Problem:

- The preflight block repeats in six skills. It asks the model to compare
  versions in prose.
- State logic lives twice: in `nextStep()` and in skill prose (approve and
  close branches).
- `writing.md` and `file-conventions.md` copy into each bundle.

Intent: thin skills, thick CLI. Fewer tokens per stage.

Fix:

- `atry preflight --requires "<range>"` with an exit code.
- `atry next <run> --json` returns `command`, `reason`, `needsHuman`, and
  `read` (paths).
- Approve and close print their recommendation. Skills stop branching.
- Measure skill tokens per stage before and after. Snapshot-test `next`
  output, because that output is now a prompt.

## N7. Runs do not survive layout changes

Problem: run directories have no layout version. The v1 and v2 mix was fixed
by deleting `.agent-relay/`.

Decision: no work now. The phase constraints accept deleting old runs. Revisit
when the repo has other users or when run history feeds the memory feature.

## Future, not planned

These depend on the work above. Do not start them yet.

- Memory: a separate package with an MCP server to query and propose
  knowledge. Reference: [agentmemory](https://github.com/rohitg00/agentmemory).
  Intent notes:
  - agent-relay exports curated knowledge with evidence. It does not capture
    raw tool activity.
  - `atry` derives `origin` (`human-decided`, `review-confirmed`,
    `agent-claimed`) from events. The agent does not set it.
  - Agents propose. Promotion needs a person or recurrence across runs.
  - Staleness follows code drift (blob hash of scoped paths), not time.
  - Keep the MCP surface near six tools.
  - Start with SQLite FTS5 and scope filters. Add vectors only with evidence.
- Tool integration: ship rules and hooks per tool (approval for approve and
  close, `atry guard` on edits).
- Worktree per claim, with an integrate step in dependency order.
- Event `seq`, a hash chain on events (`prev`, the SHA-256 of the previous
  line), and `atry verify` to report hand edits.
- Layout version and `atry archive` (N7).
- Stats across runs from events: stage time, skip rate, reviewer delta,
  review rounds, per tool and model.

## Order

1. N5 and N1, the base for the other gates.
2. N2 and the in-repo part of N3.
3. N4. It can run next to step 2, because the files differ.
4. N6, last, so skill text is rewritten once.
