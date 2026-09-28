# Release

How to publish a versioned GitHub Release. Human-driven; agents should not tag
unless explicitly asked.

## Version source of truth

| File                              | Role                                         |
| --------------------------------- | -------------------------------------------- |
| [`VERSION`](../VERSION)           | Single-line `YY.MM.DD` (UTC; no `v` prefix)  |
| [`CHANGELOG.md`](../CHANGELOG.md) | Keep-a-Changelog entry for that version      |
| Git tag                           | Must be `v` + contents of `VERSION`          |

The release workflow refuses to build if the tag and `VERSION` disagree.

## Calendar versioning

- Version is the **UTC** calendar day of the release: `date -u +%y.%m.%d`
  (zero-padded), e.g. `26.09.28`. Tag: `v26.09.28`.
- **One release per UTC day.** Do not create a second tag for the same UTC
  date; wait until the next UTC day.
- Re-install refreshes skill bundles and the `atry` CLI; there is no separate
  upgrade path beyond running install again.

## Maintainer checklist

1. Finish the change set; `make test` and both `sync-*.sh --check` green.
2. Confirm the UTC day is still the intended `YY.MM.DD` (`date -u +%y.%m.%d`).
3. Move notes from `[Unreleased]` into `## [YY.MM.DD] — YYYY-MM-DD` in
   `CHANGELOG.md` (honest: Added / Fixed / Changed / Removed only for what
   shipped; use the UTC date for the heading date).
4. Set `VERSION` to that `YY.MM.DD`.
5. Commit on the branch you intend to tag (usually after merge to the default
   branch).
6. Create and push the annotated or lightweight tag:

   ```bash
   git tag "v$(tr -d '[:space:]' < VERSION)"
   git push origin "v$(tr -d '[:space:]' < VERSION)"
   ```

7. Workflow [`.github/workflows/release.yml`](../.github/workflows/release.yml)
   runs on `push` of `v*` tags (or `workflow_dispatch` with a tag input).
8. Confirm the GitHub Release has assets; spot-check install from the tag if
   the change touched installer/bootstrap.

## What the build produces

`scripts/maint/build-release-assets.sh [vYY.MM.DD]`:

1. Runs `sync-bootstrap.sh` so bin scripts match `lib/bootstrap.sh`
2. Stages a tree and packs `dist/agent-relay-vYY.MM.DD.tar.gz`
3. Writes `dist/install.sh`, `uninstall.sh`, `verify.sh` with `DEFAULT_REF`
   baked to that tag
4. Writes `dist/SHA256SUMS` over the tarball + those three scripts

Published by `gh release create` together with `--generate-notes`. Generated
notes are a GitHub convenience; the **authoritative** human summary remains
`CHANGELOG.md`.

## Local dry build (optional)

```bash
bash scripts/maint/build-release-assets.sh "$(tr -d '[:space:]' < VERSION)"
ls -la dist/
```

Does not publish anything.

## User install from a release

Documented in the root README. Typical shape:

```bash
REF="vYY.MM.DD"
curl -fLO "https://github.com/tranthethang/agent-relay/releases/download/${REF}/install.sh"
curl -fLO "https://github.com/tranthethang/agent-relay/releases/download/${REF}/SHA256SUMS"
shasum -a 256 -c SHA256SUMS
bash ./install.sh --ref "$REF"
```

Checksums detect truncation, not a malicious replacement of release assets.
See [security.md](security.md).
