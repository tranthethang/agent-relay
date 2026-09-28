#!/usr/bin/env bash
# scripts/runtime/bank-init.sh
# Create .agent-relay/bank.conf from the commented template next to this
# script (bank.conf.example), optionally filling in values, then run
# bank-check.sh once so the developer sees the result.
#
# Never overwrites an existing bank.conf. Never creates vault paths. Values
# are checked with the same rules bank-check.sh applies, before anything is
# written. Bash 3.2+ compatible, POSIX tools only.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bank-init.sh [<start-dir>] [--path <vault-folder>] [--project <slug>]
               [--atry-path <vault-folder>] [--atry-name <slug>]
               [--agentmemory-url <http(s)://host[:port]>]

Writes .agent-relay/bank.conf for the repo that contains <start-dir>
(default: current directory). Without options, every key line is left
commented out. --path also turns on BANK_TYPE=obsidian-vault.
--atry-path / --atry-name turn on the atry lane block (when path is set,
name is required).

Exit codes are those of the bank check that runs afterwards
(0 ok, 1 malformed config), or:
Exit 1: bad arguments, invalid value, or bank.conf already exists
        (nothing written).
Exit 2: no .agent-relay/ directory or git repository above <start-dir>.
EOF
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/runtime/find-agent-relay-dir.sh
source "$SCRIPT_DIR/find-agent-relay-dir.sh"
TEMPLATE="$SCRIPT_DIR/bank.conf.example"

START_DIR=""
OPT_PATH=""
OPT_PROJECT=""
OPT_ATRY_PATH=""
OPT_ATRY_NAME=""
OPT_AM_URL=""
while [[ $# -gt 0 ]]; do
  case "$1" in
  --path | --project | --atry-path | --atry-name | --agentmemory-url)
    [[ $# -ge 2 && -n "$2" ]] || {
      echo "Error: $1 requires a value" >&2
      exit 1
    }
    case "$1" in
    --path) OPT_PATH="$2" ;;
    --project) OPT_PROJECT="$2" ;;
    --atry-path) OPT_ATRY_PATH="$2" ;;
    --atry-name) OPT_ATRY_NAME="$2" ;;
    --agentmemory-url) OPT_AM_URL="$2" ;;
    esac
    shift 2
    ;;
  -h | --help) usage ;;
  -*)
    echo "Error: unknown option '$1'" >&2
    usage
    ;;
  *)
    [[ -z "$START_DIR" ]] || usage
    START_DIR="$1"
    shift
    ;;
  esac
done
START_DIR="${START_DIR:-$PWD}"

[[ -d "$START_DIR" ]] || {
  echo "Error: not a directory: $START_DIR" >&2
  exit 1
}
[[ -f "$TEMPLATE" ]] || {
  echo "Error: template not found: $TEMPLATE (re-run install.sh)" >&2
  exit 1
}

unsafe_value() {
  case "$1" in
  *'$('* | *'`'* | *';'* | *'&&'* | *'||'* | *'|'* | *'>'* | *'<'* | *$'\n'*) return 0 ;;
  esac
  return 1
}

normalize_abs_path_opt() {
  local opt_name="$1" p="$2"
  if unsafe_value "$p"; then
    echo "Error: $opt_name contains characters bank.conf cannot hold: $p" >&2
    exit 1
  fi
  case "$p" in
  /*) ;;
  *)
    echo "Error: $opt_name must be an absolute path: $p" >&2
    exit 1
    ;;
  esac
  if [[ "$p" == */ && "$p" != "/" ]]; then
    p="${p%/}"
  fi
  printf '%s' "$p"
}

valid_slug_opt() {
  local opt_name="$1" s="$2"
  if [[ ${#s} -lt 3 || ${#s} -gt 48 || ! "$s" =~ ^[a-z]+(-[a-z]+)*$ ]]; then
    echo "Error: $opt_name must be lowercase letters and single hyphens, 3-48 characters: $s" >&2
    exit 1
  fi
}

if [[ -n "$OPT_PATH" ]]; then
  OPT_PATH="$(normalize_abs_path_opt --path "$OPT_PATH")"
fi
if [[ -n "$OPT_PROJECT" ]]; then
  valid_slug_opt --project "$OPT_PROJECT"
fi
if [[ -n "$OPT_ATRY_PATH" ]]; then
  OPT_ATRY_PATH="$(normalize_abs_path_opt --atry-path "$OPT_ATRY_PATH")"
fi
if [[ -n "$OPT_ATRY_NAME" ]]; then
  valid_slug_opt --atry-name "$OPT_ATRY_NAME"
fi
if [[ -n "$OPT_ATRY_PATH" && -z "$OPT_ATRY_NAME" ]]; then
  echo "Error: --atry-path requires --atry-name" >&2
  exit 1
fi
if [[ -n "$OPT_AM_URL" ]]; then
  if [[ "$OPT_AM_URL" == */ ]]; then
    OPT_AM_URL="${OPT_AM_URL%/}"
  fi
  if [[ ! "$OPT_AM_URL" =~ ^https?://[A-Za-z0-9._-]+(:[0-9]{1,5})?$ ]]; then
    echo "Error: --agentmemory-url must be http(s)://host[:port] with no path: $OPT_AM_URL" >&2
    exit 1
  fi
fi

if ! AGENT_RELAY_DIR="$(find_agent_relay_dir "$START_DIR")"; then
  echo "bank-init: no .agent-relay/ directory or git repository found above $START_DIR" >&2
  exit 2
fi
BANK_CONF="$AGENT_RELAY_DIR/bank.conf"

if [[ -e "$BANK_CONF" ]]; then
  echo "Error: $BANK_CONF already exists; edit it instead (nothing written)" >&2
  exit 1
fi

mkdir -p "$AGENT_RELAY_DIR"

tmp="$(mktemp "${TMPDIR:-/tmp}/ar-bank-conf.XXXXXX")"
OPT_PATH="$OPT_PATH" OPT_PROJECT="$OPT_PROJECT" \
  OPT_ATRY_PATH="$OPT_ATRY_PATH" OPT_ATRY_NAME="$OPT_ATRY_NAME" \
  OPT_AM_URL="$OPT_AM_URL" awk '
  BEGIN {
    p = ENVIRON["OPT_PATH"]; pr = ENVIRON["OPT_PROJECT"]
    ap = ENVIRON["OPT_ATRY_PATH"]; an = ENVIRON["OPT_ATRY_NAME"]
    am = ENVIRON["OPT_AM_URL"]
  }
  /^# BANK_TYPE=/ && p != "" { print "BANK_TYPE=obsidian-vault"; next }
  /^# BANK_PATH=/ && p != "" { print "BANK_PATH=" p; next }
  /^# BANK_PROJECT_NAME=/ && pr != "" { print "BANK_PROJECT_NAME=" pr; next }
  /^# BANK_ATRY_PATH=/ && ap != "" { print "BANK_ATRY_PATH=" ap; next }
  /^# BANK_ATRY_NAME=/ && an != "" { print "BANK_ATRY_NAME=" an; next }
  /^# BANK_AGENTMEMORY_URL=/ && am != "" { print "BANK_AGENTMEMORY_URL=" am; next }
  { print }
' "$TEMPLATE" >"$tmp"
cat "$tmp" >"$BANK_CONF"
rm -f "$tmp"
echo "bank-init: wrote $BANK_CONF"

if [[ -n "$OPT_PATH" && ! -d "$OPT_PATH" ]]; then
  echo "bank-init: note: $OPT_PATH does not exist yet; create it yourself (atry never creates BANK_PATH)" >&2
fi
if [[ -n "$OPT_ATRY_PATH" && ! -d "$OPT_ATRY_PATH" ]]; then
  echo "bank-init: note: $OPT_ATRY_PATH does not exist yet; create it yourself (atry never creates BANK_ATRY_PATH)" >&2
fi

set +e
"$SCRIPT_DIR/bank-check.sh" "$START_DIR"
rc=$?
set -e
exit "$rc"
