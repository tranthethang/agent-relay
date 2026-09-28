#!/usr/bin/env bash
# scripts/runtime/bank-check.sh
# Probe an optional external knowledge bank declared in .agent-relay/bank.conf
# and record reachability in .agent-relay/bank-status.md. Project-level (one
# per target repo), not per-run. See docs/bank.md for the format and the
# supported backend types.
#
# Dual vault lanes: BANK_PATH / BANK_PROJECT_NAME (project) and optional
# BANK_ATRY_PATH / BANK_ATRY_NAME (atry self-improve). This checks reachability
# only. Network is used only when BANK_AGENTMEMORY_URL is set
# (GET /agentmemory/health). Never creates vault paths or subdirectories.
#
# Bash 3.2+ compatible, POSIX tools only. bank.conf is parsed line-by-line and
# never sourced/eval'd.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bank-check.sh [<start-dir>]

Looks for .agent-relay/ starting at <start-dir> (default: cwd) and walking up
to the nearest .git, same as resolve-run.sh. Reads .agent-relay/bank.conf if
present, probes the declared backend, and writes .agent-relay/bank-status.md.

Exit 0: status written (bank.conf absent counts as "not configured", exit 0).
Exit 1: .agent-relay/bank.conf exists but is malformed.
Exit 2: no .agent-relay/ directory or git repository found above <start-dir>
        (treated as "not configured", not a crash).
EOF
  exit 1
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/runtime/find-agent-relay-dir.sh
source "$SCRIPT_DIR/find-agent-relay-dir.sh"

START_DIR="${1:-$PWD}"
[[ -d "$START_DIR" ]] || {
  echo "Error: not a directory: $START_DIR" >&2
  exit 1
}

if ! AGENT_RELAY_DIR="$(find_agent_relay_dir "$START_DIR")"; then
  echo "bank-check: skipped -- no .agent-relay/ directory or git repository found above $START_DIR" >&2
  exit 2
fi
mkdir -p "$AGENT_RELAY_DIR"
BANK_CONF="$AGENT_RELAY_DIR/bank.conf"
BANK_STATUS="$AGENT_RELAY_DIR/bank-status.md"

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# push_warnings: belongs to the last `atry bank push`; a check keeps it as-is
# and only rewrites check_warnings:.
PREV_PUSH_WARNINGS=""
if [[ -f "$BANK_STATUS" ]]; then
  PREV_PUSH_WARNINGS="$(sed -n 's/^push_warnings: //p' "$BANK_STATUS" | head -1)"
fi

# Strip one trailing slash from a path (leave "/" alone).
normalize_bank_path() {
  local p="$1"
  if [[ "$p" == */ && "$p" != "/" ]]; then
    p="${p%/}"
  fi
  printf '%s' "$p"
}

# True when value matches the run-slug regex and length 3–48.
valid_project_slug() {
  local s="$1"
  local len=${#s}
  if [[ "$len" -lt 3 || "$len" -gt 48 ]]; then
    return 1
  fi
  [[ "$s" =~ ^[a-z]+(-[a-z]+)*$ ]]
}

# Slugify a directory basename toward ^[a-z]+(-[a-z]+)*$, length 3–48.
slugify_project_name() {
  local s="$1"
  s="$(printf '%s' "$s" | tr '[:upper:]' '[:lower:]')"
  s="$(printf '%s' "$s" | sed -E -e 's/[^a-z]/-/g' -e 's/-+/-/g' -e 's/^-//' -e 's/-$//')"
  if valid_project_slug "$s"; then
    printf '%s' "$s"
    return 0
  fi
  return 1
}

# BANK_AGENTMEMORY_URL: http(s)://host[:port] only (optional trailing / stripped).
normalize_agentmemory_url() {
  local u="$1"
  if [[ "$u" == */ && "$u" != "/" && "$u" != http:// && "$u" != https:// ]]; then
    u="${u%/}"
  fi
  if [[ "$u" =~ ^https?://[A-Za-z0-9._-]+(:[0-9]{1,5})?$ ]]; then
    printf '%s' "$u"
    return 0
  fi
  return 1
}

am_auth_header_file() {
  local f
  [[ -n "${AGENTMEMORY_SECRET:-}" ]] || return 1
  f="$(mktemp "${TMPDIR:-/tmp}/ar-am-auth.XXXXXX")"
  chmod 600 "$f"
  printf 'Authorization: Bearer %s\n' "$AGENTMEMORY_SECRET" >"$f"
  printf '%s' "$f"
}

probe_agentmemory_health() {
  local base="$1"
  local url="${base}/agentmemory/health"
  local out rc hdr=""
  if ! python3 -c 'import json' >/dev/null 2>&1; then
    printf '%s' "python3 not available (required to push to agentmemory)"
    return 1
  fi
  set +e
  if hdr="$(am_auth_header_file)"; then
    out="$(curl -fsS --connect-timeout 2 --max-time 5 -H @"$hdr" "$url" 2>&1)"
    rc=$?
    rm -f "$hdr"
  else
    out="$(curl -fsS --connect-timeout 2 --max-time 5 "$url" 2>&1)"
    rc=$?
  fi
  set -e
  if [[ "$rc" -eq 0 ]]; then
    printf '%s' "health ok"
    return 0
  fi
  if [[ -n "$out" ]]; then
    printf '%s' "$(printf '%s' "$out" | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
  else
    printf '%s' "health probe failed (curl exit $rc)"
  fi
  return 1
}

# Extract flat frontmatter field from the first --- … --- block.
note_fm_field() {
  local f="$1"
  local key="$2"
  awk -v key="$key" '
    /^---[[:space:]]*$/ {
      c++
      if (c >= 2) exit
      next
    }
    c == 1 {
      prefix = key ":"
      if (index($0, prefix) == 1 || $0 ~ ("^" key ":[[:space:]]")) {
        sub("^" key ":[[:space:]]*", "")
        sub(/[[:space:]]+$/, "")
        print
        exit
      }
    }
  ' "$f" 2>/dev/null || true
}

note_project_field() { note_fm_field "$1" "project"; }
note_scope_field() { note_fm_field "$1" "scope"; }

# Probe one vault path: prints detail; exit 0 = reachable, 1 = not.
# Sets nothing global — caller interprets detail + exit.
probe_vault_path() {
  local path="$1"
  if [[ -z "$path" ]]; then
    printf '%s' "path not set"
    return 1
  elif [[ ! -d "$path" ]]; then
    printf '%s' "path does not exist: $path"
    return 1
  elif [[ ! -w "$path" ]]; then
    printf '%s' "path exists but is not writable: $path"
    return 1
  fi
  printf '%s' "vault directory exists and is writable"
  return 0
}

# Advisory foreign-project warnings for one path.
# expected_a / expected_b: when both non-empty (same-path dual lane), accept
# either name; otherwise if scope is atry use expected_atry, else expected_proj.
# When only one expected is set, that name is required.
# Prints warning tokens (space-separated) to stdout; echoes to stderr.
collect_foreign_project_warnings() {
  local bank_path="$1"
  local expected_proj="$2"
  local expected_atry="$3"
  local same_path="$4" # "1" when project and atry paths are identical
  local warnings="" note proj scope base expected
  [[ -d "$bank_path" ]] || {
    printf '%s' ""
    return 0
  }
  for note in "$bank_path"/*.md; do
    [[ -f "$note" ]] || continue
    proj="$(note_project_field "$note")"
    [[ -n "$proj" ]] || continue
    scope="$(note_scope_field "$note")"
    expected=""
    if [[ "$same_path" == "1" && -n "$expected_proj" && -n "$expected_atry" ]]; then
      if [[ "$proj" == "$expected_proj" || "$proj" == "$expected_atry" ]]; then
        continue
      fi
      # Prefer scope to phrase the expected name in the warning.
      if [[ "$scope" == "atry" ]]; then
        expected="$expected_atry"
      else
        expected="$expected_proj"
      fi
    elif [[ -n "$expected_proj" && -z "$expected_atry" ]]; then
      expected="$expected_proj"
      [[ "$proj" == "$expected" ]] && continue
    elif [[ -z "$expected_proj" && -n "$expected_atry" ]]; then
      expected="$expected_atry"
      [[ "$proj" == "$expected" ]] && continue
    else
      continue
    fi
    base="$(basename "$note")"
    echo "bank-check: warning: foreign project '$proj' in $base (expected '$expected')" >&2
    if [[ -z "$warnings" ]]; then
      warnings="foreign-project:$base"
    else
      warnings="$warnings foreign-project:$base"
    fi
  done
  printf '%s' "$warnings"
}

# Append space-separated warning tokens (skip empties / duplicates not required).
append_warnings() {
  local cur="$1"
  local add="$2"
  if [[ -z "$add" ]]; then
    printf '%s' "$cur"
  elif [[ -z "$cur" ]]; then
    printf '%s' "$add"
  else
    printf '%s %s' "$cur" "$add"
  fi
}

# write_status args (positional, bash 3.2):
# 1 configured 2 bank_type 3 bank_path 4 bank_endpoint
# 5 reachable 6 detail 7 project_name 8 project_source 9 warnings
# 10 am_url 11 am_reachable 12 am_detail
# 13 atry_path 14 atry_reachable 15 atry_detail 16 atry_name 17 atry_name_source
write_status() {
  local configured="$1" bank_type="$2" bank_path="$3" bank_endpoint="$4"
  local reachable="$5" detail="$6" project_name="$7" project_source="$8" warnings="$9"
  local am_url="${10}" am_reachable="${11}" am_detail="${12}"
  local atry_path="${13}" atry_reachable="${14}" atry_detail="${15}"
  local atry_name="${16}" atry_name_source="${17}"
  {
    printf 'configured: %s\n' "$configured"
    printf 'bank_type: %s\n' "$bank_type"
    printf 'bank_path: %s\n' "$bank_path"
    printf 'bank_endpoint: %s\n' "$bank_endpoint"
    printf 'project_name: %s\n' "$project_name"
    printf 'project_source: %s\n' "$project_source"
    printf 'reachable: %s\n' "$reachable"
    printf 'atry_path: %s\n' "$atry_path"
    printf 'atry_reachable: %s\n' "$atry_reachable"
    printf 'atry_detail: %s\n' "$atry_detail"
    printf 'atry_name: %s\n' "$atry_name"
    printf 'atry_name_source: %s\n' "$atry_name_source"
    printf 'agentmemory_url: %s\n' "$am_url"
    printf 'agentmemory_reachable: %s\n' "$am_reachable"
    printf 'agentmemory_detail: %s\n' "$am_detail"
    printf 'checked_at: %s\n' "$(now_iso)"
    printf 'detail: %s\n' "$detail"
    printf 'check_warnings: %s\n' "$warnings"
    printf 'push_warnings: %s\n' "$PREV_PUSH_WARNINGS"
  } >"$BANK_STATUS"
}

if [[ ! -f "$BANK_CONF" ]]; then
  write_status "false" "none" "" "" "false" "no bank.conf found at $BANK_CONF" "" "none" "" \
    "" "false" "not configured" \
    "" "false" "not configured" "" "none"
  echo "bank-check: not configured (no bank.conf) -> $BANK_STATUS"
  exit 0
fi

# --- Parse bank.conf without sourcing it ---
BANK_TYPE=""
BANK_PATH=""
BANK_ENDPOINT=""
BANK_PROJECT_NAME=""
BANK_ATRY_PATH=""
BANK_ATRY_NAME=""
BANK_AGENTMEMORY_URL=""
lineno=0
malformed=0
malformed_reason=""
while IFS= read -r line || [[ -n "$line" ]]; do
  lineno=$((lineno + 1))
  trimmed="$line"
  while [[ "$trimmed" == [[:space:]]* ]]; do
    trimmed="${trimmed#?}"
  done
  case "$trimmed" in
  '' | '#'*) continue ;;
  esac
  if [[ "$line" =~ ^BANK_[A-Z_]+=.*$ ]]; then
    key="${line%%=*}"
    val="${line#*=}"
    if [[ "$val" == \"*\" && ${#val} -ge 2 ]]; then
      val="${val#\"}"
      val="${val%\"}"
    elif [[ "$val" == \'*\' && ${#val} -ge 2 ]]; then
      val="${val#\'}"
      val="${val%\'}"
    fi
    case "$val" in
    *'$('* | *'`'* | *';'* | *'&&'* | *'||'* | *'|'* | *'>'* | *'<'* | *$'\n'*)
      echo "Error: bank.conf line $lineno rejected (unsafe characters in value): $line" >&2
      malformed=1
      malformed_reason="line $lineno rejected (unsafe characters in value)"
      break
      ;;
    esac
    case "$key" in
    BANK_TYPE) BANK_TYPE="$val" ;;
    BANK_PATH) BANK_PATH="$val" ;;
    BANK_ENDPOINT) BANK_ENDPOINT="$val" ;;
    BANK_PROJECT_NAME) BANK_PROJECT_NAME="$val" ;;
    BANK_ATRY_PATH) BANK_ATRY_PATH="$val" ;;
    BANK_ATRY_NAME) BANK_ATRY_NAME="$val" ;;
    BANK_AGENTMEMORY_URL) BANK_AGENTMEMORY_URL="$val" ;;
    *) ;;
    esac
  else
    echo "Error: bank.conf line $lineno is not BANK_KEY=value: $line" >&2
    malformed=1
    malformed_reason="line $lineno is not BANK_KEY=value"
    break
  fi
done <"$BANK_CONF"

if [[ "$malformed" -eq 1 ]]; then
  write_status "true" "" "" "" "false" "bank.conf malformed ($malformed_reason) -- fix bank.conf and re-run bank-check.sh" "" "none" "" \
    "" "false" "not checked (malformed config)" \
    "" "false" "not checked (malformed config)" "" "none"
  echo "Refusing to parse bank.conf further. Fix the offending line above." >&2
  echo "bank-check: wrote $BANK_STATUS (reachable: false, malformed config)" >&2
  exit 1
fi

if [[ -n "$BANK_PATH" ]]; then
  BANK_PATH="$(normalize_bank_path "$BANK_PATH")"
fi
if [[ -n "$BANK_ATRY_PATH" ]]; then
  BANK_ATRY_PATH="$(normalize_bank_path "$BANK_ATRY_PATH")"
fi

AM_URL=""
AM_REACHABLE="false"
AM_DETAIL="not configured"
if [[ -n "$BANK_AGENTMEMORY_URL" ]]; then
  if ! AM_URL="$(normalize_agentmemory_url "$BANK_AGENTMEMORY_URL")"; then
    write_status "true" "$BANK_TYPE" "$BANK_PATH" "$BANK_ENDPOINT" "false" \
      "bank.conf malformed (BANK_AGENTMEMORY_URL '$BANK_AGENTMEMORY_URL' is not http(s)://host[:port]) -- fix bank.conf and re-run bank-check.sh" \
      "" "none" "" "" "false" "not checked (malformed URL)" \
      "$BANK_ATRY_PATH" "false" "not checked (malformed config)" "" "none"
    echo "Error: BANK_AGENTMEMORY_URL '$BANK_AGENTMEMORY_URL' is not a valid agentmemory URL (expected http(s)://host[:port])" >&2
    echo "bank-check: wrote $BANK_STATUS (reachable: false, malformed config)" >&2
    exit 1
  fi
fi

PROJECT_NAME=""
PROJECT_SOURCE="none"
if [[ -n "$BANK_PROJECT_NAME" ]]; then
  if ! valid_project_slug "$BANK_PROJECT_NAME"; then
    write_status "true" "$BANK_TYPE" "$BANK_PATH" "$BANK_ENDPOINT" "false" \
      "bank.conf malformed (BANK_PROJECT_NAME '$BANK_PROJECT_NAME' is not a valid slug ^[a-z]+(-[a-z]+)*\$, length 3-48) -- fix bank.conf and re-run bank-check.sh" \
      "" "none" "" "$AM_URL" "false" "not checked (malformed config)" \
      "$BANK_ATRY_PATH" "false" "not checked (malformed config)" "" "none"
    echo "Error: BANK_PROJECT_NAME '$BANK_PROJECT_NAME' is not a valid project slug (^[a-z]+(-[a-z]+)*\$, length 3-48)" >&2
    echo "bank-check: wrote $BANK_STATUS (reachable: false, malformed config)" >&2
    exit 1
  fi
  PROJECT_NAME="$BANK_PROJECT_NAME"
  PROJECT_SOURCE="config"
else
  REPO_BASENAME="$(basename "$(dirname "$AGENT_RELAY_DIR")")"
  if PROJECT_NAME="$(slugify_project_name "$REPO_BASENAME")"; then
    PROJECT_SOURCE="default"
  else
    PROJECT_NAME=""
    PROJECT_SOURCE="default"
  fi
fi

ATRY_NAME=""
ATRY_NAME_SOURCE="none"
if [[ -n "$BANK_ATRY_NAME" ]]; then
  if ! valid_project_slug "$BANK_ATRY_NAME"; then
    write_status "true" "$BANK_TYPE" "$BANK_PATH" "$BANK_ENDPOINT" "false" \
      "bank.conf malformed (BANK_ATRY_NAME '$BANK_ATRY_NAME' is not a valid slug ^[a-z]+(-[a-z]+)*\$, length 3-48) -- fix bank.conf and re-run bank-check.sh" \
      "$PROJECT_NAME" "$PROJECT_SOURCE" "" "$AM_URL" "false" "not checked (malformed config)" \
      "$BANK_ATRY_PATH" "false" "not checked (malformed config)" "" "none"
    echo "Error: BANK_ATRY_NAME '$BANK_ATRY_NAME' is not a valid project slug (^[a-z]+(-[a-z]+)*\$, length 3-48)" >&2
    echo "bank-check: wrote $BANK_STATUS (reachable: false, malformed config)" >&2
    exit 1
  fi
  ATRY_NAME="$BANK_ATRY_NAME"
  ATRY_NAME_SOURCE="config"
fi

# When BANK_ATRY_PATH is set, BANK_ATRY_NAME must be a valid slug (already
# validated above if set; refuse if path set and name missing).
if [[ -n "$BANK_ATRY_PATH" && -z "$ATRY_NAME" ]]; then
  write_status "true" "$BANK_TYPE" "$BANK_PATH" "$BANK_ENDPOINT" "false" \
    "bank.conf malformed (BANK_ATRY_PATH is set but BANK_ATRY_NAME is missing or empty) -- fix bank.conf and re-run bank-check.sh" \
    "$PROJECT_NAME" "$PROJECT_SOURCE" "" "$AM_URL" "false" "not checked (malformed config)" \
    "$BANK_ATRY_PATH" "false" "not checked (malformed config)" "" "none"
  echo "Error: BANK_ATRY_PATH is set but BANK_ATRY_NAME is missing (required when atry path is configured)" >&2
  echo "bank-check: wrote $BANK_STATUS (reachable: false, malformed config)" >&2
  exit 1
fi

WARNINGS=""

if [[ -n "$AM_URL" ]]; then
  if AM_DETAIL="$(probe_agentmemory_health "$AM_URL")"; then
    AM_REACHABLE="true"
  else
    AM_REACHABLE="false"
  fi
fi

# Probe atry vault independently of BANK_TYPE (path may be set for atry-only
# dogfooding alongside agentmemory-only / later vault type).
ATRY_REACHABLE="false"
ATRY_DETAIL="not configured"
if [[ -n "$BANK_ATRY_PATH" ]]; then
  if ATRY_DETAIL="$(probe_vault_path "$BANK_ATRY_PATH")"; then
    ATRY_REACHABLE="true"
  else
    ATRY_REACHABLE="false"
  fi
elif [[ -n "$ATRY_NAME" ]]; then
  ATRY_DETAIL="BANK_ATRY_PATH not set (name only; agentmemory may still use atry_name)"
fi

# Agentmemory-only: BANK_TYPE may be absent when BANK_AGENTMEMORY_URL is set.
if [[ -z "$BANK_TYPE" ]]; then
  if [[ -n "$AM_URL" ]]; then
    # Still record atry vault probe results when path was set.
    if [[ "$ATRY_REACHABLE" == "true" && -n "$ATRY_NAME" ]]; then
      WARNINGS="$(collect_foreign_project_warnings "$BANK_ATRY_PATH" "" "$ATRY_NAME" "0")"
    fi
    write_status "true" "" "$BANK_PATH" "$BANK_ENDPOINT" "false" \
      "agentmemory-only (no BANK_TYPE); vault sink not configured" \
      "$PROJECT_NAME" "$PROJECT_SOURCE" "$WARNINGS" \
      "$AM_URL" "$AM_REACHABLE" "$AM_DETAIL" \
      "$BANK_ATRY_PATH" "$ATRY_REACHABLE" "$ATRY_DETAIL" "$ATRY_NAME" "$ATRY_NAME_SOURCE"
    echo "bank-check: wrote $BANK_STATUS"
    cat "$BANK_STATUS"
    exit 0
  fi
  write_status "true" "" "$BANK_PATH" "$BANK_ENDPOINT" "false" "bank.conf has no BANK_TYPE" \
    "$PROJECT_NAME" "$PROJECT_SOURCE" "" \
    "" "false" "not configured" \
    "$BANK_ATRY_PATH" "$ATRY_REACHABLE" "$ATRY_DETAIL" "$ATRY_NAME" "$ATRY_NAME_SOURCE"
  echo "bank-check: bank.conf present but BANK_TYPE is missing -> $BANK_STATUS"
  exit 0
fi

REACHABLE="false"
DETAIL=""
SAME_PATH="0"
if [[ -n "$BANK_PATH" && -n "$BANK_ATRY_PATH" && "$BANK_PATH" == "$BANK_ATRY_PATH" ]]; then
  SAME_PATH="1"
fi

case "$BANK_TYPE" in
obsidian-vault)
  if [[ -z "$BANK_PATH" ]]; then
    DETAIL="BANK_PATH not set for obsidian-vault"
    REACHABLE="false"
  elif DETAIL="$(probe_vault_path "$BANK_PATH")"; then
    REACHABLE="true"
  else
    REACHABLE="false"
  fi

  WARNINGS=""
  if [[ "$SAME_PATH" == "1" && "$REACHABLE" == "true" ]]; then
    WARNINGS="$(collect_foreign_project_warnings "$BANK_PATH" "$PROJECT_NAME" "$ATRY_NAME" "1")"
  else
    if [[ "$REACHABLE" == "true" && -n "$PROJECT_NAME" ]]; then
      WARNINGS="$(collect_foreign_project_warnings "$BANK_PATH" "$PROJECT_NAME" "" "0")"
    fi
    if [[ "$ATRY_REACHABLE" == "true" && -n "$ATRY_NAME" ]]; then
      w2="$(collect_foreign_project_warnings "$BANK_ATRY_PATH" "" "$ATRY_NAME" "0")"
      WARNINGS="$(append_warnings "$WARNINGS" "$w2")"
    fi
  fi

  write_status "true" "$BANK_TYPE" "$BANK_PATH" "$BANK_ENDPOINT" "$REACHABLE" "$DETAIL" \
    "$PROJECT_NAME" "$PROJECT_SOURCE" "$WARNINGS" \
    "$AM_URL" "$AM_REACHABLE" "$AM_DETAIL" \
    "$BANK_ATRY_PATH" "$ATRY_REACHABLE" "$ATRY_DETAIL" "$ATRY_NAME" "$ATRY_NAME_SOURCE"
  ;;
lightrag-http)
  write_status "true" "$BANK_TYPE" "$BANK_PATH" "$BANK_ENDPOINT" "false" \
    "backend '$BANK_TYPE' is declared but has no driver in this MVP (only obsidian-vault is implemented); see docs/bank.md" \
    "$PROJECT_NAME" "$PROJECT_SOURCE" "" \
    "$AM_URL" "$AM_REACHABLE" "$AM_DETAIL" \
    "$BANK_ATRY_PATH" "$ATRY_REACHABLE" "$ATRY_DETAIL" "$ATRY_NAME" "$ATRY_NAME_SOURCE"
  ;;
*)
  write_status "true" "$BANK_TYPE" "$BANK_PATH" "$BANK_ENDPOINT" "false" "unknown BANK_TYPE '$BANK_TYPE'" \
    "$PROJECT_NAME" "$PROJECT_SOURCE" "" \
    "$AM_URL" "$AM_REACHABLE" "$AM_DETAIL" \
    "$BANK_ATRY_PATH" "$ATRY_REACHABLE" "$ATRY_DETAIL" "$ATRY_NAME" "$ATRY_NAME_SOURCE"
  ;;
esac

echo "bank-check: wrote $BANK_STATUS"
cat "$BANK_STATUS"
