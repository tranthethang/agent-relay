# Release

The version is `X.M.Z`. The git tag is `vX.M.Z`.

- `X` starts at `0`. It changes only when the workflow input `major` is true.
- `M` is the month of the release in `Asia/Ho_Chi_Minh`. It is `1` to `12`, with no zero padding.
- `Z` is the release count in that month. It is `0` to `99`.

The next version comes from the highest matching tag:

- No tag yet: `0.M.0`.
- `major` true: `X+1.M.0`.
- Same month as the highest tag: `X.M.Z+1`.
- A different month: `X.M.0`.

The workflow refuses when `Z` would pass `99`. It refuses when the new version is not higher than the highest tag. Set `major` to true in that case. January after December is the usual case. It refuses when any `v*` tag does not match `vX.M.Z`.

`package.json` in git stays `0.0.0`. Tags are the only source of the version. There is no version file.

## Run the workflow

Open the Actions tab. Run [`.github/workflows/release.yml`](../../../.github/workflows/release.yml) on `main`. Leave `major` false unless `X` must rise.

The job installs dependencies first, because the version script imports `src/core/error.ts`, which imports `zod`. It sets `TZ=Asia/Ho_Chi_Minh` and computes the version with `scripts/maint/next-version.ts`. It checks `requires-atry` against that version. It sets `npm version <v> --no-git-tag-version` before the build, so the bundle and `dist/package.json` hold the release version. It checks format and types, builds, inspects the tarball, and tests. It then pushes tag `v<v>`, publishes, and creates a GitHub Release with generated notes. It does not commit to the repo.

A `smoke` job runs after `publish`. It installs `@tranthethang/agent-relay@<v>` into a temporary prefix and puts that prefix on `PATH`. It runs `atry version`, `atry preflight --requires ">=0.10.7"`, `atry skills install --tool claude-code --dir <tmp>/skills`, and `atry skills status --dir <tmp>/skills`. It fails when the version differs, preflight fails, status fails, or the bundle count is not six. The CLI and the six bundles are one version. The release is complete only after that job passes; a green `publish` job alone is not a release.

## Release evidence

Record these before you call a release done:

- `npm test`, `npm run check`, `npm run sync:check`, and `npm run evals`.
- The real CLI eval result from `evals/real.ts`.
- `npm run coverage:report`.
- `atry skills status` for the release bundle.
- The post-publish smoke result.
- A strict close for the release run, or a recorded reason for every waiver.

The P1 and P2 runs closed with warnings. Those warnings are historical. Do not use them as release evidence, and do not treat the fake 9/9 result as proof of behavior.

A release does not bump `requires-atry`. A skill change that needs a newer CLI bumps it. The shared value lives in `scripts/maint/next-version.ts` as `skillMinimumVersion`; the tests refuse a skill whose `requires-atry` is a different range. The workflow refuses when `requires-atry` is higher than the new version.

## Trusted publishing

The workflow publishes with npm trusted publishing (OIDC). There is no npm token and no repository secret. npm no longer lets a token that bypasses 2FA publish directly.

On npmjs.com, open the package settings. Under Trusted Publisher, add GitHub Actions with user `tranthethang`, repository `agent-relay`, and workflow `release.yml`. The job has `id-token: write` and installs npm 11.15.0 before it publishes, because trusted publishing needs npm 11.5.1 or newer.

The first publish of a new package cannot use trusted publishing. Publish it once by hand with `npm publish --access public`, then add the trusted publisher.

A tag without a publish is safe. The next release takes the next number.

Release notes are the GitHub Releases for this repository.
