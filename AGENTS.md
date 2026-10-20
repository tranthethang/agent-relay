# AGENTS.md — working on agent-relay

Guidance for agents (and humans) editing this repository. It is not a runtime
and it does not prove that an installed skill was followed. End-user install
steps are in [`README.md`](README.md).

## What this repo is

- Markdown skill bundles (`skills/<name>/SKILL.md` plus `references/`).
- A TypeScript CLI. The binary name is `atry`. Source is `src/`. Tests are
  `test/`. Build output is `dist/atry.js`.
- A person invokes each stage in a tool. Nothing here schedules agents or
  checks `tool` and `model` records.

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

## Hard constraints

- Node.js 22 or newer for the CLI and the tests.
- No bash scripts. `.githooks/pre-commit` is the shell exception. Sync shared skill text with `npm run sync`.
- No `sudo`. Do not write an installer that targets `$HOME`.
- Do not invent orchestration. Record state in `events.jsonl`.
- Do not claim CI proves skills work end-to-end. CI runs `npm run check`,
  `npm test` on macOS, Linux, and Windows, and `npm run sync:check`.
- Sole-maintainer repo: do not add migration for v1 runs or the old bash tree.

## Layout

| Path                               | Role                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/`                             | CLI and core                                                                                                 |
| `test/`                            | Vitest                                                                                                       |
| `skills/<name>/`                   | Skill bundles (`SKILL.md` plus `references/`; no `scripts/`)                                                 |
| `specs/`                           | Technical specifications, detail-design, and diagrams                                                        |
| `specs/90-maintainer/`             | Maintainer guides. Start at [`specs/90-maintainer/00-index/index.md`](specs/90-maintainer/00-index/index.md) |
| `scripts/maint/sync-references.ts` | Copies convention parts and partials into skills                                                             |
| `scripts/maint/next-version.ts`    | Next `X.M.Z` version from tags and the month                                                                 |

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
```

`npm run coverage` exits non-zero when a bar misses. Overall coverage for
`src/**` and `scripts/maint/**` is at least 95%. That figure is covered lines
plus covered branches, divided by the line total plus the branch total.
Per-file coverage in those trees is above 90%. A file at 90.0% misses. A file
with no lines to cover is skipped. `tsup.config.ts` and `vitest.config.ts` stay
outside that bar. Duplicated lines density for project `agent-relay` is at most
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
2. The workflow publishes npm dist-tag `latest` and opens a GitHub Release.
3. Update [`README.md`](README.md) when install behavior changes.

## Tone

Match the README. Say what the code does, what it does not do, and what is
still manual.
