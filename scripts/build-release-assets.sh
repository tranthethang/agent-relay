#!/usr/bin/env bash
# scripts/build-release-assets.sh
#
# Builds distribution release assets in dist/:
#   - dist/agent-relay-vX.Y.Z.tar.gz (tarball with prefix agent-relay-vX.Y.Z/)
#   - dist/install.sh   (with DEFAULT_REF=vX.Y.Z baked in)
#   - dist/uninstall.sh (with DEFAULT_REF=vX.Y.Z baked in)
#   - dist/verify.sh    (with DEFAULT_REF=vX.Y.Z baked in)
#   - dist/SHA256SUMS   (checksums for tarball and scripts)
#
# Usage:
#   bash scripts/build-release-assets.sh [vX.Y.Z]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

VERSION_ARG="${1:-}"
if [[ -z "$VERSION_ARG" ]]; then
  if [[ -f "$ROOT_DIR/VERSION" ]]; then
    VERSION_ARG="$(tr -d '[:space:]' < "$ROOT_DIR/VERSION")"
  else
    echo "Error: VERSION file not found and no version passed as argument." >&2
    exit 1
  fi
fi

# Ensure version has 'v' prefix for release tag, or strip for version string
if [[ "$VERSION_ARG" == v* ]]; then
  TAG="$VERSION_ARG"
  VER="${VERSION_ARG#v}"
else
  VER="$VERSION_ARG"
  TAG="v$VERSION_ARG"
fi

echo "Building release assets for $TAG (version $VER)..."

# Ensure bootstrap is synced first
bash "$ROOT_DIR/scripts/sync-bootstrap.sh"

DIST_DIR="$ROOT_DIR/dist"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# 1. Build tarball with prefix agent-relay-vX.Y.Z/
PREFIX="agent-relay-$TAG"
TARBALL_NAME="agent-relay-$TAG.tar.gz"
TARBALL_PATH="$DIST_DIR/$TARBALL_NAME"

STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agent-relay-stage.XXXXXX")"
cleanup() {
  rm -rf "$STAGE_DIR"
}
trap cleanup EXIT INT TERM

TARGET_STAGE="$STAGE_DIR/$PREFIX"
mkdir -p "$TARGET_STAGE"

# Copy required repo contents into target stage
cp -R "$ROOT_DIR/skills" "$TARGET_STAGE/"
cp "$ROOT_DIR/targets.conf" "$TARGET_STAGE/"
cp -R "$ROOT_DIR/templates" "$TARGET_STAGE/"
cp -R "$ROOT_DIR/scripts" "$TARGET_STAGE/"
cp -R "$ROOT_DIR/lib" "$TARGET_STAGE/"
mkdir -p "$TARGET_STAGE/bin"
cp "$ROOT_DIR/bin/install.sh" "$TARGET_STAGE/bin/"
cp "$ROOT_DIR/bin/uninstall.sh" "$TARGET_STAGE/bin/"
cp "$ROOT_DIR/bin/verify.sh" "$TARGET_STAGE/bin/"
cp -R "$ROOT_DIR/docs" "$TARGET_STAGE/"
cp "$ROOT_DIR/VERSION" "$TARGET_STAGE/"
cp "$ROOT_DIR/LICENSE" "$TARGET_STAGE/"
cp "$ROOT_DIR/README.md" "$TARGET_STAGE/"

tar -czf "$TARBALL_PATH" -C "$STAGE_DIR" "$PREFIX"
echo "Created $TARBALL_PATH"

# 2. Build release install.sh, uninstall.sh, verify.sh with DEFAULT_REF baked in
for script in install.sh uninstall.sh verify.sh; do
  dest="$DIST_DIR/$script"
  sed "s/^DEFAULT_REF=\"\"/DEFAULT_REF=\"$TAG\"/" "$ROOT_DIR/bin/$script" > "$dest"
  chmod +x "$dest"
  echo "Created $dest (DEFAULT_REF=$TAG)"
done

# 3. Generate SHA256SUMS
(
  cd "$DIST_DIR"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$TARBALL_NAME" install.sh uninstall.sh verify.sh > SHA256SUMS
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$TARBALL_NAME" install.sh uninstall.sh verify.sh > SHA256SUMS
  else
    echo "Error: neither shasum nor sha256sum found." >&2
    exit 1
  fi
)
echo "Created $DIST_DIR/SHA256SUMS"
cat "$DIST_DIR/SHA256SUMS"

echo "Release assets successfully built in $DIST_DIR"
