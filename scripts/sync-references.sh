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

get_skill_scripts() {
  local skill_name="$1"
  case "$skill_name" in
    atry-plan)
      printf '%s\n' "resolve-run.sh" "run-init.sh" "run-history.sh"
      ;;
    atry-implement)
      printf '%s\n' "resolve-run.sh" "run-init.sh" "run-history.sh" "run-migrate.sh" "task-init.sh" "task-claim.sh"
      ;;
    atry-self-review|atry-cross-review)
      printf '%s\n' "resolve-run.sh" "run-history.sh" "review-section.sh"
      ;;
  esac
}

# Bundle scripts must match scripts/<name> byte-for-byte. The bundle copy is
# what users actually run, so a silent divergence ships broken helpers.
for d in "${skill_dirs[@]}"; do
  skill_name="$(basename "$d")"
  expected_scripts=()
  while IFS= read -r s; do
    [[ -n "$s" ]] && expected_scripts+=("$s")
  done < <(get_skill_scripts "$skill_name")

  if [[ "$CHECK_ONLY" -eq 1 ]]; then
    for s in "${expected_scripts[@]}"; do
      dest="$d/scripts/$s"
      src="$ROOT_DIR/scripts/$s"
      if [[ ! -f "$dest" ]]; then
        echo "Missing: $dest" >&2
        drift=1
        continue
      fi
      if ! cmp -s "$src" "$dest"; then
        echo "Drift: $dest differs from scripts/$s" >&2
        drift=1
      fi
    done

    # Check for orphan scripts in bundle
    shopt -s nullglob
    actual_scripts=("$d"scripts/*.sh)
    shopt -u nullglob
    for as in "${actual_scripts[@]}"; do
      base="${as##*/}"
      found=0
      for exp in "${expected_scripts[@]}"; do
        if [[ "$exp" == "$base" ]]; then
          found=1
          break
        fi
      done
      if [[ "$found" -eq 0 ]]; then
        echo "Orphan: $as is not in expected scripts for $skill_name" >&2
        drift=1
      fi
    done
  else
    if [[ ${#expected_scripts[@]} -gt 0 ]]; then
      mkdir -p "$d/scripts"
      for s in "${expected_scripts[@]}"; do
        src="$ROOT_DIR/scripts/$s"
        dest="$d/scripts/$s"
        cp "$src" "$dest"
        chmod +x "$dest"
        echo "synced $dest"
      done
    fi
  fi
done

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  if [[ "$drift" -ne 0 ]]; then
    echo "sync-references --check failed" >&2
    exit 1
  fi
  echo "sync-references: all bundle references and scripts match their sources"
fi
