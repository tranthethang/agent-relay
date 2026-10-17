# Contributing

Constraints for editing this repo are in [`AGENTS.md`](AGENTS.md). Maintainer
guides start at [`docs/INDEX.md`](docs/INDEX.md).

## Quick start

```bash
git clone https://github.com/tranthethang/agent-relay.git
cd agent-relay
npm ci
npm test
```

Install the skills into a tool with `npx skills add` when you want to dogfood
them. See [`docs/installer.md`](docs/installer.md).

## Tests

Detail: [`docs/testing.md`](docs/testing.md).

```bash
npm test
npm run check
npm run sync:check
```

CI runs `npm test` on macOS, Linux, and Windows. It also checks formatting
and skill-reference sync.

## Formatting

```bash
brew install dprint
make fmt
make fmt-check
```

`dprint.json` formats TypeScript, markdown, and yaml. Edit convention parts
under `docs/conventions/`, then run `make fmt`, so the generated copies match.

## Where things live

- Skill bundles: `skills/<name>/`
- CLI: `src/` and the published `dist/atry.js`
- Tests: `test/`
- Maintainer sync: `scripts/maint/sync-references.ts` (`npm run sync`)
- Release version: [`VERSION`](VERSION) (`YY.M.D`, matching `package.json`
  and the `v*` tag)

Installing a skill is not the same as using the stages in that tool.
