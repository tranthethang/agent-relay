# Contributing

Constraints for editing this repo are in [`AGENTS.md`](AGENTS.md). Maintainer
guides start at [`specs/90-maintainer/00-index/index.md`](specs/90-maintainer/00-index/index.md).

## Quick start

```bash
git clone https://github.com/tranthethang/agent-relay.git
cd agent-relay
npm ci
npm test
```

Install the skills into a tool with `npx skills add` when you want to dogfood
them. See [`specs/90-maintainer/10-install/installer.md`](specs/90-maintainer/10-install/installer.md).

## Tests

Detail: [`specs/90-maintainer/20-testing/testing.md`](specs/90-maintainer/20-testing/testing.md).

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
under `specs/70-storage-and-git/00-directory-conventions/`, then run `make fmt`
and `npm run sync`, so the skill copies match.

## Where things live

- Skill bundles: `skills/<name>/`
- CLI: `src/` and the published `dist/atry.js`
- Tests: `test/`
- Maintainer sync: `scripts/maint/sync-references.ts` (`npm run sync`)
- Release version: `X.M.Z` from git tags. `package.json` in git stays `0.0.0`. Notes are the [GitHub Releases](https://github.com/tranthethang/agent-relay/releases).

Installing a skill is not the same as using the stages in that tool.
