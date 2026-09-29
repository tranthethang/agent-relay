#!/usr/bin/env bash
# scripts/runtime/bank-push.sh
# Push a directory of typed bank notes to every usable sink declared by the
# last atry bank check: project vault (BANK_PATH), atry vault (BANK_ATRY_PATH),
# and/or agentmemory (POST /agentmemory/remember per note). Used by atry-distill.
# See docs/bank.md and skills/atry-distill/references/note-schema.md.
#
# Notes are partitioned by frontmatter scope: atry → atry vault / atry_name;
# project or module:<slug> → project vault / project_name. Equal absolute
# vault paths still write each filename once. Never creates vault dirs.
#
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

--vault-only  Skip the agentmemory sink (both vault lanes still run).
              Distill's second push after the Bank push line uses this.

<start-dir>   Anywhere under the target repo (same lookup as bank-check.sh).
<notes-dir>   Directory of ready-to-push .md notes (validated, then copied
              flat into the lane vault(s) and/or POSTed to agentmemory).

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
ATRY_PATH="$(read_field atry_path)"
ATRY_REACHABLE="$(read_field atry_reachable)"
ATRY_NAME="$(read_field atry_name)"
AM_URL="$(read_field agentmemory_url)"
AM_REACHABLE="$(read_field agentmemory_reachable)"
: "$BANK_ENDPOINT"

if [[ "$CONFIGURED" != "true" ]]; then
  echo "bank-push: skipped — bank not configured per $BANK_STATUS" >&2
  exit 2
fi

PROJ_VAULT_USABLE=0
ATRY_VAULT_USABLE=0
AM_USABLE=0
if [[ "$BANK_TYPE" == "obsidian-vault" && "$REACHABLE" == "true" ]]; then
  PROJ_VAULT_USABLE=1
fi
# Atry vault may be usable even when BANK_TYPE is absent (name+path recorded
# by check); require atry_reachable and a non-empty path.
if [[ "$ATRY_REACHABLE" == "true" && -n "$ATRY_PATH" ]]; then
  ATRY_VAULT_USABLE=1
fi
if [[ -n "$AM_URL" && "$AM_REACHABLE" == "true" && "$VAULT_ONLY" -eq 0 ]]; then
  AM_USABLE=1
fi

if [[ "$PROJ_VAULT_USABLE" -eq 0 && "$ATRY_VAULT_USABLE" -eq 0 && "$AM_USABLE" -eq 0 ]]; then
  echo "bank-push: skipped — no usable sink (vault reachable=$REACHABLE, atry_reachable=$ATRY_REACHABLE, agentmemory_reachable=$AM_REACHABLE) per $BANK_STATUS" >&2
  exit 2
fi

SAME_VAULT_PATH=0
if [[ -n "$BANK_PATH" && -n "$ATRY_PATH" && "$BANK_PATH" == "$ATRY_PATH" ]]; then
  SAME_VAULT_PATH=1
fi

NOTE_NAME_RE='^[0-9]{8}-[0-9]{10,11}-[a-z]+(-[a-z]+)*\.md$'
RUN_ID_RE='^[0-9]{8}-[0-9]{10,11}-[a-z]+(-[a-z]+)*$'
ALLOWED_TYPES='run|decision|convention|pitfall|open-item|process'
MODULE_SCOPE_RE='^module:[a-z]+(-[a-z]+)*$'

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

# True when the first frontmatter block contains a key (even if value empty).
has_frontmatter_key() {
  local f="$1" key="$2"
  awk -v key="$key" '
    /^---[[:space:]]*$/ {
      c++
      if (c >= 2) exit
      next
    }
    c == 1 {
      prefix = key ":"
      if (index($0, prefix) == 1) { found = 1; exit }
    }
    END { exit found ? 0 : 1 }
  ' "$f"
}

has_frontmatter_block() {
  local f="$1"
  awk '
    NR == 1 && $0 !~ /^---[[:space:]]*$/ { exit }
    /^---[[:space:]]*$/ { c++; if (c >= 2) { found=1; exit } }
    END { exit found ? 0 : 1 }
  ' "$f"
}

valid_scope() {
  local scope="$1" mod
  case "$scope" in
  atry | project) return 0 ;;
  esac
  if [[ "$scope" =~ $MODULE_SCOPE_RE ]]; then
    mod="${scope#module:}"
    valid_note_slug "$mod"
    return $?
  fi
  return 1
}

# Prints "atry" or "project" for the vault/AM lane.
note_lane() {
  local scope="$1"
  if [[ "$scope" == "atry" ]]; then
    printf 'atry'
  else
    printf 'project'
  fi
}

validate_note() {
  local f="$1"
  local base type stem slug scope run_id
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
  if has_frontmatter_key "$f" "run"; then
    echo "Error: refuse push — legacy run: wikilink field is not accepted (use run_id:): $base" >&2
    return 1
  fi
  type="$(frontmatter_field "$f" type)"
  if [[ ! "$type" =~ ^($ALLOWED_TYPES)$ ]]; then
    echo "Error: refuse push — missing or unknown type '$type' in $base (allowed: run decision convention pitfall open-item process)" >&2
    return 1
  fi
  scope="$(frontmatter_field "$f" scope)"
  if ! valid_scope "$scope"; then
    echo "Error: refuse push — missing or invalid scope '$scope' in $base (allowed: atry | project | module:<slug>)" >&2
    return 1
  fi
  if [[ "$type" == "process" && "$scope" != "atry" ]]; then
    echo "Error: refuse push — type process requires scope: atry (got scope: $scope) in $base" >&2
    return 1
  fi
  run_id="$(frontmatter_field "$f" run_id)"
  if [[ -z "$run_id" || ! "$run_id" =~ $RUN_ID_RE ]]; then
    echo "Error: refuse push — missing or invalid run_id '$run_id' in $base (expected run directory basename)" >&2
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

# Temp body / auth-header files for agentmemory POSTs — cleaned on EXIT/INT/TERM.
AM_BODY=""
AM_HDR=""
am_cleanup_temps() {
  rm -f "${AM_BODY:-}" "${AM_HDR:-}"
  AM_BODY=""
  AM_HDR=""
}
trap am_cleanup_temps EXIT
trap 'am_cleanup_temps; exit 130' INT
trap 'am_cleanup_temps; exit 143' TERM

am_auth_header_file() {
  local f
  [[ -n "${AGENTMEMORY_SECRET:-}" ]] || return 1
  f="$(mktemp "${TMPDIR:-/tmp}/ar-am-auth.XXXXXX")"
  chmod 600 "$f"
  printf 'Authorization: Bearer %s\n' "$AGENTMEMORY_SECRET" >"$f"
  printf '%s' "$f"
}

am_sha256_file() {
  local f="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$f" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$f" | awk '{print $1}'
  else
    echo "Error: neither shasum nor sha256sum found (needed for agentmemory sent ledger)" >&2
    return 1
  fi
}

# Ledger: url<TAB>project<TAB>filename<TAB>sha256-of-posted-body (skip exact rows on
# retry). The server URL is part of the key so pointing BANK_AGENTMEMORY_URL at a
# different server posts every note there instead of silently skipping it.
AM_LEDGER="$AGENT_RELAY_DIR/bank-agentmemory-sent.tsv"

am_ledger_has() {
  local url="$1" project="$2" filename="$3" hash="$4" line want
  [[ -f "$AM_LEDGER" ]] || return 1
  want="$(printf '%s\t%s\t%s\t%s' "$url" "$project" "$filename" "$hash")"
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" == "$want" ]] && return 0
  done <"$AM_LEDGER"
  return 1
}

am_ledger_append() {
  local url="$1" project="$2" filename="$3" hash="$4"
  printf '%s\t%s\t%s\t%s\n' "$url" "$project" "$filename" "$hash" >>"$AM_LEDGER"
}

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
    raw_content = f.read()
# Parse frontmatter
fm = {}
body_text = raw_content
if raw_content.startswith("---"):
    parts = raw_content.split("---", 2)
    if len(parts) >= 3:
        for line in parts[1].splitlines():
            if ":" not in line:
                continue
            k, v = line.split(":", 1)
            fm[k.strip()] = v.strip()
        body_text = parts[2]
note_type = fm.get("type", "")
key = fm.get("key", "")
status = fm.get("status", "")
scope = fm.get("scope", "")
tags_raw = fm.get("tags", "")
tags = []
m = re.match(r"^\[(.*)\]$", tags_raw)
if m:
    tags = [t.strip() for t in m.group(1).split(",") if t.strip()]
# AM type map
type_map = {
    "decision": "architecture",
    "convention": "pattern",
    "pitfall": "bug",
    "process": "workflow",
    "open-item": "fact",
}
am_type = type_map.get(note_type, "fact")
# Build lean concepts from note tags, applying filtering rules
concepts = []
for tag in tags:
    # Drop project/<name> tags when top-level project is set
    if project and tag.startswith("project/"):
        continue
    concepts.append(tag)
if key:
    concepts.append("key:" + key)
if status:
    concepts.append("status:" + status)
# Add module:<slug> from scope when scope is module:*
if scope.startswith("module:"):
    mod_tag = scope  # scope is already "module:<slug>"
    if mod_tag not in concepts:
        concepts.append(mod_tag)
# Build projected content: <type>: <key> opener, blank line, stripped body
body_lines = body_text.lstrip("\n")
opener = note_type + ": " + key if key else note_type
projected_content = opener + "\n\n" + body_lines
body = {
    "content": projected_content,
    "type": am_type,
    "concepts": concepts,
}
if project:
    body["project"] = project
with open(out, "w", encoding="utf-8") as f:
    json.dump(body, f, ensure_ascii=False)
PY
}

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

for f in "${NOTE_FILES[@]}"; do
  validate_note "$f" || exit 1
done

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

# Copy one note to dest dir; returns 0 on success.
copy_note_to() {
  local src="$1" dest_dir="$2"
  local base dest
  base="$(basename "$src")"
  dest="$dest_dir/$base"
  if cp "$src" "$dest"; then
    echo "bank-push: vault: wrote $dest"
    return 0
  fi
  echo "bank-push: vault: failed to write $dest" >&2
  return 1
}

# Orphan scan for one vault path; pushed_names is space-separated basenames
# that this push wrote into that path.
scan_orphans() {
  local vault_path="$1" pushed_names="$2" label="$3"
  local existing ebase found p
  [[ -n "$RUN_PREFIX" && -d "$vault_path" ]] || return 0
  shopt -s nullglob
  for existing in "$vault_path/${RUN_PREFIX}"*.md; do
    [[ -f "$existing" ]] || continue
    ebase="$(basename "$existing")"
    found=0
    for p in $pushed_names; do
      if [[ "$p" == "$ebase" ]]; then
        found=1
        break
      fi
    done
    if [[ "$found" -eq 0 ]]; then
      echo "bank-push: warning: orphan note in $label (same run prefix, not in this push): $ebase" >&2
      append_warning "orphan:$ebase"
    fi
  done
  shopt -u nullglob
}

# Foreign-project advisory for notes that landed in a given lane.
warn_foreign_for_notes() {
  local expected="$1"
  shift
  local f base proj
  [[ -n "$expected" ]] || return 0
  for f in "$@"; do
    [[ -n "$f" ]] || continue
    base="$(basename "$f")"
    proj="$(frontmatter_field "$f" project)"
    if [[ -n "$proj" && "$proj" != "$expected" ]]; then
      echo "bank-push: warning: foreign project '$proj' in $base (expected '$expected')" >&2
      append_warning "foreign-project:$base"
    fi
  done
}

PROJ_NOTES=()
ATRY_NOTES=()
for f in "${NOTE_FILES[@]}"; do
  scope="$(frontmatter_field "$f" scope)"
  if [[ "$(note_lane "$scope")" == "atry" ]]; then
    ATRY_NOTES+=("$f")
  else
    PROJ_NOTES+=("$f")
  fi
done

AM_OK=0
ANY_VAULT_OK=0

# --- Vault sinks (project + atry), with same-path dedupe ---
if [[ "$SAME_VAULT_PATH" -eq 1 && ("$PROJ_VAULT_USABLE" -eq 1 || "$ATRY_VAULT_USABLE" -eq 1) ]]; then
  # Single filesystem root: write every note once.
  dest_dir="$BANK_PATH"
  if [[ -z "$dest_dir" || ! -d "$dest_dir" ]]; then
    echo "bank-push: vault: path '$dest_dir' is not a directory" >&2
  elif [[ ! -w "$dest_dir" ]]; then
    echo "bank-push: vault: path '$dest_dir' is not writable" >&2
  else
    PUSHED_NAMES=""
    vault_failed=0
    for f in "${NOTE_FILES[@]}"; do
      if copy_note_to "$f" "$dest_dir"; then
        base="$(basename "$f")"
        if [[ -z "$PUSHED_NAMES" ]]; then
          PUSHED_NAMES="$base"
        else
          PUSHED_NAMES="$PUSHED_NAMES $base"
        fi
      else
        vault_failed=1
        break
      fi
    done
    if [[ "$vault_failed" -eq 0 ]]; then
      ANY_VAULT_OK=1
      scan_orphans "$dest_dir" "$PUSHED_NAMES" "vault"
      if [[ ${#PROJ_NOTES[@]} -gt 0 ]]; then
        warn_foreign_for_notes "$PROJECT_NAME" "${PROJ_NOTES[@]}"
      fi
      if [[ ${#ATRY_NOTES[@]} -gt 0 ]]; then
        warn_foreign_for_notes "$ATRY_NAME" "${ATRY_NOTES[@]}"
      fi
      echo "bank-push: vault: ok (${#NOTE_FILES[@]} note(s) to $dest_dir; project+atry paths equal)"
    else
      echo "bank-push: vault: failed" >&2
    fi
  fi
else
  # Separate paths (or only one lane usable).
  if [[ "$PROJ_VAULT_USABLE" -eq 1 ]]; then
    if [[ ${#PROJ_NOTES[@]} -eq 0 ]]; then
      echo "bank-push: vault(project): no project-lane notes in this push"
      # Atry-lane-only push with atry vault unset is an intentional
      # local-distill skip, not "all usable sinks failed". When atry vault
      # is usable, leave ANY_VAULT_OK to the atry copy result.
      if [[ "$ATRY_VAULT_USABLE" -eq 0 ]]; then
        ANY_VAULT_OK=1
      fi
    elif [[ -z "$BANK_PATH" || ! -d "$BANK_PATH" ]]; then
      echo "bank-push: vault(project): BANK_PATH '$BANK_PATH' is not a directory" >&2
    elif [[ ! -w "$BANK_PATH" ]]; then
      echo "bank-push: vault(project): BANK_PATH '$BANK_PATH' is not writable" >&2
    else
      PUSHED_NAMES=""
      vault_failed=0
      for f in "${PROJ_NOTES[@]}"; do
        if copy_note_to "$f" "$BANK_PATH"; then
          base="$(basename "$f")"
          if [[ -z "$PUSHED_NAMES" ]]; then
            PUSHED_NAMES="$base"
          else
            PUSHED_NAMES="$PUSHED_NAMES $base"
          fi
        else
          vault_failed=1
          break
        fi
      done
      if [[ "$vault_failed" -eq 0 ]]; then
        ANY_VAULT_OK=1
        scan_orphans "$BANK_PATH" "$PUSHED_NAMES" "vault(project)"
        warn_foreign_for_notes "$PROJECT_NAME" "${PROJ_NOTES[@]}"
        echo "bank-push: vault(project): ok (${#PROJ_NOTES[@]} note(s))"
      else
        echo "bank-push: vault(project): failed" >&2
      fi
    fi
  fi

  if [[ "$ATRY_VAULT_USABLE" -eq 1 ]]; then
    if [[ ${#ATRY_NOTES[@]} -eq 0 ]]; then
      echo "bank-push: vault(atry): no atry-lane notes in this push"
    elif [[ -z "$ATRY_PATH" || ! -d "$ATRY_PATH" ]]; then
      echo "bank-push: vault(atry): BANK_ATRY_PATH '$ATRY_PATH' is not a directory" >&2
    elif [[ ! -w "$ATRY_PATH" ]]; then
      echo "bank-push: vault(atry): BANK_ATRY_PATH '$ATRY_PATH' is not writable" >&2
    else
      PUSHED_NAMES=""
      vault_failed=0
      for f in "${ATRY_NOTES[@]}"; do
        if copy_note_to "$f" "$ATRY_PATH"; then
          base="$(basename "$f")"
          if [[ -z "$PUSHED_NAMES" ]]; then
            PUSHED_NAMES="$base"
          else
            PUSHED_NAMES="$PUSHED_NAMES $base"
          fi
        else
          vault_failed=1
          break
        fi
      done
      if [[ "$vault_failed" -eq 0 ]]; then
        ANY_VAULT_OK=1
        scan_orphans "$ATRY_PATH" "$PUSHED_NAMES" "vault(atry)"
        warn_foreign_for_notes "$ATRY_NAME" "${ATRY_NOTES[@]}"
        echo "bank-push: vault(atry): ok (${#ATRY_NOTES[@]} note(s))"
      else
        echo "bank-push: vault(atry): failed" >&2
      fi
    fi
  elif [[ ${#ATRY_NOTES[@]} -gt 0 ]]; then
    echo "bank-push: vault(atry): skipped — atry vault not reachable (atry-lane notes stay in local distill/ only)" >&2
  fi
fi

# --- agentmemory sink ---
# Eligibility: skip type:run, skip terminal statuses (not active/open),
# skip atry-lane without atry_name. Intentional skips are not failures.
# POST failure: do not break — continue remaining notes, list failures;
# sink still counts as failed. Local ledger skips exact url/project/filename/
# body-hash rows already posted (changed content or another server posts again).
if [[ "$AM_USABLE" -eq 1 ]]; then
  am_failed=0
  am_posted=0
  am_skipped=0
  am_ledger_skipped=0
  am_failed_names=""
  for f in "${NOTE_FILES[@]}"; do
    base="$(basename "$f")"
    note_type="$(frontmatter_field "$f" type)"
    note_status="$(frontmatter_field "$f" status)"
    scope="$(frontmatter_field "$f" scope)"
    lane="$(note_lane "$scope")"
    # Skip run notes — per-run index/metrics; not shared durable lessons
    if [[ "$note_type" == "run" ]]; then
      echo "bank-push: agentmemory: skipped $base — type:run not remembered" >&2
      am_skipped=$((am_skipped + 1))
      continue
    fi
    # Skip terminal statuses; empty/unknown status → skip
    case "$note_status" in
    active | open) ;;
    *)
      echo "bank-push: agentmemory: skipped $base — status '$note_status' not active/open" >&2
      am_skipped=$((am_skipped + 1))
      continue
      ;;
    esac
    am_project=""
    if [[ "$lane" == "atry" ]]; then
      if [[ -z "$ATRY_NAME" ]]; then
        echo "bank-push: agentmemory: skipped $base — atry_name not set (atry-lane notes need BANK_ATRY_NAME)" >&2
        am_skipped=$((am_skipped + 1))
        continue
      fi
      am_project="$ATRY_NAME"
    else
      am_project="$PROJECT_NAME"
    fi
    am_cleanup_temps
    AM_BODY="$(mktemp "${TMPDIR:-/tmp}/ar-am-body.XXXXXX")"
    if ! build_remember_body "$f" "$am_project" "$AM_BODY"; then
      echo "bank-push: agentmemory: failed to build body for $base" >&2
      am_cleanup_temps
      am_failed=1
      if [[ -z "$am_failed_names" ]]; then
        am_failed_names="$base"
      else
        am_failed_names="$am_failed_names $base"
      fi
      continue
    fi
    body_hash="$(am_sha256_file "$AM_BODY")" || {
      echo "bank-push: agentmemory: failed to hash body for $base" >&2
      am_cleanup_temps
      am_failed=1
      if [[ -z "$am_failed_names" ]]; then
        am_failed_names="$base"
      else
        am_failed_names="$am_failed_names $base"
      fi
      continue
    }
    if am_ledger_has "$AM_URL" "$am_project" "$base" "$body_hash"; then
      echo "bank-push: agentmemory: skipped $base — already in sent ledger" >&2
      am_cleanup_temps
      am_ledger_skipped=$((am_ledger_skipped + 1))
      continue
    fi
    set +e
    AM_HDR=""
    if hdr="$(am_auth_header_file)"; then
      AM_HDR="$hdr"
      curl_out="$(curl -fsS --connect-timeout 2 --max-time 30 \
        -H 'Content-Type: application/json' -H @"$AM_HDR" \
        --data-binary @"$AM_BODY" \
        "${AM_URL}/agentmemory/remember" 2>&1)"
      curl_rc=$?
    else
      curl_out="$(curl -fsS --connect-timeout 2 --max-time 30 \
        -H 'Content-Type: application/json' \
        --data-binary @"$AM_BODY" \
        "${AM_URL}/agentmemory/remember" 2>&1)"
      curl_rc=$?
    fi
    set -e
    am_cleanup_temps
    if [[ "$curl_rc" -ne 0 ]]; then
      echo "bank-push: agentmemory: remember failed for $base (curl exit $curl_rc): $(printf '%s' "$curl_out" | tr '\n' ' ')" >&2
      am_failed=1
      if [[ -z "$am_failed_names" ]]; then
        am_failed_names="$base"
      else
        am_failed_names="$am_failed_names $base"
      fi
      continue
    fi
    am_ledger_append "$AM_URL" "$am_project" "$base" "$body_hash"
    am_posted=$((am_posted + 1))
    echo "bank-push: agentmemory: remembered $base (project=${am_project:-none})"
  done
  if [[ "$am_failed" -eq 0 && "$am_posted" -gt 0 ]]; then
    AM_OK=1
    echo "bank-push: agentmemory: ok ($am_posted note(s))"
  elif [[ "$am_failed" -eq 0 ]]; then
    # Every note was intentionally skipped (eligibility and/or ledger) — not a transfer failure.
    echo "bank-push: agentmemory: skipped — no notes eligible ($am_skipped skipped, $am_ledger_skipped already sent)" >&2
    AM_OK=1
  else
    echo "bank-push: agentmemory: failed ($am_failed_names)" >&2
  fi
fi

write_status_warnings "$WARNINGS"

if [[ "$ANY_VAULT_OK" -eq 1 || "$AM_OK" -eq 1 ]]; then
  exit 0
fi
echo "bank-push: all usable sinks failed" >&2
exit 1
