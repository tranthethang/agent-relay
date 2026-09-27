#!/usr/bin/env bash
# scripts/runtime/bank-push.sh
# Push a directory of typed bank notes to every usable sink declared by the
# last atry bank check: obsidian-vault (flat copy into BANK_PATH) and/or
# agentmemory (POST /agentmemory/remember per note). Used by atry-distill.
# See docs/bank.md and skills/atry-distill/references/note-schema.md.
#
# Never creates BANK_PATH or any subdirectory. Never injects a title heading.
# Validates every note before writing any; on refusal exits non-zero with
# nothing partially trusted from this push. Advisory warnings (orphan,
# foreign project) go to stderr and bank-status.md push_warnings: (exit 0);
# check_warnings: from the last bank check is left untouched.
#
# One sink failing never skips the other. Exit 2 only when no sink is usable.
#
# Bash 3.2+ compatible, POSIX tools only.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bank-push.sh [--vault-only] <start-dir> <notes-dir>

--vault-only  Skip the agentmemory sink. agentmemory's remember always
              creates a new memory, so a second push of the same notes (e.g.
              distill's re-push after writing the Bank push line) must not
              reach it again.

<start-dir>   Anywhere under the target repo (same lookup as bank-check.sh).
<notes-dir>   Directory of ready-to-push .md notes (validated, then copied
              flat into BANK_PATH and/or POSTed to agentmemory). Re-push
              overwrites same vault filenames; agentmemory creates a new
              memory per call.

Exit 0: at least one usable sink succeeded (advisory warnings may print).
Exit 1: bad arguments, missing bank-status.md, a note failed validation,
        or every usable sink failed during transfer.
Exit 2: no usable sink (not configured/reachable), or no .agent-relay/ /
        git repository above <start-dir>.
EOF
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/runtime/find-agent-relay-dir.sh
source "$SCRIPT_DIR/find-agent-relay-dir.sh"

VAULT_ONLY=0
if [[ "${1:-}" == "--vault-only" ]]; then
  VAULT_ONLY=1
  shift
fi
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
AM_URL="$(read_field agentmemory_url)"
AM_REACHABLE="$(read_field agentmemory_reachable)"
: "$BANK_ENDPOINT"

if [[ "$CONFIGURED" != "true" ]]; then
  echo "bank-push: skipped — bank not configured per $BANK_STATUS" >&2
  exit 2
fi

VAULT_USABLE=0
AM_USABLE=0
if [[ "$BANK_TYPE" == "obsidian-vault" && "$REACHABLE" == "true" ]]; then
  VAULT_USABLE=1
fi
if [[ -n "$AM_URL" && "$AM_REACHABLE" == "true" && "$VAULT_ONLY" -eq 0 ]]; then
  AM_USABLE=1
fi

if [[ "$VAULT_USABLE" -eq 0 && "$AM_USABLE" -eq 0 ]]; then
  echo "bank-push: skipped — no usable sink (vault reachable=$REACHABLE, agentmemory_reachable=$AM_REACHABLE) per $BANK_STATUS" >&2
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

# Optional bearer auth: when AGENTMEMORY_SECRET is set in the environment (the
# same variable the agentmemory server reads), write the header to a 0600 temp
# file and pass it with `-H @file` so the secret never appears in argv / ps.
# Never read from bank.conf (that file may be committed).
am_auth_header_file() {
  local f
  [[ -n "${AGENTMEMORY_SECRET:-}" ]] || return 1
  f="$(mktemp "${TMPDIR:-/tmp}/ar-am-auth.XXXXXX")"
  chmod 600 "$f"
  printf 'Authorization: Bearer %s\n' "$AGENTMEMORY_SECRET" >"$f"
  printf '%s' "$f"
}

# Build POST body for /agentmemory/remember into $3. Uses python3 for safe
# JSON encoding of the full note (never interpolates content into argv).
# Confirmed fields (agentmemory @0.9.29 src/triggers/api.ts api::remember):
#   content (required), type?, concepts?, files?, ttlDays?,
#   sourceObservationIds?, project?, agentId?
# Extra keys (key, status, tags) are sent as metadata; the server whitelist
# drops unknown fields, so the durable copy is always in content.
build_remember_body() {
  local note_file="$1" project="$2" out_file="$3"
  if ! command -v python3 >/dev/null 2>&1; then
    echo "Error: python3 is required to JSON-encode agentmemory remember bodies" >&2
    return 1
  fi
  NOTE_FILE="$note_file" PROJECT="$project" OUT_FILE="$out_file" python3 <<'PY'
import json, os, re

path = os.environ["NOTE_FILE"]
project = os.environ["PROJECT"]
out = os.environ["OUT_FILE"]

with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Minimal frontmatter parse for type/key/status/tags.
fm = {}
if content.startswith("---"):
    parts = content.split("---", 2)
    if len(parts) >= 3:
        for line in parts[1].splitlines():
            if ":" not in line:
                continue
            k, v = line.split(":", 1)
            fm[k.strip()] = v.strip()

note_type = fm.get("type", "")
key = fm.get("key", "")
status = fm.get("status", "")
tags_raw = fm.get("tags", "")
tags = []
m = re.match(r"^\[(.*)\]$", tags_raw)
if m:
    tags = [t.strip() for t in m.group(1).split(",") if t.strip()]

concepts = list(tags)
if key:
    concepts.append("key:" + key)
if status:
    concepts.append("status:" + status)
if note_type:
    concepts.append("note-type:" + note_type)

body = {
    "content": content,
    "project": project,
    "type": note_type,
    "key": key,
    "status": status,
    "tags": tags,
    "concepts": concepts,
}
# Drop empty optional strings so we never send project:"" (API rejects it).
if not body["project"]:
    del body["project"]
if not body["type"]:
    del body["type"]
if not body["key"]:
    del body["key"]
if not body["status"]:
    del body["status"]

with open(out, "w", encoding="utf-8") as f:
    json.dump(body, f, ensure_ascii=False)
PY
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

# Shared run-prefix guard (all notes in one push share {YMD}-{RUN_ID}-).
RUN_PREFIX=""
first_base="$(basename "${NOTE_FILES[0]}")"
if [[ "$first_base" =~ ^([0-9]{8}-[0-9]{10,11}-) ]]; then
  RUN_PREFIX="${BASH_REMATCH[1]}"
fi
for f in "${NOTE_FILES[@]}"; do
  base="$(basename "$f")"
  if [[ -n "$RUN_PREFIX" && "$base" != "$RUN_PREFIX"* ]]; then
    echo "Error: refuse push — note '$base' does not share run prefix '$RUN_PREFIX'" >&2
    exit 1
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

VAULT_OK=0
AM_OK=0

# --- Obsidian vault sink ---
if [[ "$VAULT_USABLE" -eq 1 ]]; then
  if [[ -z "$BANK_PATH" || ! -d "$BANK_PATH" ]]; then
    echo "bank-push: vault: BANK_PATH '$BANK_PATH' is not a directory" >&2
  elif [[ ! -w "$BANK_PATH" ]]; then
    echo "bank-push: vault: BANK_PATH '$BANK_PATH' is not writable" >&2
  else
    PUSHED_NAMES=""
    vault_failed=0
    for f in "${NOTE_FILES[@]}"; do
      base="$(basename "$f")"
      dest="$BANK_PATH/$base"
      if cp "$f" "$dest"; then
        echo "bank-push: vault: wrote $dest"
        if [[ -z "$PUSHED_NAMES" ]]; then
          PUSHED_NAMES="$base"
        else
          PUSHED_NAMES="$PUSHED_NAMES $base"
        fi
      else
        echo "bank-push: vault: failed to write $dest" >&2
        vault_failed=1
        break
      fi
    done

    if [[ "$vault_failed" -eq 0 ]]; then
      VAULT_OK=1
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
      echo "bank-push: vault: ok (${#NOTE_FILES[@]} note(s))"
    else
      echo "bank-push: vault: failed" >&2
    fi
  fi
fi

# --- agentmemory sink ---
if [[ "$AM_USABLE" -eq 1 ]]; then
  am_failed=0
  for f in "${NOTE_FILES[@]}"; do
    base="$(basename "$f")"
    body="$(mktemp "${TMPDIR:-/tmp}/ar-am-body.XXXXXX")"
    if ! build_remember_body "$f" "$PROJECT_NAME" "$body"; then
      echo "bank-push: agentmemory: failed to build body for $base" >&2
      rm -f "$body"
      am_failed=1
      break
    fi
    set +e
    if hdr="$(am_auth_header_file)"; then
      curl_out="$(curl -fsS --connect-timeout 2 --max-time 30 \
        -H 'Content-Type: application/json' -H @"$hdr" \
        --data-binary @"$body" \
        "${AM_URL}/agentmemory/remember" 2>&1)"
      curl_rc=$?
      rm -f "$hdr"
    else
      curl_out="$(curl -fsS --connect-timeout 2 --max-time 30 \
        -H 'Content-Type: application/json' \
        --data-binary @"$body" \
        "${AM_URL}/agentmemory/remember" 2>&1)"
      curl_rc=$?
    fi
    set -e
    rm -f "$body"
    if [[ "$curl_rc" -ne 0 ]]; then
      echo "bank-push: agentmemory: remember failed for $base (curl exit $curl_rc): $(printf '%s' "$curl_out" | tr '\n' ' ')" >&2
      am_failed=1
      break
    fi
    echo "bank-push: agentmemory: remembered $base"
  done
  if [[ "$am_failed" -eq 0 ]]; then
    AM_OK=1
    echo "bank-push: agentmemory: ok (${#NOTE_FILES[@]} note(s))"
  else
    echo "bank-push: agentmemory: failed" >&2
  fi
fi

write_status_warnings "$WARNINGS"

if [[ "$VAULT_OK" -eq 1 || "$AM_OK" -eq 1 ]]; then
  exit 0
fi
echo "bank-push: all usable sinks failed" >&2
exit 1
