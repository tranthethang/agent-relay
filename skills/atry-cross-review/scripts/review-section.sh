#!/usr/bin/env bash
# review-section.sh — upsert a dated Self-Review or Cross-Review section.
# Bash 3.2+, POSIX tools only. Never touches other sections.
#
# Section boundaries are "## " headings that are NOT inside a fenced code
# block (``` or ~~~). Review bodies routinely quote heading formats inside
# fences (see the Cross-Review "Plan amendment" example); treating those as
# real boundaries truncated the section and orphaned the rest of the body on
# the next upsert.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  review-section.sh upsert <file> <"Self-Review"|"Cross-Review"> <YYYY-MM-DD> <body-file|->

Replaces the section whose heading is "## <kind> — <date>" if present.
Otherwise inserts a new section at EOF (with a leading blank line if needed).
Other ## sections are left byte-for-byte unchanged. Headings inside fenced
code blocks are treated as content, not as section boundaries.
EOF
  exit 1
}

[[ $# -eq 5 ]] || usage
[[ "$1" == "upsert" ]] || usage
FILE="$2"
KIND="$3"
DATE="$4"
BODY_SRC="$5"

case "$KIND" in
  Self-Review|Cross-Review) ;;
  *)
    echo "Error: kind must be Self-Review or Cross-Review" >&2
    exit 1
    ;;
esac

case "$DATE" in
  [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;;
  *)
    echo "Error: date must be YYYY-MM-DD" >&2
    exit 1
    ;;
esac

HEADING="## ${KIND} — ${DATE}"

BODY_TMP="$(mktemp "${TMPDIR:-/tmp}/ar-review-body.XXXXXX")"
cleanup() { rm -f "$BODY_TMP" "${OUT_TMP:-}"; }
trap cleanup EXIT

if [[ "$BODY_SRC" == "-" ]]; then
  cat > "$BODY_TMP"
else
  [[ -f "$BODY_SRC" ]] || { echo "Error: body file '$BODY_SRC' not found" >&2; exit 1; }
  cat "$BODY_SRC" > "$BODY_TMP"
fi

# Ensure file exists
if [[ ! -f "$FILE" ]]; then
  mkdir -p "$(dirname "$FILE")"
  : > "$FILE"
fi

# The output temp file must live beside the target, not in $TMPDIR: only a
# same-filesystem rename is atomic. A cross-device mv degrades to copy+unlink,
# which is both non-atomic and outright refused on setups where the target
# directory disallows unlinking through that path.
OUT_TMP="$(mktemp "${FILE}.ar-out.XXXXXX")"

# Two passes over FILE: pass 1 records which lines sit inside a fenced code
# block; pass 2 rewrites. If fences are unbalanced the file is already
# malformed, so pass 2 falls back to fence-unaware behavior and warns rather
# than swallowing every following section.
awk -v heading="$HEADING" -v bodyfile="$BODY_TMP" '
  function is_fence(s) {
    sub(/^[ \t]*/, "", s)
    return (s ~ /^```/ || s ~ /^~~~/)
  }
  function emit_body(   line) {
    print heading
    print ""
    while ((getline line < bodyfile) > 0) print line
    close(bodyfile)
    print ""
  }
  function flush_new() {
    if (!inserted) {
      if (FNR > 1 && prev_nonempty) print ""
      emit_body()
      inserted = 1
    }
  }
  BEGIN { in_target=0; inserted=0; prev_nonempty=0; fence_open=0; unbalanced=0 }

  # ---- pass 1: record fence state per line ----
  FNR == NR {
    inside[FNR] = fence_open
    if (is_fence($0)) fence_open = !fence_open
    total = FNR
    next
  }
  FNR == 1 {
    if (fence_open) {
      unbalanced = 1
      printf "review-section: warning: unbalanced code fence in %s; falling back to fence-unaware parsing\n", FILENAME > "/dev/stderr"
    }
  }

  # ---- pass 2: rewrite ----
  { protected = (unbalanced ? 0 : inside[FNR]) }

  !protected && $0 == heading {
    flush_new()
    in_target = 1
    next
  }
  !protected && in_target && /^## / {
    in_target = 0
    # fall through: this heading belongs to the next section
  }
  {
    if (in_target) next
    print
    # Must reset on blank lines: a stuck flag makes upsert append one extra
    # blank line on every run, so repeated self-reviews are not idempotent.
    prev_nonempty = ($0 ~ /[^[:space:]]/) ? 1 : 0
  }
  END {
    if (!inserted) {
      if (total > 0 && prev_nonempty) print ""
      emit_body()
    }
  }
' "$FILE" "$FILE" > "$OUT_TMP"

mv -f "$OUT_TMP" "$FILE"
trap - EXIT
rm -f "$BODY_TMP"
