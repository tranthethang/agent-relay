# Release

How to publish a versioned GitHub Release. Human-driven; agents should not tag
unless explicitly asked.

## Version source of truth

| File                                        | Role                                      |
| ------------------------------------------- | ----------------------------------------- |
| [`VERSION`](../VERSION)                     | Single-line `YY.M.D` (UTC; no `v` prefix) |
| [`package.json`](../package.json) `version` | Same string as `VERSION`                  |
| [`CHANGELOG.md`](../CHANGELOG.md)           | Keep-a-Changelog entry for that version   |
| Git tag                                     | Must be `v` + contents of `VERSION`       |

The release workflow refuses to build if the tag and `VERSION` disagree.

## Calendar versioning

- Version is the **UTC** calendar day of the release, with no zero padding:
  `YY.M.D` (for example `26.10.17` or `26.9.30`). Tag: `v` + that string.
- npm semver accepts this form. Do not write a leading zero on the month or
  the day (`26.09.30` is the old form).
- **One release per UTC day.** Do not create a second tag for the same UTC
  date; wait until the next UTC day.
- Re-install refreshes skill bundles and the `atry` CLI; there is no separate
  upgrade path beyond running install again.

## Maintainer checklist

1. Finish the change set; `make test` and both `sync-*.sh --check` green.
2. Confirm the UTC day is still the intended `YY.M.D`:

   ```bash
   year=$(date -u +%y)
   month=$(date -u +%m)
   day=$(date -u +%d)
   printf '%s.%s.%s\n' "$year" "${month#0}" "${day#0}"
   ```

3. Move notes from `[Unreleased]` into `## [YY.M.D] — YYYY-MM-DD` in
   `CHANGELOG.md` (honest: Added / Fixed / Changed / Removed only for what
   shipped; use the UTC date for the heading date).
4. Set `VERSION` and `package.json` `version` to that `YY.M.D`.
5. Commit on the branch you intend to tag (usually after merge to the default
   branch).
6. Create and push the annotated or lightweight tag:

   ```bash
   git tag "v$(tr -d '[:space:]' < VERSION)"
   git push origin "v$(tr -d '[:space:]' < VERSION)"
   ```

7. Workflows [`.github/workflows/release.yml`](../.github/workflows/release.yml)
   and [`.github/workflows/npm-release.yml`](../.github/workflows/npm-release.yml)
   run on `push` of `v*` tags (or `workflow_dispatch` with a tag input).
8. Confirm the GitHub Release has assets; spot-check install from the tag if
   the change touched installer/bootstrap.

## What the build produces

`scripts/maint/build-release-assets.sh [vYY.M.D]`:

1. Runs `sync-bootstrap.sh` so bin scripts match `lib/bootstrap.sh`
2. Stages a tree and packs `dist/agent-relay-vYY.M.D.tar.gz`
3. Writes `dist/install.sh`, `uninstall.sh`, `verify.sh` with `DEFAULT_REF`
   baked to that tag
4. Writes `dist/SHA256SUMS` over the tarball + those three scripts

Published by `gh release create` together with `--generate-notes`. Generated
notes are a GitHub convenience; the **authoritative** human summary remains
`CHANGELOG.md`.

## npm dist-tag `next`

[`.github/workflows/npm-release.yml`](../.github/workflows/npm-release.yml)
runs on the same `v*` tag push. It checks that the tag, `VERSION`, and
`package.json` `version` are the same unpadded `YY.M.D`. It then publishes
`@tranthethang/agent-relay` with `npm publish --provenance --access public --tag next`.

The workflow uses GitHub OIDC trusted publishing. It does not read an npm
token. Configure the trusted publisher on npmjs.com before the first publish.

## Local dry build (optional)

```bash
bash scripts/maint/build-release-assets.sh "$(tr -d '[:space:]' < VERSION)"
ls -la dist/
```

Does not publish anything.

## User install from a release

Documented in the root README. Typical shape:

```bash
REF="vYY.M.D"
curl -fLO "https://github.com/tranthethang/agent-relay/releases/download/${REF}/install.sh"
curl -fLO "https://github.com/tranthethang/agent-relay/releases/download/${REF}/SHA256SUMS"
shasum -a 256 -c SHA256SUMS
bash ./install.sh --ref "$REF"
```

Checksums detect truncation, not a malicious replacement of release assets.
See [security.md](security.md).
