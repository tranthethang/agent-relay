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
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESOLVE_RUN="$SCRIPT_DIR/resolve-run.sh"

FILE="$2"
# When the target path does not exist yet, resolve the run dir but keep the
# caller's basename (review-report.md vs review-walkthrough.md). Previously
# any missing path was rewritten to review-report.md, so the first walkthrough
# upsert clobbered the report.
if [[ -d "$FILE" ]]; then
  FILE="$FILE/review-report.md"
elif [[ ! -f "$FILE" && -x "$RESOLVE_RUN" ]]; then
  want_name="$(basename "$FILE")"
  case "$want_name" in
    review-report.md|review-walkthrough.md) ;;
    *) want_name="review-report.md" ;;
  esac
  resolved="$("$RESOLVE_RUN" "$FILE" 2>/dev/null || true)"
  if [[ -n "$resolved" && -d "$resolved" && "$(basename "$resolved")" != ".agent-relay" ]]; then
    FILE="$resolved/$want_name"
  fi
fi

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

# Non-blocking heads-up: a Cross-Review whose own provenance tool/model
# matches the most recently written Self-Review provenance in this same file
# is not actually a second opinion from a different tool -- the whole point
# of cross-review per the skill docs. This cannot be enforced (nothing here
# can verify which tool is really calling it), so it only warns.
if [[ "$KIND" == "Cross-Review" ]]; then
  new_prov="$(grep -m 1 -E '<!-- relay: stage=cross-review ' "$BODY_TMP" 2>/dev/null || true)"
  if [[ -n "$new_prov" ]]; then
    new_tool="$(printf '%s' "$new_prov" | sed -n 's/.* tool=\([^ ]*\).*/\1/p')"
    new_model="$(printf '%s' "$new_prov" | sed -n 's/.* model=\([^ ]*\).*/\1/p')"
    if [[ -f "$FILE" && -n "$new_tool" && "$new_tool" != "unknown" ]]; then
      # Fence-aware: only trust a provenance line that immediately follows a
      # real (unfenced) "## Self-Review — ..." heading. A plain grep over the
      # whole file would also match an example provenance line quoted inside
      # a fenced code block (the awk rewrite below has the same gotcha for
      # headings, documented at the top of this file) and warn on a false
      # match.
      prev_prov="$(awk '
        function leading_ws(s,   n) {
          n = 0
          while (substr(s, n + 1, 1) == " " || substr(s, n + 1, 1) == "\t") n++
          return n
        }
        function fence_match(s,   indent, rest, i, ch, len) {
          indent = leading_ws(s)
          rest = substr(s, indent + 1)
          if (rest == "") return 0
          ch = substr(rest, 1, 1)
          if (ch != "`" && ch != "~") return 0
          len = 1
          for (i = 2; i <= length(rest); i++) {
            if (substr(rest, i, 1) != ch) break
            len++
          }
          if (len < 3) return 0
          fence_indent = indent
          fence_char = ch
          fence_len = len
          fence_rest = substr(rest, len + 1)
          return 1
        }
        BEGIN { fence = 0; capture = 0; prov = ""; open_indent=0; open_char=""; open_len=0 }
        {
          if (fence_match($0)) {
            if (!fence) {
              fence = 1
              open_indent = fence_indent
              open_char = fence_char
              open_len = fence_len
              next
            } else if (fence_char == open_char && fence_len >= open_len && fence_indent <= open_indent && fence_rest ~ /^[ \t]*$/) {
              fence = 0
              open_indent = 0
              open_char = ""
              open_len = 0
              next
            }
          }
          if (!fence && $0 ~ /^## Self-Review — /) { capture = 1; next }
          if (capture && !fence) {
            if ($0 ~ /^<!-- relay: stage=self-review /) { prov = $0; capture = 0 }
            else if ($0 !~ /^[ 	]*$/) { capture = 0 }
          }
        }
        END { if (prov != "") print prov }
      ' "$FILE")"
      if [[ -n "$prev_prov" ]]; then
        prev_tool="$(printf '%s' "$prev_prov" | sed -n 's/.* tool=\([^ ]*\).*/\1/p')"
        prev_model="$(printf '%s' "$prev_prov" | sed -n 's/.* model=\([^ ]*\).*/\1/p')"
        if [[ "$new_tool" == "$prev_tool" && "$new_model" == "$prev_model" ]]; then
          printf 'review-section: warning: Cross-Review provenance (tool=%s model=%s) matches the most recent Self-Review in %s -- this is not a genuine second opinion from a different tool/model.\n' \
            "$new_tool" "$new_model" "$FILE" >&2
        fi
      fi
    fi
  fi
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
#
# Fence rules (CommonMark-ish): an opening fence records character (` or ~),
# run length (>=3), and leading indentation. A closing fence must use the
# same character, be at least as long, and not be more indented than the
# opener. Nested different-length/different-char "fences" inside a block are
# treated as content.
awk -v heading="$HEADING" -v bodyfile="$BODY_TMP" '
  function leading_ws(s,   n) {
    n = 0
    while (substr(s, n + 1, 1) == " " || substr(s, n + 1, 1) == "\t") n++
    return n
  }
  function fence_match(s,   indent, rest, i, ch, len) {
    # Sets fence_indent, fence_char, fence_len when s is a fence line.
    # Returns 1 if fence, 0 otherwise.
    indent = leading_ws(s)
    rest = substr(s, indent + 1)
    if (rest == "") return 0
    ch = substr(rest, 1, 1)
    if (ch != "`" && ch != "~") return 0
    len = 1
    for (i = 2; i <= length(rest); i++) {
      if (substr(rest, i, 1) != ch) break
      len++
    }
    if (len < 3) return 0
    # Info string may follow; closing fences reject non-space after the run
    # only when we are already open (checked by caller via expect_close).
    fence_indent = indent
    fence_char = ch
    fence_len = len
    fence_rest = substr(rest, len + 1)
    return 1
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
  BEGIN {
    in_target=0; inserted=0; prev_nonempty=0
    fence_open=0; unbalanced=0
    open_indent=0; open_char=""; open_len=0
  }

  # ---- pass 1: record fence state per line ----
  FNR == NR {
    inside[FNR] = fence_open
    if (fence_match($0)) {
      if (!fence_open) {
        # Opening fence: info string allowed after the run.
        fence_open = 1
        open_indent = fence_indent
        open_char = fence_char
        open_len = fence_len
      } else if (fence_char == open_char && fence_len >= open_len && fence_indent <= open_indent) {
        # Closing fence: same char, long enough, not more indented; no info string.
        if (fence_rest ~ /^[ \t]*$/) {
          fence_open = 0
          open_indent = 0
          open_char = ""
          open_len = 0
        }
      }
    }
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
