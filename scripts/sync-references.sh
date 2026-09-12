#!/usr/bin/env bash
# scripts/sync-references.sh
# Keep the shared files inside skills/*/ bundles identical to their source:
#   - docs/file-conventions.md -> skills/*/references/file-conventions.md
#   - scripts/<name>.sh        -> skills/*/scripts/<name>.sh
# Bundles deliberately carry copies (each skill must be self-contained), so a
# --check gate is the only thing keeping those copies from drifting.
# Usage:
#   bash scripts/sync-references.sh         # update copies
#   bash scripts/sync-references.sh --check # fail if any copy drifts
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$ROOT_DIR/docs/file-conventions.md"

CHECK_ONLY=0
if [[ "${1:-}" == "--check" ]]; then
  CHECK_ONLY=1
fi

[[ -f "$SRC" ]] || { echo "Error: $SRC not found" >&2; exit 1; }

shopt -s nullglob
skill_dirs=("$ROOT_DIR"/skills/*/)
shopt -u nullglob

[[ ${#skill_dirs[@]} -gt 0 ]] || { echo "Error: no skills/*/ directories" >&2; exit 1; }

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
done

# Bundle scripts must match scripts/<name> byte-for-byte. The bundle copy is
# what users actually run, so a silent divergence ships broken helpers.
for d in "${skill_dirs[@]}"; do
  shopt -s nullglob
  bundle_scripts=("$d"scripts/*.sh)
  shopt -u nullglob
  # bash 3.2 + set -u errors on an empty "${arr[@]}" (atry-plan has no scripts/)
  [[ ${#bundle_scripts[@]} -eq 0 ]] && continue
  for bs in "${bundle_scripts[@]}"; do
    base="${bs##*/}"
    src="$ROOT_DIR/scripts/$base"
    if [[ ! -f "$src" ]]; then
      echo "Orphan: $bs has no source at scripts/$base" >&2
      drift=1
      continue
    fi
    if [[ "$CHECK_ONLY" -eq 1 ]]; then
      if ! cmp -s "$src" "$bs"; then
        echo "Drift: $bs differs from scripts/$base" >&2
        drift=1
      fi
    else
      cp "$src" "$bs"
      chmod +x "$bs"
      echo "synced $bs"
    fi
  done
done

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  if [[ "$drift" -ne 0 ]]; then
    echo "sync-references --check failed" >&2
    exit 1
  fi
  echo "sync-references: all bundle references and scripts match their sources"
fi
