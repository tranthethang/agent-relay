#!/usr/bin/env bash
# scripts/runtime/bank-set-status.sh
# Edit only lifecycle fields (status, and optionally superseded_by /
# resolved_by) on an existing note already in BANK_PATH. The run-dir copy
# is never touched. See docs/bank.md and note-schema.md.
#
# Bash 3.2+ compatible, POSIX tools only. Touches only the first
# --- … --- frontmatter block.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bank-set-status.sh <start-dir> <filename> <status> [--by <filename>]

<start-dir>   Anywhere under the target repo (same lookup as bank-check.sh).
<filename>    Basename of a note already in BANK_PATH (not a path).
<status>      New status; allowed values depend on the note's type.
--by <file>   Optional companion filename when setting superseded or resolved;
              writes superseded_by or resolved_by accordingly.

Exit 0: frontmatter updated.
Exit 1: bad arguments, missing/unreadable note, type/status mismatch, or
        missing bank-status.md.
Exit 2: bank not configured/reachable, or no .agent-relay/ / git repository.
EOF
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/runtime/find-agent-relay-dir.sh
source "$SCRIPT_DIR/find-agent-relay-dir.sh"

BY_FILE=""
ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
  --by)
    shift
    [[ $# -ge 1 ]] || {
      echo "Error: --by requires a filename" >&2
      exit 1
    }
    BY_FILE="$1"
    shift
    ;;
  -h | --help) usage ;;
  *)
    ARGS+=("$1")
    shift
    ;;
  esac
done

[[ ${#ARGS[@]} -eq 3 ]] || usage
START_DIR="${ARGS[0]}"
FILENAME="${ARGS[1]}"
NEW_STATUS="${ARGS[2]}"

[[ -d "$START_DIR" ]] || {
  echo "Error: not a directory: $START_DIR" >&2
  exit 1
}

# Filename must be a basename matching the note name rule (no path separators).
case "$FILENAME" in
*/* | *'\\'*)
  echo "Error: filename must be a basename, not a path: $FILENAME" >&2
  exit 1
  ;;
esac
NOTE_NAME_RE='^[0-9]{8}-[0-9]{10,11}-[a-z]+(-[a-z]+)*\.md$'

valid_note_slug() {
  local s="$1"
  local len=${#s}
  if [[ "$len" -lt 3 || "$len" -gt 48 ]]; then
    return 1
  fi
  [[ "$s" =~ ^[a-z]+(-[a-z]+)*$ ]]
}

note_filename_ok() {
  local name="$1" stem slug
  [[ "$name" =~ $NOTE_NAME_RE ]] || return 1
  stem="${name%.md}"
  [[ "$stem" =~ ^[0-9]{8}-[0-9]{10,11}-(.+)$ ]] || return 1
  slug="${BASH_REMATCH[1]}"
  valid_note_slug "$slug"
}

if ! note_filename_ok "$FILENAME"; then
  echo "Error: filename does not match {YMD}-{RUN_ID}-{SLUG}.md (slug length 3-48): $FILENAME" >&2
  exit 1
fi
if [[ -n "$BY_FILE" ]]; then
  case "$BY_FILE" in
  */* | *'\\'*)
    echo "Error: --by value must be a basename, not a path: $BY_FILE" >&2
    exit 1
    ;;
  esac
  if ! note_filename_ok "$BY_FILE"; then
    echo "Error: --by filename does not match {YMD}-{RUN_ID}-{SLUG}.md (slug length 3-48): $BY_FILE" >&2
    exit 1
  fi
fi

if ! AGENT_RELAY_DIR="$(find_agent_relay_dir "$START_DIR")"; then
  echo "bank-set-status: skipped -- no .agent-relay/ directory or git repository found above $START_DIR" >&2
  exit 2
fi
BANK_STATUS="$AGENT_RELAY_DIR/bank-status.md"

[[ -f "$BANK_STATUS" ]] || {
  echo "bank-set-status: no $BANK_STATUS (run bank-check.sh first)" >&2
  exit 1
}

read_field() {
  local field="$1"
  sed -n "s/^${field}: //p" "$BANK_STATUS" | head -1
}

CONFIGURED="$(read_field configured)"
BANK_TYPE="$(read_field bank_type)"
BANK_PATH="$(read_field bank_path)"
REACHABLE="$(read_field reachable)"

if [[ "$CONFIGURED" != "true" || "$REACHABLE" != "true" ]]; then
  echo "bank-set-status: skipped — bank not configured/reachable per $BANK_STATUS" >&2
  exit 2
fi

case "$BANK_TYPE" in
obsidian-vault) ;;
*)
  echo "bank-set-status: backend '$BANK_TYPE' has no driver in this MVP" >&2
  exit 2
  ;;
esac

[[ -n "$BANK_PATH" && -d "$BANK_PATH" ]] || {
  echo "bank-set-status: BANK_PATH '$BANK_PATH' is not a directory" >&2
  exit 2
}

NOTE_PATH="$BANK_PATH/$FILENAME"
[[ -f "$NOTE_PATH" ]] || {
  echo "Error: note not found in BANK_PATH: $FILENAME" >&2
  exit 1
}

frontmatter_field() {
  local f="$1" key="$2"
  awk -v key="$key" '
    /^---[[:space:]]*$/ {
      c++
      if (c >= 2) exit
      next
    }
    c == 1 {
      prefix = key ":"
      if (index($0, prefix) == 1) {
        rest = substr($0, length(prefix) + 1)
        sub(/^[[:space:]]+/, "", rest)
        sub(/[[:space:]]+$/, "", rest)
        print rest
        exit
      }
    }
  ' "$f" 2>/dev/null || true
}

if [[ "$(head -1 "$NOTE_PATH")" != "---" ]]; then
  echo "Error: note frontmatter must open with --- on line 1: $FILENAME" >&2
  exit 1
fi

NOTE_TYPE="$(frontmatter_field "$NOTE_PATH" type)"
case "$NOTE_TYPE" in
run)
  echo "Error: run notes have no status (immutable)" >&2
  exit 1
  ;;
decision | convention | process)
  case "$NEW_STATUS" in
  active | superseded | deprecated) ;;
  *)
    echo "Error: status '$NEW_STATUS' not allowed for type '$NOTE_TYPE' (active|superseded|deprecated)" >&2
    exit 1
    ;;
  esac
  ;;
pitfall | open-item)
  case "$NEW_STATUS" in
  open | resolved) ;;
  *)
    echo "Error: status '$NEW_STATUS' not allowed for type '$NOTE_TYPE' (open|resolved)" >&2
    exit 1
    ;;
  esac
  ;;
*)
  echo "Error: unknown or missing type '$NOTE_TYPE' in $FILENAME" >&2
  exit 1
  ;;
esac

# --by is only meaningful for superseded / resolved; refuse otherwise.
BY_KEY=""
case "$NEW_STATUS" in
superseded)
  [[ -n "$BY_FILE" ]] && BY_KEY="superseded_by"
  ;;
resolved)
  [[ -n "$BY_FILE" ]] && BY_KEY="resolved_by"
  ;;
esac

if [[ -n "$BY_FILE" && -z "$BY_KEY" ]]; then
  echo "Error: --by is only valid with status superseded or resolved" >&2
  exit 1
fi

# --by takes a filename; the field stores a quoted wikilink (see note-schema.md).
BY_LINK=""
if [[ -n "$BY_FILE" ]]; then
  BY_LINK="\"[[${BY_FILE%.md}]]\""
fi

# Rewrite only status (+ optional by-key) inside the first frontmatter block.
# Body after the closing --- is copied byte-for-byte.
tmp="$(mktemp "${TMPDIR:-/tmp}/ar-bank-note.XXXXXX")"
NOTE_PATH="$NOTE_PATH" NEW_STATUS="$NEW_STATUS" BY_KEY="$BY_KEY" BY_FILE="$BY_LINK" awk '
  BEGIN {
    note = ENVIRON["NOTE_PATH"]
    new_status = ENVIRON["NEW_STATUS"]
    by_key = ENVIRON["BY_KEY"]
    by_file = ENVIRON["BY_FILE"]
  }
  {
    if (done) { print; next }
    if ($0 ~ /^---[[:space:]]*$/) {
      c++
      print
      if (c == 2) { done = 1 }
      next
    }
    if (c == 1) {
      if ($0 ~ /^status:[[:space:]]*/) {
        print "status: " new_status
        status_written = 1
        next
      }
      if (by_key != "" && index($0, by_key ":") == 1) {
        print by_key ": " by_file
        by_written = 1
        next
      }
      print
      next
    }
    print
  }
  END {
    # If we never saw a closing ---, refuse (should not happen after type read).
    if (c < 2) {
      print "Error: note missing closing frontmatter delimiter" > "/dev/stderr"
      exit 1
    }
  }
' "$NOTE_PATH" >"$tmp"

# If status or by-key was missing from frontmatter, insert before closing ---.
# Re-scan: simpler second pass if fields were absent.
fm_has() { awk -v k="$1" '/^---[[:space:]]*$/ { c++; if (c >= 2) exit; next } c == 1 && index($0, k ":") == 1 { f = 1; exit } END { exit f ? 0 : 1 }' "$2"; }

if ! fm_has status "$tmp"; then
  echo "Error: note has no status: field to update: $FILENAME" >&2
  rm -f "$tmp"
  exit 1
fi

if [[ -n "$BY_KEY" ]]; then
  if ! fm_has "$BY_KEY" "$tmp"; then
    # Insert by_key after status line.
    tmp2="$(mktemp "${TMPDIR:-/tmp}/ar-bank-note2.XXXXXX")"
    awk -v key="$BY_KEY" -v val="$BY_LINK" '
      /^status:[[:space:]]*/ && !inserted {
        print
        print key ": " val
        inserted = 1
        next
      }
      { print }
    ' "$tmp" >"$tmp2"
    mv "$tmp2" "$tmp"
  fi
fi

# Verify body after second --- is unchanged.
body_orig="$(awk 'BEGIN{c=0} /^---[[:space:]]*$/{c++; if(c==2){s=1; next}} s{print}' "$NOTE_PATH")"
body_new="$(awk 'BEGIN{c=0} /^---[[:space:]]*$/{c++; if(c==2){s=1; next}} s{print}' "$tmp")"
if [[ "$body_orig" != "$body_new" ]]; then
  echo "Error: internal: body changed while updating status (refusing write)" >&2
  rm -f "$tmp"
  exit 1
fi

# Write in place (keeps the note's inode and permissions; mktemp files are 0600).
cat "$tmp" >"$NOTE_PATH"
rm -f "$tmp"
echo "bank-set-status: updated $NOTE_PATH (status=$NEW_STATUS${BY_KEY:+ $BY_KEY=$BY_LINK})"
