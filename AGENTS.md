# AGENTS.md — working on agent-relay

Guidance for agents (and humans) editing this repository. It is not a runtime
and it does not prove that an installed skill was followed. End-user install
steps are in [`README.md`](README.md).

## What this repo is

- Markdown skill bundles (`skills/<name>/SKILL.md` plus `references/`).
- A TypeScript CLI. The binary name is `atry`. Source is `src/`. Tests are
  `test/`. Build output is `dist/atry.js`.
- A person invokes each stage in a tool. Nothing here schedules agents or calls
  a model. `atry` records `tool` and `model` as agent claims and checks that a
  review's values match its start event. That check does not prove which model
  ran.

## Installed tools vs. repo source

When you use an `atry-*` skill or run `atry` while working in this repo, use
the version installed on this machine:

- CLI: the global `atry` on `PATH` (check with `which atry`). Do not run
  `node dist/atry.js` or `npm run` scripts in place of it.
- Skills: the installed bundles (for Claude Code, `~/.claude/skills/atry-*`).
  Do not load or follow `skills/<name>/SKILL.md` from this checkout as the
  active skill.

`src/`, `dist/`, and `skills/` in this repo are the source you edit. They are
not the tools you run. Changes there take effect only after a build and a new
install.

When an `atry-*` skill runs preflight, pass the skill front matter
`requires-atry` value to `atry preflight --requires` (for example `>=0.10.7`).
Use a `>=X.Y.Z` range only. Do not pass a skill name or subcommand. Treat the
preflight exit code as the version gate. Do not use `atry --version` for that
check; use subcommand `atry version` only when you need the printed version.
Background for run `20261030-preflight-requires-wording`:
`.agent-relay/brainstorms/20261030-preflight-requires-wording/notes.md`.

## Hard constraints

- Node.js 22 or newer for the CLI and the tests.
- No bash scripts. `.githooks/pre-commit` is the shell exception. Sync shared skill text with `npm run sync`.
- No `sudo`. Do not write an installer that targets `$HOME`.
- Do not invent orchestration. Record state in `events.jsonl`.
- Do not claim CI proves skills work end-to-end. CI runs `npm run check`,
  `npm test` on macOS, Linux, and Windows, `npm run sync:check`, and both eval
  layers.
- Sole-maintainer repo: do not add migration for v1 runs or the old bash tree.
- This repo runs under a strict-scope policy. See the "Dogfood policy" section in
  [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Layout

| Path                               | Role                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/`                             | CLI and core                                                                                                             |
| `test/`                            | Vitest                                                                                                                   |
| `evals/`                           | Skill evals: a fake `atry`, recorded scenarios, and the real CLI layer (no model), plus the nightly `evals/model/` layer |
| `skills/<name>/`                   | Skill bundles (`SKILL.md` plus `references/`; no `scripts/`)                                                             |
| `specs/`                           | Technical specifications, detail-design, and diagrams                                                                    |
| `specs/90-maintainer/`             | Maintainer guides. Start at [`specs/90-maintainer/00-index/index.md`](specs/90-maintainer/00-index/index.md)             |
| `scripts/maint/sync-references.ts` | Copies convention parts and partials into skills                                                                         |
| `scripts/maint/next-version.ts`    | Next `X.M.Z` version from tags and the month                                                                             |

## Documentation and specs

- All documentation and specifications must be written in English (`en`).
- Folders and sub-folders under `specs/` must follow the `xx-yyy` numbering convention, where `xx` is a two-digit number from `00` to `99` incrementing by 10 (e.g. `00-overview`, `10-cli-runtime`).
- Sub-folders within them follow the exact same rule (e.g. `specs/00-overview/00-architecture/`).
- Markdown files within sub-folders must not use numeric prefixes. Use descriptive kebab-case names (e.g. `system-overview.md`).

## Editing skills and specs

1. Edit `specs/70-storage-and-git/00-directory-conventions/` for run layout.
   Edit `specs/80-skills-integration/00-skill-bridge/preflight.md` and
   `specs/80-skills-integration/00-skill-bridge/writing.md` for shared skill text. Do not hand-edit
   `skills/*/references/file-conventions.md` or `skills/*/references/writing.md`.
2. Run `npm run sync`. CI fails on drift (`npm run sync:check`).
3. Skill text calls `atry` verbs. Do not tell the agent to run files under
   `scripts/`.
4. Keep claims honest. Same-tool cross-review is a warning. `claim` checks
   overlapping `files` entries. It does not lock every source edit.

## Tests before you claim done

```bash
npm test
npm run check
npm run sync:check
npm run evals
```

Tests run on CI runners with no global git identity, so do not rely on the
developer's `~/.gitconfig`. `git merge` needs a committer identity even when it
ends in a conflict. Create temporary repos with `withTempGitRepo` in
`test/helper.ts`, which sets a repo-local `user.email` and `user.name`. To
reproduce a CI failure, run the test with `HOME` set to an empty directory,
`GIT_CONFIG_NOSYSTEM=1`, and `GIT_CONFIG_GLOBAL=/dev/null`. When a test spawns
`atry`, pass `result.stderr` as the assertion message on stdout checks, so a
gate error is visible in the CI log.
Windows runners default to `core.autocrlf`, which turns `"\n"` fixtures into
`"\r\n"`; `withTempGitRepo` sets `core.autocrlf=false`, so keep byte-exact
file assertions on repos made by that helper.

`npm run evals` runs a fake layer and a real layer. The fake layer checks the
command surface and the token budget. The real layer drives the built CLI in a
temporary repository and is the behavioral check. Neither layer calls a model,
and neither proves that an agent followed a skill.

The nightly `Model evals` workflow runs `npm run evals:model`. It reports a
skill compliance rate per tool on four scenarios (see `evals/README.md`). It is
not part of `npm run evals`, does not run on push or pull request, and does not
gate a release. A pass does not prove that a skill works in every case.

`npm run coverage:report` exits non-zero when a bar misses. It does not call Sonar.
`npm run coverage:sonar` runs that report, then checks duplication when `SONAR_HOST_URL` is set.
Overall coverage for
`src/**` and `scripts/maint/**` is at least 95%. That figure is covered lines
plus covered branches, divided by the line total plus the branch total.
Per-file coverage in those trees is above 90%. A file at 90.0% misses. A file
with no lines to cover is skipped. Per-file branch coverage in those trees is
at least 90%. A file at 90.0% branches passes. A file with no branches passes.
`tsup.config.ts` and `vitest.config.ts` stay outside these bars. Duplicated lines density for project `agent-relay` is at most
1%.

## Versioning

- The version is `X.M.Z`. The git tag is `v` plus that string.
- `X` starts at `0`. It rises only when the release workflow input `major` is true.
- `M` is the month in `Asia/Ho_Chi_Minh`. It is `1` to `12`, with no zero padding.
- `Z` is the release count in that month. It is `0` to `99`.
- `package.json` in git stays `0.0.0`. The workflow sets the version before publish.
- Full steps: [`specs/90-maintainer/30-release/release.md`](specs/90-maintainer/30-release/release.md).

## Release checklist

1. Run the Release workflow on `main`. Set `major` when the next number would not be higher, such as January after December.
2. The workflow sets the version before the build, publishes npm dist-tag `latest`, and opens a GitHub Release.
3. The post-publish smoke job installs the published tarball and runs `atry version`, `atry preflight`, `atry skills install`, and `atry skills status`. The release is complete only after that job passes.
4. Record the evidence in [`specs/90-maintainer/30-release/release.md`](specs/90-maintainer/30-release/release.md): the four test commands, the real CLI eval, `npm run coverage:report`, `atry skills status`, the smoke result, and a strict close or a reason for each waiver.
5. Update [`README.md`](README.md) when install behavior changes.

## Tone

Match the README. Say what the code does, what it does not do, and what is
still manual.

<!-- CODEGRAPH_START -->

## CodeGraph

This project has a CodeGraph MCP server (`codegraph_*` tools) configured. CodeGraph is a tree-sitter-parsed knowledge graph of every symbol, edge, and file. Reads are sub-millisecond and return structural information grep cannot.

### When to prefer codegraph over native search

Use codegraph for **structural** questions — what calls what, what would break, where is X defined, what is X's signature. Use native grep/read only for **literal text** queries (string contents, comments, log messages) or after you already have a specific file open.

| Question                                                  | Tool                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| "Where is X defined?" / "Find symbol named X"             | `codegraph_search`                                                                   |
| "What calls function Y?"                                  | `codegraph_callers`                                                                  |
| "What does Y call?"                                       | `codegraph_callees`                                                                  |
| "How does X reach/become Y? / trace the flow from X to Y" | `codegraph_trace` (one call = the whole path, incl. callback/React/JSX dynamic hops) |
| "What would break if I changed Z?"                        | `codegraph_impact`                                                                   |
| "Show me Y's signature / source / docstring"              | `codegraph_node`                                                                     |
| "Give me focused context for a task/area"                 | `codegraph_context`                                                                  |
| "See several related symbols' source at once"             | `codegraph_explore`                                                                  |
| "What files exist under path/"                            | `codegraph_files`                                                                    |
| "Is the index healthy?"                                   | `codegraph_status`                                                                   |

### Rules of thumb

- **Answer directly — don't delegate exploration.** For "how does X work" / architecture questions, answer with 2-3 codegraph calls: `codegraph_context` first, then ONE `codegraph_explore` for the source of the symbols it surfaces. For a specific **flow** ("how does X reach Y") start with `codegraph_trace` from→to — one call returns the whole path with dynamic hops bridged — then ONE `codegraph_explore` for the bodies; don't rebuild the path with `codegraph_search` + `codegraph_callers`. Codegraph IS the pre-built index, so spawning a separate file-reading sub-task/agent — or running a grep + read loop — repeats work codegraph already did and costs more for the same answer.
- **Trust codegraph results.** They come from a full AST parse. Do NOT re-verify them with grep — that's slower, less accurate, and wastes context.
- **Don't grep first** when looking up a symbol by name. `codegraph_search` is faster and returns kind + location + signature in one call.
- **Don't chain `codegraph_search` + `codegraph_node`** when you just want context — `codegraph_context` is one call.
- **Don't loop `codegraph_node` over many symbols** — one `codegraph_explore` call returns several symbols' source grouped in a single capped call, while each separate node/Read call re-reads the whole context and costs far more.
- **Index lag — check the staleness banner, don't guess a wait.** When a codegraph response starts with "⚠️ Some files referenced below were edited since the last index sync…", the listed files are pending re-index — Read those specific files for accurate content. Files NOT in that banner are fresh and codegraph is authoritative for them. `codegraph_status` also lists pending files under "Pending sync".

### If `.codegraph/` doesn't exist

The MCP server returns "not initialized." Ask the user: _"I notice this project doesn't have CodeGraph initialized. Want me to run `codegraph init -i` to build the index?"_

<!-- CODEGRAPH_END -->
