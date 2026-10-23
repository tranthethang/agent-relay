# agent-relay

[![CI](https://github.com/tranthethang/agent-relay/actions/workflows/ci.yml/badge.svg)](https://github.com/tranthethang/agent-relay/actions/workflows/ci.yml)

Markdown skills plus a TypeScript CLI (`atry`) for one piece of work in stages:
plan, implement, self-review, and cross-review. You run each stage yourself, in
whatever tool you open. Nothing here schedules agents, calls a model, or checks
that an agent followed a skill. An optional Claude Code hook can check each file
edit against the in-progress task files.

## What it does and does not do

Does:

- Install six skill bundles with `atry skills install` or `npx skills add`.
- Install the `atry` CLI from npm. The binary name is `atry`.
- Store run state in `events.jsonl` and a `run.json` cache.
- Scaffold the files an agent fills, then validate them.

Does not:

- Run, order, or watch stages. An agent can skip a step or ignore a skill.
- Prove which tool or model ran. `tool` and `model` remain agent claims;
  supported environment markers can add a measured `detected` tool.
- Read v1 run directories. Delete those yourself.
- Prompt on a terminal. Questions happen in the agent chat.

## Install

Node.js 22 or newer. This release is `0.10.7`. The npm tarball holds the CLI
and the six skill bundles, so the `atry` binary and the six bundles are one
version: `0.10.7`.

```bash
npm i -g @tranthethang/agent-relay@0.10.7
atry skills install --tool claude-code
atry skills status --tool claude-code
atry version
```

`atry skills install --tool <tool>` copies the six bundled skills from the
running CLI into one tool directory. `--dir <path>` writes to another
directory. It runs on every install: a missing bundle is `installed`, a bundle
whose canonical files changed is `updated`, and an identical bundle is
`unchanged`. The copy overwrites `SKILL.md` and `references/`, and it keeps
files that are not in the bundle. A second install after an upgrade therefore
updates the canonical files and leaves extra local files alone.

`atry skills status` compares each installed bundle with the bundled one. A
bundle is `ok` when its floor fits and its content matches. It is `stale` when
only the content differs, `mismatch` when the floor is too high, and `missing`
when `SKILL.md` is absent. With no `--tool` or `--dir`, it checks the tool
directories that exist. `--all` checks every known directory. It exits 1 on a
failed bundle and prints the exact install command, such as
`npm i -g @tranthethang/agent-relay@X.Y.Z`.

`atry doctor` checks the installed bundle content and the `atry` version on
`PATH`. It fails when a bundle is stale or missing, or when `PATH` runs a
different base version from the running CLI.

Upgrade the CLI first, then run `atry skills install` again so the installed
bundle text matches the new CLI. Do not install an older CLI to clear a skill
floor: a bundle whose `requires-atry` is `>=0.10.7` needs `0.10.7` or newer.
When the `@latest` tag is older than that floor, install the exact version by
name.

A dev build is only for a local build from this repository. `atry preflight`
refuses a `-dev` version unless you pass `--allow-dev` or set `ATRY_DEV=1`.
Use either one only while you dogfood that build. Do not use a dev build for a
real run.

The six tool names are `claude-code`, `cowork`, `cursor`, `codex`,
`antigravity`, and `kiro`. Each tool writes one of three directories:

| Tool                               | Directory           |
| ---------------------------------- | ------------------- |
| Claude Code                        | `~/.claude/skills/` |
| Cowork, Cursor, Codex, Antigravity | `~/.agents/skills/` |
| Kiro                               | `~/.kiro/skills/`   |

`cowork` uses `.agents/skills`, the same directory as Cursor, Codex, and
Antigravity, because the Cowork client reads `.agents/skills`. An install for
one of those tools is visible to the other three.

A user who does not install npm can copy the bundles from the Git tree:

```bash
npx skills add tranthethang/agent-relay -g --copy
```

`--copy` writes real files. Some tools refuse a symlink that points outside
their skill directory. Skill paths depend on the `skills` CLI, and they match
the table above.

## Stages

| Skill               | What it asks the agent to do                      |
| ------------------- | ------------------------------------------------- |
| `atry-brainstorm`   | Discuss only, until you name the next skill       |
| `atry-plan`         | Create a run and fill `10-plan/`                  |
| `atry-implement`    | Implement the plan task by task                   |
| `atry-self-review`  | Review the diff against the plan                  |
| `atry-cross-review` | Second review, ideally in a different tool        |
| `atry-distill`      | Write `90-distill/manifest.json` at any run state |

A run lives at `.agent-relay/{YMD}-{id}-{slug}/`. Commit that directory or
ignore it. This repo does not choose.

## `atry` CLI

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

`atry approve` and `atry close` are for the person who coordinates the run.
`atry preflight --requires ">=X.Y.Z"` exits 0 when the installed version meets that range.
A lower version prints the exact install command for that range, such as
`npm i -g @tranthethang/agent-relay@X.Y.Z`, and exits 1.
A dev build is refused the same way. Add `--allow-dev`, or set `ATRY_DEV=1`,
only when you dogfood a build from this repo.
`atry stats` reads `events.jsonl` across runs. `atry stats <run>` reads one run.
A row reports stage time, review rounds, waivers, failed tests, and drift.
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
`atry next <run>` prints the next command. `--json` adds `command`, `reason`, `needsHuman`, and `read`.
Before approval, `next` follows the plan files: `plan new` when the overview or
task input is missing, `plan done` when `10-plan/index.json` is missing,
`approve --preview` when a task file lacks Detail or Acceptance, and `approve`
when the plan is complete.
`atry approve <run> --preview` prints Goal, Non-goals, Constraints, Decisions,
each task file, and `ready: yes` or `ready: no` with the missing items.
`atry close <run> --preview` prints `recommend: y` or `recommend: n` and the reasons.
Neither preview records an event.
`atry approve` refuses a plan with no `10-plan/index.json`, zero tasks, or an
empty Detail or Acceptance section. `atry plan done` and `atry plan amend`
refuse zero tasks. A `plan amend` after approval returns the run to `planned`,
so it needs approval again.
The skills ask before they run those verbs. Implement start refuses when the
plan is not approved or is no longer complete. Close checks the required
reviews for its policy, the latest completed review tree against the current
code tree, open questions, and changes made during the latest review.
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
`atry close --abandon <reason>` stops a run from any open state.

### Review policy

The committed `.agent-relay.json` at the run's base commit controls review
requirements. A missing file uses these defaults:

```json
{
  "schema": 1,
  "requireReviews": ["self", "cross"],
  "smallChange": 20,
  "strict": { "scope": false, "plan": false, "reviewIntegrity": false }
}
```

Changes below `smallChange` lines, counting additions and deletions from base
to the current tree, require only a self-review. Policy can also include an
optional `testCommand`. `review done` prints `test command: <command>` and
refuses with exit 4 until you add `--run-tests`. With the flag it runs the
command at the repo root through the platform shell, records its exit code,
duration, and tree, and writes the last 200 stdout and stderr lines to
`NN.test.log`. It does not print that output. The recorded tree is the tree
when the tests started. A non-zero exit records failure but does not refuse
`review done`. The command runs without the run lock. `review done` refuses
when the same review stage records another event while the tests run.
`atry distill` leaves every `*.test.log` out of the manifest; pass
`--include-test-logs` to export them.
`atry distill verify <run>` recomputes each hash and reports a file that the
manifest does not name. It prints `extra: <path>` for each extra file. It
skips the manifest and a `*.test.log` that the manifest does not name. It
exits 1 when a file is missing, different, or extra. It does not rewrite the
manifest. A missing manifest exits 3.

The optional `strict` policy groups control scope, plan, and review-integrity
gates independently. Each group defaults to `false`, which reports a warning
and continues when the command can preserve the relevant evidence. Set a group
to `true` to keep its blocking behavior. Existing policy files that omit
`strict` remain valid.

Review JSON contains `schema`, `kind`, `tool`, `model`, `fixed`, and `open`.
An older review JSON may also carry `tests`. The CLI reads that key, ignores
its value, and never writes it in a new review JSON. Any other unknown key
still fails the parse.
The `tool` and `model` values must match the review start event. Cross-review
requires `--model`. Question cards at column zero must match `open.length`.
After a user answers a completed review's open item, record the answer with
`atry review decide <run> Q<n> <answer>`. A decision is stored in
`events.jsonl`; a later review can then close that question.

| Key                      | What it controls                                        |
| ------------------------ | ------------------------------------------------------- |
| `requireReviews`         | Review kinds `close` requires: `self`, `cross`, or both |
| `smallChange`            | Below this many changed lines, only `self` is required  |
| `testCommand`            | Command that `review done` runs and records             |
| `worktree.enabled`       | One git worktree and branch per run                     |
| `worktree.dir`           | Folder for run worktrees, outside the repo              |
| `strict.scope`           | Refuse edits outside task `files` (hook: deny, not ask) |
| `strict.plan`            | Refuse plans with more than eight tasks                 |
| `strict.reviewIntegrity` | Refuse `close` on review warnings, even with `--via`    |

Each option, its default, and the commands that read it are in
[`configuration.md`](specs/60-policy-governance/00-policy-spec/configuration.md).

`atry policy init` writes a template `.agent-relay.json` at the git root.
`--preset lenient|standard|strict` picks the template; the default is
`standard`. The `standard` template holds the defaults and
`"worktree": { "enabled": false }`. The command
refuses when the file exists. It does not stage or commit the file. You must
commit it, because runs read policy only at their base commit.

`atry policy check` validates `.agent-relay.json` in the working tree. Run it
before you commit the file. It uses the same schema and field paths as runs do.

### Worktree isolation

Worktree isolation remains off by default. Set `"worktree": { "enabled": true }` in `.agent-relay.json` and commit it.
`run new` reads policy at `HEAD`, so an uncommitted change has no effect.
`worktree.dir` sets the folder for worktrees. A relative `dir` resolves from
the git root. It cannot point to the git root or any folder inside the repo.
Without `dir`, the folder is `<repo>_work-tree` next to the repo.

`run new` exclusively reserves the run directory name. A failure during run
setup rolls back the symlink, the worktree, and the branch.
With worktree on, `run new` runs `git worktree add -b <run> <dir>/<run> HEAD`.
`HEAD` must be on a branch. `run.json` records the worktree path and the
original branch. The worktree gets `.agent-relay` as a link to the main repo
folder (a junction on Windows), and `.agent-relay` goes into the shared
`info/exclude`. Work, commit, and run `atry` in that worktree. Every git check
for the run uses the worktree. `atry context --json` shows `run.worktree`.

`stage start implement` checks the worktree before work begins. It verifies
that the worktree directory exists, is registered with Git, is not detached,
and matches the run branch.

The merge stays manual. Merge the run branch into the original branch before
`close`. `close` removes the worktree only when the run branch is an ancestor
of the original branch and the worktree has no uncommitted changes. Otherwise it
keeps the worktree and says why. If removal fails, `close` keeps the run closed
and reports `worktree: kept (<reason>)`. A successful removal records a `cleaned`
run event. `atry worktree cleanup [run]` retries removal on a closed run.
A squash merge does not make the run branch an ancestor. `close` never deletes
the run branch, and the run history stays in the main repo. Ignored files
remain outside this change.

With worktree off, `stage start implement` refuses a tree with changes outside
`.agent-relay/`. On a clean tree, it moves `base` to `HEAD` and records a `run`
`rebased` event.

### Parallel tasks

```bash
atry claim <run> T1 --session <tag>
atry release <run> T1 --session <tag>
atry integrate <run> T1
atry list <run>
```

`claim` refuses a task whose `files` overlap a lock held by another session.
With worktree off, `claim` does not create a worktree.
With worktree on, `claim` creates one worktree and one branch for the task.
The lock stores the path and the branch. A failed claim removes both.
`release` removes a clean worktree and its branch when the run branch contains that branch.
`release` keeps a worktree that has changes or unmerged commits. It prints the reason.
A task worktree must be committed before `atry task done` and before `atry integrate`.
`task done` exits 4 and names `worktree` when the task worktree has uncommitted changes.
The tool does not commit for the agent. Commit in the task worktree first.
`atry integrate` merges that branch into the run branch after each dependency is done or skipped.
A conflict exits 4, keeps the worktree, and prints each path.
A clean merge removes the worktree and records a `run` `cleaned` event with the task and the branch.
A dirty task worktree refuses the merge with exit 4, prints `merged: no` and
`worktree: kept`, and skips the cleaned event. Nothing merges until the agent commits.
`atry next` recommends integrate after the task is done while that worktree remains.
`task done` ignores
a path that another in-progress task's `files` covers. `atry guard <run> <path>`
exits 0 when that path is inside an in-progress task. `--session <tag>` limits
the check to that session.

### Claude Code edit hook

`atry hook install --tool claude-code` adds a `PreToolUse` hook to
`.claude/settings.json` at the git root. It keeps the other settings and hooks.
A second install reports `present` and adds nothing. The command does not stage
or commit the file. It does not write user-level settings.

The hook runs `atry hook check` before `Edit`, `MultiEdit`, `Write`, and
`NotebookEdit`. The check reads the edited path from the hook JSON on stdin. It
allows the edit when no run is implementing, when the path is under
`.agent-relay/`, or when an in-progress task lists the path. Otherwise it asks
the person. When `strict.scope` is true for an implementing run, it denies the
edit. A check that fails prints nothing and allows the edit.

## Run layout

```text
.agent-relay/
  brainstorms/<YMD>-<slug>/notes.md, open.json
  <YMD>-<id>-<slug>/
    10-plan/overview.md
    10-plan/tasks.input.json
    10-plan/index.json
    10-plan/T1.md
    20-implement/T1.md
    30-self-review/01.md, 01.json, 01.test.log
    40-cross-review/01.md, 01.json, 01.test.log
    90-distill/manifest.json
    run.json
    events.jsonl
    locks/
```

Markdown is prose. `atry` does not parse it. An agent fills JSON only from a
scaffold that already has every key. Task status lives in events.

## Known limits

- The tree snapshot uses a temporary copy of the Git index and excludes
  `.agent-relay/`. It does not change the real index.
- When `run.json` differs from the replay of `events.jsonl`, `atry` takes the
  run lock, rebuilds it, and appends a `run` `drifted` event. `atry status`
  shows the count and `close --preview` lists it. An edit that changes both
  files the same way is not detected.
- Each event after the first has `prev`, the sha256 of the previous line. A
  plain edit, insert, or delete in `events.jsonl` fails the next read. The chain
  is not a signature: a writer who recomputes the hashes, or removes every
  `prev`, is not detected. Runs from before the chain still load.
- `locks/run.lock` serializes CLI state changes. It holds an owner token, and
  only the owner removes it. A stale lock (30 seconds) is removed by one process
  at a time. It does not lock direct file edits made outside `atry`.
- A review waiver is recorded with its reason. It does not prove who approved
  the waiver.
- Cross-review independence is a request. `atry review done` warns when the
  cross-review tool or model vendor matches implement or self-review. A
  second warning marks a matching model line. These warnings do not refuse.
- `tool` and `model` are agent claims locked to the review start. `detected`
  reports only supported environment markers; it does not prove which model
  generated the review. Currently, Codex detection uses `CODEX_THREAD_ID`.
- `approve` and `close` record `actor` as `agent-env` when a supported marker
  is present and `unknown` otherwise. `atry` does not claim a human approved.
- `--via confirm` records the agent's report that a person confirmed. It does
  not prove a person typed the answer. Tool approval prompts and bypass modes
  are outside this repo.
- `testCommand` comes from the policy at the run's base and runs through a
  platform shell at the repository root. Review completion records its result;
  a non-zero result does not itself refuse `review done`.
- `task done` refuses a changed path outside that task's `files` unless
  `--allow-extra <reason>` is set. `stage done implement` does the same for
  paths outside the union of task `files` and recorded `extra` paths.
- `claim` checks recorded file paths before work starts. It does not stop an
  edit while the task is in progress. `atry guard` can check one path. The
  Claude Code hook checks edits only after you install it, and only in Claude
  Code. Other tools and shell commands that write files are not checked.
- There is no migration from the bash CLI or from v1 run files.
- CI runs `npm test` on macOS, Linux, and Windows. It does not show that an
  agent follows a skill.

## Development

```bash
npm test
npm run check
npm run sync:check
npm run evals
npm run coverage:report
git config core.hooksPath .githooks
brew install dprint
brew install sonar-scanner
```

### Tests and evals

`npm run evals` runs two layers. The fake layer replays recorded scenarios
through `evals/fake-atry.ts`. It checks the command surface, the JSON shape,
the step count, and each skill's token budget. It does not call a model, and a
fake pass is not behavioral evidence.

The real layer drives the built CLI through `evals/real.ts` in a temporary git
repository and a temporary `HOME`. It checks exit codes, JSON fields, file
contents, and git state. That layer is the behavioral check and the release
evidence. It also does not call a model or the network.

A model-backed review stays manual: install the skills, run one scenario in a
tool, and compare the commands the agent issues with the recorded steps. CI
cannot run that layer. `npm test`, `npm run check`, `npm run sync:check`, and
`npm run evals` show what the code does. They do not prove that an agent
followed a skill.

Contributor rules: [`AGENTS.md`](AGENTS.md), [`CONTRIBUTING.md`](CONTRIBUTING.md).
Security reports and trust limits: [`SECURITY.md`](SECURITY.md).
Technical specifications and system diagrams: [`specs/`](specs/).
Maintainer docs: [`specs/90-maintainer/00-index/index.md`](specs/90-maintainer/00-index/index.md). History and next work: [`ROADMAP.md`](ROADMAP.md).
Release notes: [GitHub Releases](https://github.com/tranthethang/agent-relay/releases).
