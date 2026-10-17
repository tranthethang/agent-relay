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
- Prove which tool or model ran. `tool` and `model` are records.
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
atry run new --slug <slug> --title <title>
atry resolve [run]
atry status [run]
atry context <run> --json [--task T1]
atry plan new <run>
atry plan done <run>
atry approve <run> --via confirm|arg
atry stage start <run> implement --tool <tool>
atry task start <run> T1
atry task done <run> T1
atry stage done <run> implement --tool <tool>
atry review new <run> self|cross --tool <tool>
atry review done <run> self|cross
atry close <run> --via confirm|arg
atry distill <run>
```

`atry approve` and `atry close` are for the person who coordinates the run.
The skills ask before they run those verbs. Implement start refuses when the
plan is not approved. Close refuses while the latest review has open questions,
unless you pass `--ack-open`. `atry close --abandon <reason>` stops a run from
any open state.

### Parallel tasks

```bash
atry claim <run> T1 --session <tag>
atry release <run> T1 --session <tag>
atry list <run>
```

`claim` refuses a task whose `files` overlap a lock held by another session.
It does not create worktrees.

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
    30-self-review/01.md, 01.json
    40-cross-review/01.md, 01.json
    90-distill/manifest.json
    run.json
    events.jsonl
    locks/
```

Markdown is prose. `atry` does not parse it. An agent fills JSON only from a
scaffold that already has every key. Task status lives in events.

## Known limits

- Cross-review independence is a request. `atry review done` warns when the
  cross-review tool or model family matches implement or self-review. It does
  not refuse.
- `claim` checks recorded file paths. It does not stop two agents from editing
  the same file outside those paths.
- There is no migration from the bash CLI or from v1 run files.
- CI runs `npm test` on macOS, Linux, and Windows. It does not show that an
  agent follows a skill.

## Development

```bash
npm test
npm run check
bash scripts/maint/sync-references.sh --check
```

Contributor rules: [`AGENTS.md`](AGENTS.md), [`CONTRIBUTING.md`](CONTRIBUTING.md).
Maintainer docs: [`docs/INDEX.md`](docs/INDEX.md).
