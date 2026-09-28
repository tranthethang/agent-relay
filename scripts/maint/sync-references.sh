#!/usr/bin/env bash
# scripts/maint/sync-references.sh
# Keep shared files inside skills/*/ bundles identical to their sources:
#   - docs/file-conventions.md -> skills/*/references/file-conventions.md
#   - review-*-template.md / reviewer-conduct.md
#     -> atry-self-review (canonical) <-> atry-cross-review
# Runtime helpers live under scripts/runtime/ and are installed via `atry`
# (~/.agent-relay); skill bundles must not carry scripts/.
# Usage:
#   bash scripts/maint/sync-references.sh              # update copies
#   bash scripts/maint/sync-references.sh --check       # fail if any copy drifts
#   bash scripts/maint/sync-references.sh --root DIR …  # operate on DIR (tests)
# Env: AGENT_RELAY_SYNC_ROOT — default root when --root is not passed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
if [[ -n "${AGENT_RELAY_SYNC_ROOT:-}" ]]; then
  ROOT_DIR="$(cd "$AGENT_RELAY_SYNC_ROOT" && pwd -P)"
fi

CHECK_ONLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
  --check)
    CHECK_ONLY=1
    shift
    ;;
  --root)
    if [[ $# -lt 2 || -z "${2:-}" || "$2" == --* ]]; then
      echo "Error: --root requires a directory argument" >&2
      exit 1
    fi
    ROOT_DIR="$(cd "$2" && pwd -P)"
    shift 2
    ;;
  *)
    echo "Error: unknown argument: $1" >&2
    echo "Usage: bash scripts/maint/sync-references.sh [--check] [--root DIR]" >&2
    exit 1
    ;;
  esac
done

SRC="$ROOT_DIR/docs/file-conventions.md"
SELF_REVIEW_REF="$ROOT_DIR/skills/atry-self-review/references"
CROSS_REVIEW_REF="$ROOT_DIR/skills/atry-cross-review/references"
REVIEW_TEMPLATES=(
  "review-report-template.md"
  "review-walkthrough-template.md"
  "reviewer-conduct.md"
)

[[ -f "$SRC" ]] || {
  echo "Error: $SRC not found" >&2
  exit 1
}

shopt -s nullglob
skill_dirs=("$ROOT_DIR"/skills/*/)
shopt -u nullglob

[[ ${#skill_dirs[@]} -gt 0 ]] || {
  echo "Error: no skills/*/ directories" >&2
  exit 1
}

drift=0
for d in "${skill_dirs[@]}"; do
  dest="$d/references/file-conventions.md"
  if [[ "$CHECK_ONLY" -eq 1 ]]; then
    if [[ ! -f "$dest" ]]; then
      echo "Missing: $dest" >&2
      drift=1
      continue
    fi
    if ! cmp -s "$SRC" "$dest"; then
      echo "Drift: $dest differs from docs/file-conventions.md" >&2
      drift=1
    fi
  else
    mkdir -p "$d/references"
    cp "$SRC" "$dest"
    echo "synced $dest"
  fi

  # Skill bundles must not ship scripts/ (runtime is `atry` under ~/.agent-relay).
  if [[ -d "${d}scripts" ]]; then
    if [[ "$CHECK_ONLY" -eq 1 ]]; then
      echo "Orphan: ${d}scripts/ must not exist (use atry CLI)" >&2
      drift=1
    else
      rm -rf "${d}scripts"
      echo "removed ${d}scripts/"
    fi
  fi
done

# Review templates must stay byte-identical across self-review and cross-review.
# Canonical copy lives under atry-self-review; sync copies it to atry-cross-review.
for name in "${REVIEW_TEMPLATES[@]}"; do
  src="$SELF_REVIEW_REF/$name"
  dest="$CROSS_REVIEW_REF/$name"
  if [[ "$CHECK_ONLY" -eq 1 ]]; then
    if [[ ! -f "$src" ]]; then
      echo "Missing: $src" >&2
      drift=1
      continue
    fi
    if [[ ! -f "$dest" ]]; then
      echo "Missing: $dest" >&2
      drift=1
      continue
    fi
    if ! cmp -s "$src" "$dest"; then
      echo "Drift: $dest differs from $src" >&2
      drift=1
    fi
  else
    if [[ ! -f "$src" ]]; then
      echo "Error: canonical review template missing: $src" >&2
      exit 1
    fi
    mkdir -p "$CROSS_REVIEW_REF"
    cp "$src" "$dest"
    echo "synced $dest"
  fi
done

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  if [[ "$drift" -ne 0 ]]; then
    echo "sync-references --check failed" >&2
    exit 1
  fi
  echo "sync-references: all bundle references match their sources (no skill scripts/)"
fi
