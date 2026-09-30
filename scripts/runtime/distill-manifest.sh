#!/usr/bin/env bash
# scripts/runtime/distill-manifest.sh
# Write $RUN_DIR/distill/manifest — a flat key: value export for downstream
# readers (e.g. agent-relay-hub). Does not append history, edit meta.md, or
# close the run. Bash 3.2+ compatible, POSIX tools only.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESOLVE_RUN="$SCRIPT_DIR/resolve-run.sh"
RUN_STATUS="$SCRIPT_DIR/run-status.sh"

usage() {
  cat <<'EOF'
Usage:
  distill-manifest.sh <run-dir-or-id>

Write $RUN_DIR/distill/manifest (schema: 1) with run_id, distilled_at, state
(from `atry status` lifecycle), and file.<relpath>: <sha256> for every regular
file under the run dir (excluding distill/ and paths with a segment that
starts with '.' or ends in .tmp / .lock). Atomic overwrite. Exit 0 on success;
1 on usage error, unresolved run, or missing sha256 tool.
EOF
  exit 1
}

[[ $# -eq 1 ]] || usage
TARGET="$1"

sha256_file() {
  local f="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$f" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$f" | awk '{print $1}'
  else
    echo "Error: neither shasum nor sha256sum found" >&2
    return 1
  fi
}

# Return 0 if relpath should be omitted from the manifest.
skip_relpath() {
  local relpath="$1"
  local seg rest="$1"

  case "$relpath" in
  distill | distill/*) return 0 ;;
  esac

  while [[ -n "$rest" ]]; do
    case "$rest" in
    */*)
      seg="${rest%%/*}"
      rest="${rest#*/}"
      ;;
    *)
      seg="$rest"
      rest=""
      ;;
    esac
    case "$seg" in
    .* | *.tmp | *.lock) return 0 ;;
    esac
  done
  return 1
}

if ! command -v shasum >/dev/null 2>&1 && ! command -v sha256sum >/dev/null 2>&1; then
  echo "Error: neither shasum nor sha256sum found" >&2
  exit 1
fi

RUN_DIR="$("$RESOLVE_RUN" "$TARGET")"
RUN_ID="$(basename "$RUN_DIR")"
DISTILLED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

STATE="$(bash "$RUN_STATUS" "$RUN_DIR" | sed -n 's/^lifecycle:[[:space:]]*//p' | head -n 1)"
STATE="$(printf '%s' "$STATE" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
if [[ -z "$STATE" ]]; then
  echo "Error: could not read lifecycle from run-status for $RUN_DIR" >&2
  exit 1
fi

mkdir -p "$RUN_DIR/distill"
TMP="$RUN_DIR/distill/manifest.tmp.$$"
trap 'rm -f "$TMP"' EXIT

{
  printf 'schema: 1\n'
  printf 'run_id: %s\n' "$RUN_ID"
  printf 'distilled_at: %s\n' "$DISTILLED_AT"
  printf 'state: %s\n' "$STATE"

  file_count=0
  # Collect relative paths, filter, sort with C locale.
  paths=()
  while IFS= read -r rel || [[ -n "${rel:-}" ]]; do
    [[ -n "$rel" ]] || continue
    if skip_relpath "$rel"; then
      continue
    fi
    paths+=("$rel")
  done < <(
    # Paths relative to RUN_DIR; no leading ./
    (cd "$RUN_DIR" && find . -type f -print | sed 's|^\./||')
  )

  if [[ ${#paths[@]} -gt 0 ]]; then
    # Sort via printf + LC_ALL=C sort (bash 3.2 has no mapfile).
    sorted="$(printf '%s\n' "${paths[@]}" | LC_ALL=C sort)"
    while IFS= read -r rel || [[ -n "${rel:-}" ]]; do
      [[ -n "$rel" ]] || continue
      hash="$(sha256_file "$RUN_DIR/$rel")" || exit 1
      printf 'file.%s: %s\n' "$rel" "$hash"
      file_count=$((file_count + 1))
    done <<<"$sorted"
  fi
} >"$TMP"

mv "$TMP" "$RUN_DIR/distill/manifest"
trap - EXIT

echo "distill: wrote $RUN_DIR/distill/manifest ($file_count files)" >&2
exit 0
