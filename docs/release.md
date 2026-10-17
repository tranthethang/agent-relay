# Release

Calendar version `YY.M.D` (UTC day, no zero padding). `VERSION` has no `v`.
The git tag is `v` plus that string. npm requires this shape. One release per
UTC day.

Publish uses npm trusted publishing (OIDC, provenance). The workflow
[`.github/workflows/npm-release.yml`](../.github/workflows/npm-release.yml)
runs on a `v*` tag and publishes dist-tag `latest`.

1. Set the same version in `VERSION` and `package.json`. A release does not bump `requires-atry`. A skill change that needs a newer CLI bumps it.
2. Write the section in `CHANGELOG.md`.
3. Update the README install lines when the install command changes.
4. Commit those files.
5. Tag `v$(cat VERSION)` and push the tag.

The workflow refuses a tag that does not match `VERSION` and `package.json`.
It does not rewrite the README.
