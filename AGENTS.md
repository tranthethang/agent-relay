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

## Hard constraints

- Node.js 22 or newer for the CLI and the tests.
- No bash scripts. Sync shared skill text with `npm run sync`.
- No `sudo`. Do not write an installer that targets `$HOME`.
- Do not invent orchestration. Record state in `events.jsonl`.
- Do not claim CI proves skills work end-to-end. CI runs `npm run check`,
  `npm test` on macOS, Linux, and Windows, and `npm run sync:check`.
- Sole-maintainer repo: do not add migration for v1 runs or the old bash tree.

## Layout

| Path                               | Role                                                         |
| ---------------------------------- | ------------------------------------------------------------ |
| `src/`                             | CLI and core                                                 |
| `test/`                            | Vitest                                                       |
| `skills/<name>/`                   | Skill bundles (`SKILL.md` plus `references/`; no `scripts/`) |
| `docs/`                            | Maintainer docs. Start at [`docs/INDEX.md`](docs/INDEX.md)   |
| `docs/file-conventions.md`         | Generated from `docs/conventions/` and synced into bundles   |
| `scripts/maint/sync-references.ts` | Copies convention parts and partials into skills             |
| `VERSION`                          | Release version. The git tag is `v` plus this string         |

## Editing skills and docs

1. Edit `docs/conventions/` for run layout. Edit `docs/partials/preflight.md`
   and `docs/partials/writing.md` for shared skill text. Do not hand-edit
   `docs/file-conventions.md` or `skills/*/references/file-conventions.md`.
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

## Versioning

- Calendar version `YY.M.D` (UTC day of the release; no zero padding), no `v`
  in [`VERSION`](VERSION). The git tag is `v` plus that string (for example
  `26.9.30` becomes `v26.9.30`). `package.json` `version` matches `VERSION`.
- One release per UTC calendar day.
- Full steps: [`docs/release.md`](docs/release.md).

## Release checklist

1. Bump [`VERSION`](VERSION), [`package.json`](package.json), and
   [`CHANGELOG.md`](CHANGELOG.md) together.
2. Update [`README.md`](README.md) when install behavior changes.
3. Commit on the branch you intend to tag.
4. Tag `v$(cat VERSION)` and push it. The npm workflow refuses a mismatched
   tag and publishes dist-tag `latest`.

## Tone

Match the README. Say what the code does, what it does not do, and what is
still manual.
