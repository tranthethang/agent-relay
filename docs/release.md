# Release

How to publish a versioned GitHub Release. Human-driven; agents should not tag
unless explicitly asked.

## Version source of truth

| File | Role |
| --- | --- |
| [`VERSION`](../VERSION) | Single-line `X.Y.Z` (no `v` prefix) |
| [`CHANGELOG.md`](../CHANGELOG.md) | Keep-a-Changelog entry for that version |
| Git tag | Must be `v` + contents of `VERSION` |

The release workflow refuses to build if the tag and `VERSION` disagree.

## Maintainer checklist

1. Finish the change set; `make test` and both `sync-*.sh --check` green.  
2. Move notes from `[Unreleased]` into `## [X.Y.Z] — YYYY-MM-DD` in
   `CHANGELOG.md` (honest: Added / Fixed / Changed / Removed only for what
   shipped).  
3. Set `VERSION` to `X.Y.Z`.  
4. Commit on the branch you intend to tag (usually after merge to the default
   branch).  
5. Create and push the annotated or lightweight tag:

   ```bash
   git tag "v$(tr -d '[:space:]' < VERSION)"
   git push origin "v$(tr -d '[:space:]' < VERSION)"
   ```

6. Workflow [`.github/workflows/release.yml`](../.github/workflows/release.yml)
   runs on `push` of `v*` tags (or `workflow_dispatch` with a tag input).  
7. Confirm the GitHub Release has assets; spot-check install from the tag if
   the change touched installer/bootstrap.

## What the build produces

`scripts/build-release-assets.sh [vX.Y.Z]`:

1. Runs `sync-bootstrap.sh` so bin scripts match `lib/bootstrap.sh`  
2. Stages a tree and packs `dist/agent-relay-vX.Y.Z.tar.gz`  
3. Writes `dist/install.sh`, `uninstall.sh`, `verify.sh` with `DEFAULT_REF`
   baked to that tag  
4. Writes `dist/SHA256SUMS` over the tarball + those three scripts  

Published by `gh release create` together with `--generate-notes`. Generated
notes are a GitHub convenience; the **authoritative** human summary remains
`CHANGELOG.md`.

## Local dry build (optional)

```bash
bash scripts/build-release-assets.sh "$(tr -d '[:space:]' < VERSION)"
ls -la dist/
```

Does not publish anything.

## User install from a release

Documented in the root README. Typical shape:

```bash
REF="vX.Y.Z"
curl -fLO "https://github.com/tranthethang/agent-relay/releases/download/${REF}/install.sh"
curl -fLO "https://github.com/tranthethang/agent-relay/releases/download/${REF}/SHA256SUMS"
shasum -a 256 -c SHA256SUMS
bash ./install.sh --ref "$REF"
```

Checksums detect truncation, not a malicious replacement of release assets.
See [security.md](security.md).

## Patch vs minor

This project uses SemVer. Recent patch example (1.0.1): installer allowlist,
`task-claim check`, advisory cross-review warning, docs — no intentional
breakage of the v1.0.0 skill-folder layout. Re-install refreshes bundles;
no separate migration doc beyond “run install again.”
