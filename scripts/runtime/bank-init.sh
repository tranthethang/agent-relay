#!/usr/bin/env bash
# scripts/runtime/bank-init.sh
# Create .agent-relay/bank.conf from the commented template next to this
# script (bank.conf.example), optionally filling in values, then run
# bank-check.sh once so the developer sees the result.
#
# Never overwrites an existing bank.conf. Never creates BANK_PATH. Values are
# checked with the same rules bank-check.sh applies, before anything is
# written. Bash 3.2+ compatible, POSIX tools only.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bank-init.sh [<start-dir>] [--path <vault-folder>] [--project <slug>]
               [--agentmemory-url <http(s)://host[:port]>]

Writes .agent-relay/bank.conf for the repo that contains <start-dir>
(default: current directory). Without options, every key line is left
commented out. --path also turns on BANK_TYPE=obsidian-vault.

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
OPT_AM_URL=""
while [[ $# -gt 0 ]]; do
  case "$1" in
  --path | --project | --agentmemory-url)
    [[ $# -ge 2 && -n "$2" ]] || {
      echo "Error: $1 requires a value" >&2
      exit 1
    }
    case "$1" in
    --path) OPT_PATH="$2" ;;
    --project) OPT_PROJECT="$2" ;;
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

# Same unsafe-character rule as bank-check.sh, so a value we write is never
# one the parser would refuse.
unsafe_value() {
  case "$1" in
  *'$('* | *'`'* | *';'* | *'&&'* | *'||'* | *'|'* | *'>'* | *'<'* | *$'\n'*) return 0 ;;
  esac
  return 1
}

if [[ -n "$OPT_PATH" ]]; then
  if unsafe_value "$OPT_PATH"; then
    echo "Error: --path contains characters bank.conf cannot hold: $OPT_PATH" >&2
    exit 1
  fi
  case "$OPT_PATH" in
  /*) ;;
  *)
    echo "Error: --path must be an absolute path: $OPT_PATH" >&2
    exit 1
    ;;
  esac
  if [[ "$OPT_PATH" == */ && "$OPT_PATH" != "/" ]]; then
    OPT_PATH="${OPT_PATH%/}"
  fi
fi
if [[ -n "$OPT_PROJECT" ]]; then
  if [[ ${#OPT_PROJECT} -lt 3 || ${#OPT_PROJECT} -gt 48 || ! "$OPT_PROJECT" =~ ^[a-z]+(-[a-z]+)*$ ]]; then
    echo "Error: --project must be lowercase letters and single hyphens, 3-48 characters: $OPT_PROJECT" >&2
    exit 1
  fi
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

# Uncomment / fill the template's "# BANK_KEY=..." lines for the given options.
tmp="$(mktemp "${TMPDIR:-/tmp}/ar-bank-conf.XXXXXX")"
OPT_PATH="$OPT_PATH" OPT_PROJECT="$OPT_PROJECT" OPT_AM_URL="$OPT_AM_URL" awk '
  BEGIN {
    p = ENVIRON["OPT_PATH"]; pr = ENVIRON["OPT_PROJECT"]; am = ENVIRON["OPT_AM_URL"]
  }
  /^# BANK_TYPE=/ && p != "" { print "BANK_TYPE=obsidian-vault"; next }
  /^# BANK_PATH=/ && p != "" { print "BANK_PATH=" p; next }
  /^# BANK_PROJECT_NAME=/ && pr != "" { print "BANK_PROJECT_NAME=" pr; next }
  /^# BANK_AGENTMEMORY_URL=/ && am != "" { print "BANK_AGENTMEMORY_URL=" am; next }
  { print }
' "$TEMPLATE" >"$tmp"
cat "$tmp" >"$BANK_CONF"
rm -f "$tmp"
echo "bank-init: wrote $BANK_CONF"

if [[ -n "$OPT_PATH" && ! -d "$OPT_PATH" ]]; then
  echo "bank-init: note: $OPT_PATH does not exist yet; create it yourself (atry never creates BANK_PATH)" >&2
fi

# Run the check once so the result is visible right away.
set +e
"$SCRIPT_DIR/bank-check.sh" "$START_DIR"
rc=$?
set -e
exit "$rc"
