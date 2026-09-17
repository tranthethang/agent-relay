#!/usr/bin/env bash
# scripts/run-init.sh
# Initialize an agent-relay run directory under .agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/
# Bash 3.2+ compatible, POSIX tools only.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  run-init.sh <RUN_ID> --slug <slug> [--title <title>] [--base <base-ref>] [--tool <tool>]
EOF
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/find-agent-relay-dir.sh
source "$SCRIPT_DIR/find-agent-relay-dir.sh"

# Walk up from cwd looking for .agent-relay/ (stop at / or git root).
find_base_dir() {
  find_agent_relay_dir "$PWD"
}

if [[ $# -lt 1 ]]; then
  usage
fi

ID=""
SLUG=""
TITLE="(untitled)"
BASE=""
TOOL="unknown"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --slug)
      [[ $# -ge 2 ]] || { echo "Error: --slug requires an argument" >&2; exit 1; }
      SLUG="$2"
      shift 2
      ;;
    --tool)
      [[ $# -ge 2 ]] || { echo "Error: --tool requires an argument" >&2; exit 1; }
      TOOL="$2"
      shift 2
      ;;
    --title)
      [[ $# -ge 2 ]] || { echo "Error: --title requires an argument" >&2; exit 1; }
      TITLE="$2"
      shift 2
      ;;
    --base)
      [[ $# -ge 2 ]] || { echo "Error: --base requires an argument" >&2; exit 1; }
      BASE="$2"
      shift 2
      ;;
    -*)
      echo "Error: unknown option '$1'" >&2
      usage
      ;;
    *)
      if [[ -z "$ID" ]]; then
        ID="$1"
      elif [[ "$TITLE" == "(untitled)" ]]; then
        TITLE="$1"
      elif [[ -z "$BASE" ]]; then
        BASE="$1"
      fi
      shift
      ;;
  esac
done

if [[ -z "$ID" ]]; then
  usage
fi

if [[ -z "$SLUG" ]]; then
  echo "Error: --slug is required" >&2
  exit 1
fi

# Validate ID (Unix timestamp in seconds, 10-11 digits)
case "$ID" in
  *[!0-9]*|"")
    echo "Error: invalid RUN_ID '$ID' (must be a Unix timestamp in seconds, 10-11 digits)" >&2
    exit 1
    ;;
esac
if [[ ${#ID} -lt 10 || ${#ID} -gt 11 ]]; then
  echo "Error: invalid RUN_ID '$ID' (must be a Unix timestamp in seconds, 10-11 digits)" >&2
  exit 1
fi

# Validate slug: length 3-48, pattern ^[a-z]+(-[a-z]+)*$
if [[ ${#SLUG} -lt 3 || ${#SLUG} -gt 48 ]]; then
  echo "Error: invalid slug '$SLUG' (length must be between 3 and 48 characters)" >&2
  exit 1
fi

if [[ ! "$SLUG" =~ ^[a-z]+(-[a-z]+)*$ ]]; then
  echo "Error: invalid slug '$SLUG' (must match ^[a-z]+(-[a-z]+)*$)" >&2
  exit 1
fi

if [[ -z "$BASE" ]]; then
  BASE="$(git rev-parse HEAD 2>/dev/null || echo "unknown")"
fi

BASE_DIR="$(find_base_dir)"
mkdir -p "$BASE_DIR"

YMD="$(date +%Y%m%d)"
MAX_RETRIES=5
attempt=0
RUN_DIR=""

while true; do
  RUN_DIR_NAME="${YMD}-${ID}-${SLUG}"
  CANDIDATE="$BASE_DIR/$RUN_DIR_NAME"
  if [[ ! -e "$CANDIDATE" ]]; then
    RUN_DIR="$CANDIDATE"
    break
  fi
  attempt=$((attempt + 1))
  if [[ $attempt -gt $MAX_RETRIES ]]; then
    echo "Error: run directory already exists at $CANDIDATE (collision retry limit reached)" >&2
    exit 1
  fi
  ID=$((ID + 1))
done

mkdir -p "$RUN_DIR"

CREATED_DATE="$(date +%F)"

cat <<EOF > "$RUN_DIR/meta.md"
id: $ID
slug: $SLUG
created: $CREATED_DATE
title: $TITLE
stage: plan
status: active
base: $BASE
EOF

NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '%s stage=plan action=created tool=%s\n' "$NOW_ISO" "$TOOL" >> "$RUN_DIR/history.log"

abs_run_dir="$(cd "$RUN_DIR" && pwd -P)"
printf '%s\n' "$abs_run_dir"
