# Contributing

Constraints for editing this repo are in [`AGENTS.md`](AGENTS.md). Maintainer
guides start at [`specs/90-maintainer/00-index/index.md`](specs/90-maintainer/00-index/index.md).

## Quick start

```bash
git clone https://github.com/tranthethang/agent-relay.git
cd agent-relay
npm ci
git config core.hooksPath .githooks
npm test
```

Install the skills into a tool with `npx skills add` when you want to dogfood
them. See [`specs/90-maintainer/10-install/installer.md`](specs/90-maintainer/10-install/installer.md).

## Local build

```bash
npm ci
npm run build
node dist/atry.js version
```

`package.json` in git stays at `0.0.0`, so `npm run build` writes the version
used by the bundle into `dist/package.json`. `node dist/atry.js version` prints
`0.10.7-dev` and a `dev build` line. The `atry` binary on `PATH` is the
installed CLI, and it does not read this build.

`node dist/atry.js preflight` refuses a dev build until you consent.
While you dogfood the CLI you built, set `ATRY_DEV=1` or pass `--allow-dev`:

```bash
ATRY_DEV=1 node dist/atry.js preflight --requires ">=0.10.7"
node dist/atry.js preflight --requires ">=0.10.7" --allow-dev
```

A release build sets a real version before the build and prints no marker.

## Tests

Detail: [`specs/90-maintainer/20-testing/testing.md`](specs/90-maintainer/20-testing/testing.md).

```bash
npm test
npm run check
npm run sync:check
npm run evals
```

CI runs `npm test` on macOS, Linux, and Windows. It also checks formatting
and skill-reference sync. It also runs `npm run evals`, the deterministic skill
layer under `evals/`.

## Formatting

```bash
brew install dprint
brew install sonar-scanner
make fmt
make fmt-check
```

`sonar-scanner` is required by `npm run coverage`. Set `SONAR_HOST_URL` and
`SONAR_TOKEN` in the environment. Do not commit the token.

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
