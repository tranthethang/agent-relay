# Release

Calendar version `YY.M.D` (UTC day, no zero padding). `VERSION` has no `v`.
The git tag is `v` plus that string. npm requires this shape. One release per
UTC day.

The workflow
[`.github/workflows/npm-release.yml`](../.github/workflows/npm-release.yml)
runs on a `v*` tag. It publishes dist-tag `latest` with `--provenance` and the
`NPM_TOKEN` repository secret (`NODE_AUTH_TOKEN`). The job skips the publish
when `npm view @tranthethang/agent-relay@<VERSION>` already returns that
version.

The first publish is manual: `npm publish --access public --tag latest`. The
tag workflow then runs the checks and skips the publish. Each later `v*` tag
publishes. The token can expire. A failed publish job is the sign: renew the
secret and re-run the job.

1. Set the same version in `VERSION` and `package.json`. A release does not bump `requires-atry`. A skill change that needs a newer CLI bumps it.
2. Write the section in `CHANGELOG.md`.
3. Update the README install lines when the install command changes.
4. Commit those files.
5. Tag `v$(cat VERSION)` and push the tag.

The workflow refuses a tag that does not match `VERSION` and `package.json`.
It does not rewrite the README.
