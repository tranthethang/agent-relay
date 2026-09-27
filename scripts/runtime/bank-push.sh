#!/usr/bin/env bash
# scripts/runtime/bank-push.sh
# Copy a directory of typed bank notes flat into BANK_PATH when the last
# atry bank check recorded the bank reachable. Used by atry-distill.
# See docs/bank.md and skills/atry-distill/references/note-schema.md.
#
# Never creates BANK_PATH or any subdirectory. Never injects a title heading.
# Validates every note before writing any; on refusal exits non-zero with
# nothing partially trusted from this push. Advisory warnings (orphan,
# foreign project) go to stderr and bank-status.md push_warnings: (exit 0);
# check_warnings: from the last bank check is left untouched.
#
# Bash 3.2+ compatible, POSIX tools only.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bank-push.sh <start-dir> <notes-dir>

<start-dir>   Anywhere under the target repo (same lookup as bank-check.sh).
<notes-dir>   Directory of ready-to-push .md notes (validated, then copied flat
              into BANK_PATH). Re-push overwrites same filenames.

Exit 0: all notes copied (advisory warnings may still be printed).
Exit 1: bad arguments, missing bank-status.md, or a note failed validation
        (nothing from this push is written).
Exit 2: bank not configured/reachable, backend has no driver, or no
        .agent-relay/ / git repository above <start-dir>.
EOF
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/runtime/find-agent-relay-dir.sh
source "$SCRIPT_DIR/find-agent-relay-dir.sh"

[[ $# -eq 2 ]] || usage
START_DIR="$1"
NOTES_DIR="$2"

[[ -d "$START_DIR" ]] || {
  echo "Error: not a directory: $START_DIR" >&2
  exit 1
}
[[ -d "$NOTES_DIR" ]] || {
  echo "Error: notes-dir is not a directory: $NOTES_DIR" >&2
  exit 1
}

if ! AGENT_RELAY_DIR="$(find_agent_relay_dir "$START_DIR")"; then
  echo "bank-push: skipped -- no .agent-relay/ directory or git repository found above $START_DIR" >&2
  exit 2
fi
BANK_STATUS="$AGENT_RELAY_DIR/bank-status.md"

[[ -f "$BANK_STATUS" ]] || {
  echo "bank-push: no $BANK_STATUS (run bank-check.sh first)" >&2
  exit 1
}

read_field() {
  local field="$1"
  sed -n "s/^${field}: //p" "$BANK_STATUS" | head -1
}

CONFIGURED="$(read_field configured)"
BANK_TYPE="$(read_field bank_type)"
BANK_PATH="$(read_field bank_path)"
BANK_ENDPOINT="$(read_field bank_endpoint)"
REACHABLE="$(read_field reachable)"
PROJECT_NAME="$(read_field project_name)"
: "$BANK_ENDPOINT"

if [[ "$CONFIGURED" != "true" || "$REACHABLE" != "true" ]]; then
  echo "bank-push: skipped — bank not configured/reachable per $BANK_STATUS" >&2
  exit 2
fi

# Filename: {YMD}-{RUN_ID}-{SLUG}.md (slug length 3–48, same as run slugs).
NOTE_NAME_RE='^[0-9]{8}-[0-9]{10,11}-[a-z]+(-[a-z]+)*\.md$'
ALLOWED_TYPES='run|decision|convention|pitfall|open-item|process'

valid_note_slug() {
  local s="$1"
  local len=${#s}
  if [[ "$len" -lt 3 || "$len" -gt 48 ]]; then
    return 1
  fi
  [[ "$s" =~ ^[a-z]+(-[a-z]+)*$ ]]
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

has_frontmatter_block() {
  local f="$1"
  # Obsidian only reads properties when the block opens on line 1.
  awk '
    NR == 1 && $0 !~ /^---[[:space:]]*$/ { exit }
    /^---[[:space:]]*$/ { c++; if (c >= 2) { found=1; exit } }
    END { exit found ? 0 : 1 }
  ' "$f"
}

validate_note() {
  local f="$1"
  local base type stem slug
  base="$(basename "$f")"
  if [[ ! "$base" =~ $NOTE_NAME_RE ]]; then
    echo "Error: refuse push — filename does not match {YMD}-{RUN_ID}-{SLUG}.md: $base" >&2
    return 1
  fi
  stem="${base%.md}"
  if [[ "$stem" =~ ^[0-9]{8}-[0-9]{10,11}-(.+)$ ]]; then
    slug="${BASH_REMATCH[1]}"
  else
    echo "Error: refuse push — cannot parse slug from filename: $base" >&2
    return 1
  fi
  if ! valid_note_slug "$slug"; then
    echo "Error: refuse push — slug must match ^[a-z]+(-[a-z]+)*\$ and length 3-48: '$slug' in $base" >&2
    return 1
  fi
  if ! has_frontmatter_block "$f"; then
    echo "Error: refuse push — YAML frontmatter must open with --- on line 1 and close with ---: $base" >&2
    return 1
  fi
  type="$(frontmatter_field "$f" type)"
  if [[ ! "$type" =~ ^($ALLOWED_TYPES)$ ]]; then
    echo "Error: refuse push — missing or unknown type '$type' in $base (allowed: run decision convention pitfall open-item process)" >&2
    return 1
  fi
  return 0
}

write_status_warnings() {
  local warnings="$1"
  local tmp line
  tmp="$(mktemp "${TMPDIR:-/tmp}/ar-bank-status.XXXXXX")"
  {
    while IFS= read -r line || [[ -n "$line" ]]; do
      case "$line" in
      push_warnings:*) printf 'push_warnings: %s\n' "$warnings" ;;
      *) printf '%s\n' "$line" ;;
      esac
    done <"$BANK_STATUS"
    if ! grep -q '^push_warnings:' "$BANK_STATUS"; then
      printf 'push_warnings: %s\n' "$warnings"
    fi
  } >"$tmp"
  cat "$tmp" >"$BANK_STATUS"
  rm -f "$tmp"
}

# Collect note files (non-recursive). Refuse if none.
NOTE_FILES=()
shopt -s nullglob
for f in "$NOTES_DIR"/*.md; do
  [[ -f "$f" ]] || continue
  NOTE_FILES+=("$f")
done
shopt -u nullglob

if [[ ${#NOTE_FILES[@]} -eq 0 ]]; then
  echo "Error: notes-dir has no .md files: $NOTES_DIR" >&2
  exit 1
fi

# Validate all first — nothing written on any failure.
for f in "${NOTE_FILES[@]}"; do
  validate_note "$f" || exit 1
done

case "$BANK_TYPE" in
obsidian-vault)
  [[ -n "$BANK_PATH" && -d "$BANK_PATH" ]] || {
    echo "bank-push: BANK_PATH '$BANK_PATH' is not a directory" >&2
    exit 2
  }
  [[ -w "$BANK_PATH" ]] || {
    echo "bank-push: BANK_PATH '$BANK_PATH' is not writable" >&2
    exit 2
  }

  # Run prefix {YMD}-{RUN_ID}- from the first note (all notes in one push share it).
  RUN_PREFIX=""
  first_base="$(basename "${NOTE_FILES[0]}")"
  if [[ "$first_base" =~ ^([0-9]{8}-[0-9]{10,11}-) ]]; then
    RUN_PREFIX="${BASH_REMATCH[1]}"
  fi

  PUSHED_NAMES=""
  for f in "${NOTE_FILES[@]}"; do
    base="$(basename "$f")"
    # Guard: every file must share the same run prefix.
    if [[ -n "$RUN_PREFIX" && "$base" != "$RUN_PREFIX"* ]]; then
      echo "Error: refuse push — note '$base' does not share run prefix '$RUN_PREFIX'" >&2
      exit 1
    fi
  done

  # Flat copy; never mkdir under BANK_PATH; no injected heading.
  for f in "${NOTE_FILES[@]}"; do
    base="$(basename "$f")"
    dest="$BANK_PATH/$base"
    cp "$f" "$dest"
    echo "bank-push: wrote $dest"
    if [[ -z "$PUSHED_NAMES" ]]; then
      PUSHED_NAMES="$base"
    else
      PUSHED_NAMES="$PUSHED_NAMES $base"
    fi
  done

  WARNINGS=""
  append_warning() {
    local w="$1"
    if [[ -z "$WARNINGS" ]]; then
      WARNINGS="$w"
    else
      WARNINGS="$WARNINGS $w"
    fi
  }

  # Orphan warning: bank files with same {YMD}-{RUN_ID}- prefix not in pushed set.
  if [[ -n "$RUN_PREFIX" ]]; then
    shopt -s nullglob
    for existing in "$BANK_PATH/${RUN_PREFIX}"*.md; do
      [[ -f "$existing" ]] || continue
      ebase="$(basename "$existing")"
      found=0
      for p in $PUSHED_NAMES; do
        if [[ "$p" == "$ebase" ]]; then
          found=1
          break
        fi
      done
      if [[ "$found" -eq 0 ]]; then
        echo "bank-push: warning: orphan note in bank (same run prefix, not in this push): $ebase" >&2
        append_warning "orphan:$ebase"
      fi
    done
    shopt -u nullglob
  fi

  # Foreign project advisory on the notes just pushed.
  if [[ -n "$PROJECT_NAME" ]]; then
    for f in "${NOTE_FILES[@]}"; do
      base="$(basename "$f")"
      proj="$(frontmatter_field "$f" project)"
      if [[ -n "$proj" && "$proj" != "$PROJECT_NAME" ]]; then
        echo "bank-push: warning: foreign project '$proj' in $base (expected '$PROJECT_NAME')" >&2
        append_warning "foreign-project:$base"
      fi
    done
  fi

  write_status_warnings "$WARNINGS"
  exit 0
  ;;
*)
  echo "bank-push: backend '$BANK_TYPE' has no driver in this MVP" >&2
  exit 2
  ;;
esac
