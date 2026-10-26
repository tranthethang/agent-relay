# Contributing

Constraints for editing this repo are in [`AGENTS.md`](AGENTS.md). Maintainer
guides start at [`specs/90-maintainer/00-index/index.md`](specs/90-maintainer/00-index/index.md).
Report a vulnerability through [`SECURITY.md`](SECURITY.md).

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
a `-dev` version and a `dev build` line. The `atry` binary on `PATH` is the
installed CLI, and it does not read this build.

`node dist/atry.js preflight` refuses a dev build until you consent.
While you dogfood the CLI you built, set `ATRY_DEV=1` or pass `--allow-dev`:

```bash
ATRY_DEV=1 node dist/atry.js preflight --requires "<floor>"
node dist/atry.js preflight --requires "<floor>" --allow-dev
```

`<floor>` is `>=` plus `skillMinimumVersion` in `scripts/maint/next-version.ts`.
`npm run sync` writes it into the skills, the smoke action, and the evals.
A release build sets a real version before the build and prints no marker.

## Release

The release workflow computes `X.M.Z`, checks `requires-atry`, and sets the
package version before the build. It then checks format and types, builds,
inspects the tarball, and tests. It publishes one version for the CLI and the
six bundles. Do not lower `requires-atry` to make a release pass.

A post-publish job installs the published tarball into a temporary prefix. It
runs `atry version`, `atry preflight --requires "<floor>"`,
`atry skills install`, and `atry skills status`. It fails on a version
mismatch, a preflight failure, a status failure, or a bundle count other than
six. The release is complete only after that job passes.

Release evidence:

- `npm test`, `npm run check`, `npm run sync:check`, and `npm run evals`.
- The real CLI eval result.
- `npm run coverage:report`.
- `atry skills status` for the release bundle.
- The post-publish smoke result.
- A strict close for the release run, or a recorded reason for every waiver.

The P1 and P2 runs closed with warnings. Those warnings are historical. Do not
use them as release evidence, and do not treat the fake 9/9 result as proof of
behavior.

## Tests

Detail: [`specs/90-maintainer/20-testing/testing.md`](specs/90-maintainer/20-testing/testing.md).

```bash
npm test
npm run check
npm run sync:check
npm run evals
```

CI runs `npm test` on macOS, Linux, and Windows. It also checks formatting
and skill-reference sync. It also runs `npm run evals`, which drives the fake
layer and the real CLI layer under `evals/`. The fake layer checks the command
surface and the token budget. The real layer is the behavioral check and the
release evidence: it drives the built CLI in a temporary repository. Neither
layer calls a model, and neither proves that an agent followed a skill. Linux
CI also runs `npm run coverage:report`.

## Formatting

```bash
brew install dprint
brew install sonar-scanner
make fmt
make fmt-check
```

`npm run coverage:report` checks the coverage bars. It does not call Sonar.
`npm run coverage:sonar` runs that report, then the duplication check.
`sonar-scanner` is required by `npm run coverage:sonar`. Set `SONAR_HOST_URL` and
`SONAR_TOKEN` in the environment. Do not commit the token.

`dprint.json` formats TypeScript, markdown, and yaml. Edit convention parts
under `specs/70-storage-and-git/00-directory-conventions/`, then run `make fmt`
and `npm run sync`, so the skill copies match.

## Dogfood policy

- This repo commits `.agent-relay.json` with `testCommand: "npm test"` and `strict.scope: true`.
- The Claude Code hook denies an edit outside the task files during implement.
- Record each friction in the implement report or the review file, on one line that starts with `friction:`.
- `test/dogfood-policy.test.ts` enforces `strict.scope` and `testCommand`. CI runs it through `npm test`.
- Do not turn off a strict group to finish a run. Record the friction and use `--allow-extra <reason>` when the user agrees.

## Where things live

- Skill bundles: `skills/<name>/`
- CLI: `src/` and the published `dist/atry.js`
- Tests: `test/`
- Maintainer sync: `scripts/maint/sync-references.ts` (`npm run sync`)
- Release version: `X.M.Z` from git tags. `package.json` in git stays `0.0.0`. Notes are the [GitHub Releases](https://github.com/tranthethang/agent-relay/releases).

Installing a skill is not the same as using the stages in that tool.
