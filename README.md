# agent-relay

[![CI](https://github.com/tranthethang/agent-relay/actions/workflows/ci.yml/badge.svg)](https://github.com/tranthethang/agent-relay/actions/workflows/ci.yml)
[![Codecov](https://codecov.io/gh/tranthethang/agent-relay/graph/badge.svg)](https://codecov.io/gh/tranthethang/agent-relay)
[![CodeQL](https://github.com/tranthethang/agent-relay/actions/workflows/codeql.yml/badge.svg)](https://github.com/tranthethang/agent-relay/actions/workflows/codeql.yml)

Markdown skills plus a TypeScript CLI (`atry`) for one piece of work in stages:
plan, implement, self-review, and cross-review. You run each stage yourself, in
whatever tool you open.

![agent-relay banner](agent-relay-banner-voxel-bw.png)

## Scope

### What it does

- Installs six skill bundles with `atry skills install` or `npx skills add`.
- Ships the `atry` CLI on npm.
- Stores run state in `events.jsonl` and a `run.json` cache.
- Scaffolds the files an agent fills, then validates them.
- Can check each Claude Code file edit against the in-progress task files, with
  an optional hook.

### What it does not do

- Run, order, or watch stages. An agent can skip a step or ignore a skill.
- Schedule agents or call a model.
- Prove which tool or model ran. `tool` and `model` remain agent claims.
- Read v1 run directories. Delete those yourself.
- Prompt on a terminal. Questions happen in the agent chat.

## Quick start

Node.js 22 or newer. This release is `0.10.7`.

```bash
npm i -g @tranthethang/agent-relay@0.10.7
atry skills install --tool claude-code
atry skills status --tool claude-code
```

Supported tools: `claude-code`, `cowork`, `cursor`, `codex`, `antigravity`, and
`kiro`. Without npm, copy the bundles from the Git tree:

```bash
npx skills add tranthethang/agent-relay -g --copy
```

Skill directories, upgrades, stale bundles, and dev builds are in
[`installer.md`](specs/90-maintainer/10-install/installer.md).

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
ignore it. This repo does not choose. The layout is in
[`run-layout.md`](specs/70-storage-and-git/00-directory-conventions/run-layout.md).

## The `atry` CLI

Text is the default. `--json` adds `"schema": 1`. The commands you reach for
most:

```bash
atry status [run]            # where a run stands
atry next <run>              # the next command to run
atry run new --slug <slug> --title <title>
atry approve <run> --preview # check the plan before approval
atry close <run> --preview   # check the gates before close
atry doctor                  # check Node, git, bundles, and PATH
```

`atry approve` and `atry close` are for the person who coordinates the run.
Every verb, flag, and gate is in the
[command reference](specs/10-cli-runtime/40-command-reference/commands.md).

## Going deeper

| Topic                           | Read                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| All verbs, flags, close gates   | [commands.md](specs/10-cli-runtime/40-command-reference/commands.md)                          |
| Review policy and `testCommand` | [review-policy.md](specs/60-policy-governance/00-policy-spec/review-policy.md)                |
| Every policy option             | [configuration.md](specs/60-policy-governance/00-policy-spec/configuration.md)                |
| One git worktree per run        | [worktree-isolation.md](specs/70-storage-and-git/40-worktree-isolation/worktree-isolation.md) |
| Parallel tasks and claims       | [parallel-tasks.md](specs/40-concurrency-control/40-parallel-tasks/parallel-tasks.md)         |
| Claude Code edit hook           | [claude-code-hook.md](specs/80-skills-integration/10-tool-adapters/claude-code-hook.md)       |
| What `atry` does not prove      | [known-limits.md](specs/60-policy-governance/10-trust-boundaries/known-limits.md)             |
| Trust boundaries                | [security.md](specs/90-maintainer/40-security/security.md), [`SECURITY.md`](SECURITY.md)      |
| All specifications              | [`specs/`](specs/)                                                                            |

## Development

```bash
npm test
npm run check
npm run sync:check
npm run evals
```

`npm run evals` runs a fake layer and a real layer. Neither calls a model, so
neither proves that an agent followed a skill. Details, coverage bars, and the
manual model-backed check are in
[`testing.md`](specs/90-maintainer/20-testing/testing.md).

- Contributor rules: [`AGENTS.md`](AGENTS.md), [`CONTRIBUTING.md`](CONTRIBUTING.md).
- Maintainer docs: [`index.md`](specs/90-maintainer/00-index/index.md).
- History and next work: [`ROADMAP.md`](ROADMAP.md).
- Release notes: [GitHub Releases](https://github.com/tranthethang/agent-relay/releases).
