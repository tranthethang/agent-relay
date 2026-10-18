# agent-relay

[![CI](https://github.com/tranthethang/agent-relay/actions/workflows/ci.yml/badge.svg)](https://github.com/tranthethang/agent-relay/actions/workflows/ci.yml)

Markdown skills plus a TypeScript CLI (`atry`) for one piece of work in stages:
plan, implement, self-review, and cross-review. You run each stage yourself, in
whatever tool you open. Nothing here schedules agents, calls a model, or checks
that an agent followed a skill.

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
plan is not approved. Close requires completed reviews for its policy and
checks the latest completed review against the current code tree. It refuses
while the latest review has open questions unless you pass `--ack-open`.
Changes made after the latest review started require user acceptance and
`--ack-fixes`. `--waive-review <reason>` records a review waiver and skips
review integrity checks; it does not skip the open-question check.
`atry close --abandon <reason>` stops a run from any open state.

### Review policy

The committed `.agent-relay.json` at the run's base commit controls review
requirements. A missing file uses these defaults:

```json
{
  "schema": 1,
  "requireReviews": ["self", "cross"],
  "smallChange": 20
}
```

Changes below `smallChange` lines, counting additions and deletions from base
to the current tree, require only a self-review. Policy can also include an
optional `testCommand`. `review done` runs it at the repo root through the
platform shell, records its exit code, duration, and tree, and writes the last
200 stdout and stderr lines to `NN.test.log`. A non-zero exit records failure
but does not refuse `review done`.

Review JSON contains `schema`, `kind`, `tool`, `model`, `fixed`, and `open`.
The `tool` and `model` values must match the review start event. Cross-review
requires `--model`. Question cards at column zero must match `open.length`.
After a user answers a completed review's open item, record the answer with
`atry review decide <run> Q<n> <answer>`. A decision is stored in
`events.jsonl`; a later review can then close that question.

### Parallel tasks

```bash
atry claim <run> T1 --session <tag>
atry release <run> T1 --session <tag>
atry list <run>
```

`claim` refuses a task whose `files` overlap a lock held by another session.
It does not create worktrees. The sessions share one tree. `task done` ignores
a path that another in-progress task's `files` covers. `atry guard <run> <path>`
exits 0 when that path is inside an in-progress task. `--session <tag>` limits
the check to that session.

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
- `locks/run.lock` serializes CLI state changes. It does not lock direct file
  edits made outside `atry`.
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
  edit while the task is in progress. `atry guard` can check one path. This
  repo does not install a tool hook.
- There is no migration from the bash CLI or from v1 run files.
- CI runs `npm test` on macOS, Linux, and Windows. It does not show that an
  agent follows a skill.

## Development

```bash
npm test
npm run check
npm run sync:check
```

Contributor rules: [`AGENTS.md`](AGENTS.md), [`CONTRIBUTING.md`](CONTRIBUTING.md).
Maintainer docs: [`docs/INDEX.md`](docs/INDEX.md). History and next work: [`ROADMAP.md`](ROADMAP.md).
Release notes: [GitHub Releases](https://github.com/tranthethang/agent-relay/releases).
