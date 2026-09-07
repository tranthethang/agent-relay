#!/usr/bin/env bash
# scripts/sync-bootstrap.sh
#
# Synchronizes the bootstrap functions from lib/bootstrap.sh into
# install.sh, uninstall.sh, and verify.sh between the markers:
#   # BEGIN BOOTSTRAP
#   # END BOOTSTRAP
#
# Usage:
#   bash scripts/sync-bootstrap.sh         # update scripts
#   bash scripts/sync-bootstrap.sh --check # verify scripts are in sync

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LIB_FILE="$ROOT_DIR/lib/bootstrap.sh"

if [[ ! -f "$LIB_FILE" ]]; then
  echo "Error: $LIB_FILE not found." >&2
  exit 1
fi

TARGETS=(
  "$ROOT_DIR/install.sh"
  "$ROOT_DIR/uninstall.sh"
  "$ROOT_DIR/verify.sh"
)

CHECK_ONLY=0
if [[ "${1:-}" == "--check" ]]; then
  CHECK_ONLY=1
fi

tmp_bootstrap="$(mktemp "${TMPDIR:-/tmp}/sync-bootstrap.XXXXXX")"
cleanup() {
  rm -f "$tmp_bootstrap"
}
trap cleanup EXIT INT TERM

# Extract the bootstrap code to sync (strip shebang and header comments)
awk '
  /^# Requires: bash/ { in_code=1; next }
  in_code { print }
' "$LIB_FILE" > "$tmp_bootstrap"

# Fallback if empty
if [[ ! -s "$tmp_bootstrap" ]]; then
  awk 'NR>1 { print }' "$LIB_FILE" > "$tmp_bootstrap"
fi

new_hash="$(shasum -a 256 "$tmp_bootstrap" | awk '{print $1}')"
any_diff=0

for target in "${TARGETS[@]}"; do
  if [[ ! -f "$target" ]]; then
    echo "Warning: target $target not found." >&2
    continue
  fi

  if ! grep -q "# BEGIN BOOTSTRAP" "$target" || ! grep -q "# END BOOTSTRAP" "$target"; then
    echo "Error: Missing # BEGIN BOOTSTRAP / # END BOOTSTRAP markers in $target" >&2
    exit 1
  fi

  # Extract existing block to a temp file
  tmp_existing="$(mktemp "${TMPDIR:-/tmp}/existing-block.XXXXXX")"
  awk '
    /# BEGIN BOOTSTRAP/ { in_block=1; next }
    /# END BOOTSTRAP/ { in_block=0 }
    in_block { print }
  ' "$target" > "$tmp_existing"

  existing_hash="$(shasum -a 256 "$tmp_existing" | awk '{print $1}')"
  rm -f "$tmp_existing"

  if [[ "$existing_hash" != "$new_hash" ]]; then
    if [[ "$CHECK_ONLY" -eq 1 ]]; then
      echo "Out of sync: $target does not match lib/bootstrap.sh" >&2
      any_diff=1
    else
      tmp_out="$(mktemp "${TMPDIR:-/tmp}/target-out.XXXXXX")"
      in_block=0
      while IFS= read -r line || [[ -n "$line" ]]; do
        if [[ "$line" == *"# BEGIN BOOTSTRAP"* ]]; then
          echo "$line"
          cat "$tmp_bootstrap"
          in_block=1
        elif [[ "$line" == *"# END BOOTSTRAP"* ]]; then
          in_block=0
          echo "$line"
        elif [[ $in_block -eq 0 ]]; then
          echo "$line"
        fi
      done < "$target" > "$tmp_out"

      mv "$tmp_out" "$target"
      chmod +x "$target"
      echo "Synced bootstrap into $target"
    fi
  fi
done

if [[ "$CHECK_ONLY" -eq 1 && "$any_diff" -ne 0 ]]; then
  echo "Error: Bootstrap blocks are out of sync. Run 'bash scripts/sync-bootstrap.sh' to update." >&2
  exit 1
fi

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  echo "All bootstrap blocks are in sync."
fi
