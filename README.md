# agent-relay

[![CI](https://github.com/tranthethang/agent-relay/actions/workflows/ci.yml/badge.svg)](https://github.com/tranthethang/agent-relay/actions/workflows/ci.yml)

Markdown skills plus a TypeScript CLI (`atry`) for one piece of work in stages:
plan, implement, self-review, and cross-review. You run each stage yourself, in
whatever tool you open. Nothing here schedules agents, calls a model, or checks
that an agent followed a skill. An optional Claude Code hook can check each file
edit against the in-progress task files.

## What it does and does not do

Does:

- Install six skill bundles with `npx skills add`.
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

Node.js 22 or newer.

```bash
npx skills add tranthethang/agent-relay -g --copy
npm i -g @tranthethang/agent-relay
atry version
```

`--copy` writes real files. Some tools refuse a symlink that points outside
their skill directory. Skill paths depend on the `skills` CLI. Cursor, Codex,
and Antigravity share `~/.agents/skills/`. Claude Code uses `~/.claude/skills/`.
Kiro uses `~/.kiro/skills/`.

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
atry preflight --requires ">=X.Y.Z"
atry next <run>
atry run new --slug <slug> --title <title>
atry resolve [run]
atry status [run]
atry context <run> --json [--task T1]
atry plan new <run>
atry plan done <run>
atry approve <run> --via confirm|arg
atry approve <run> --preview
atry close <run> --preview
atry policy init [--preset lenient|standard|strict]
atry stage start <run> implement --tool <tool>
atry task start <run> T1
atry task done <run> T1
atry stage done <run> implement --tool <tool> [--allow-extra "<reason>"]
atry review new <run> self --tool <tool> [--model <model>]
atry review new <run> cross --tool <tool> --model <model>
atry review done <run> self|cross
atry review decide <run> Q<n> <answer>
atry close <run> --via confirm|arg [--ack-open] [--ack-fixes]
atry close <run> --waive-review "<reason>" [--ack-open]
atry worktree cleanup [run]
atry hook install --tool claude-code
atry hook check
atry distill <run>
```

`atry approve` and `atry close` are for the person who coordinates the run.
`atry preflight --requires ">=X.Y.Z"` exits 0 when the installed version meets that range.
A lower version prints `npm i -g @tranthethang/agent-relay@latest` and exits 1.
`atry next <run>` prints the next command. `--json` adds `command`, `reason`, `needsHuman`, and `read`.
`atry approve <run> --preview` prints Goal, Decisions, and the task count.
`atry close <run> --preview` prints `recommend: y` or `recommend: n` and the reasons.
Neither preview records an event.
The skills ask before they run those verbs. Implement start refuses when the
plan is not approved. Close checks the required reviews for its policy, the
latest completed review tree against the current code tree, open questions,
and changes made after the latest review started.
With `strict.reviewIntegrity` false (the default) and `--via` set, `close`
does not refuse on those checks. It records them as warnings in the `closed`
event. The skills pass `--via`, so this is the default path.
Without `--via`, or with `strict.reviewIntegrity` true, `close` refuses until
each check passes. Pass `--ack-open` for open questions and `--ack-fixes` for
changes after the latest review. `--waive-review <reason>` records a review waiver and skips
review integrity checks; it does not skip the open-question check.
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
optional `testCommand`. `review done` runs it at the repo root through the
platform shell, records its exit code, duration, and tree, and writes the last
200 stdout and stderr lines to `NN.test.log`. The recorded tree is the tree
when the tests started. A non-zero exit records failure but does not refuse
`review done`. The command runs without the run lock. `review done` refuses
when the same review stage records another event while the tests run.

The optional `strict` policy groups control scope, plan, and review-integrity
gates independently. Each group defaults to `false`, which reports a warning
and continues when the command can preserve the relevant evidence. Set a group
to `true` to keep its blocking behavior. Existing policy files that omit
`strict` remain valid.

Review JSON contains `schema`, `kind`, `tool`, `model`, `fixed`, and `open`.
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
atry list <run>
```

`claim` refuses a task whose `files` overlap a lock held by another session.
`claim` does not create worktrees. The sessions on one run share one tree.
With worktree isolation on, each run has its own tree. `task done` ignores
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
git config core.hooksPath .githooks
brew install dprint
brew install sonar-scanner
```

Contributor rules: [`AGENTS.md`](AGENTS.md), [`CONTRIBUTING.md`](CONTRIBUTING.md).
Technical specifications and system diagrams: [`specs/`](specs/).
Maintainer docs: [`specs/90-maintainer/00-index/index.md`](specs/90-maintainer/00-index/index.md). History and next work: [`ROADMAP.md`](ROADMAP.md).
Release notes: [GitHub Releases](https://github.com/tranthethang/agent-relay/releases).
