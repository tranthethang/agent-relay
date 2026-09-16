#!/usr/bin/env bash
# scripts/run-init.sh
# Initialize an agent-relay run directory under .agent-relay/{YMD}_{RUN_ID}/
# Bash 3.2+ compatible, POSIX tools only.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  run-init.sh <RUN_ID> [--title <title>] [--base <base-ref>]
  run-init.sh <RUN_ID> [<title>] [<base-ref>]
EOF
  exit 1
}

# Walk up from cwd looking for .agent-relay/ (stop at / or git root).
find_base_dir() {
  local dir="$PWD"
  while true; do
    if [[ -d "$dir/.agent-relay" ]]; then
      printf '%s\n' "$dir/.agent-relay"
      return 0
    fi
    if [[ "$dir" == "/" ]]; then
      break
    fi
    if [[ -d "$dir/.git" || -f "$dir/.git" ]]; then
      break
    fi
    dir="$(dirname "$dir")"
  done
  # Fallback: relative .agent-relay under cwd
  printf '%s\n' ".agent-relay"
}

if [[ $# -lt 1 ]]; then
  usage
fi

ID="$1"
shift

# Validate ID
case "$ID" in
  *[!A-Za-z0-9._-]*|"")
    echo "Error: invalid RUN_ID '$ID'" >&2
    exit 1
    ;;
esac

TITLE="(untitled)"
BASE=""

# Parse remaining options
while [[ $# -gt 0 ]]; do
  case "$1" in
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
    *)
      if [[ "$TITLE" == "(untitled)" ]]; then
        TITLE="$1"
      elif [[ -z "$BASE" ]]; then
        BASE="$1"
      fi
      shift
      ;;
  esac
done

if [[ -z "$BASE" ]]; then
  BASE="$(git rev-parse HEAD 2>/dev/null || echo "unknown")"
fi

BASE_DIR="$(find_base_dir)"
mkdir -p "$BASE_DIR"

YMD="$(date +%Y%m%d)"
RUN_DIR_NAME="${YMD}_${ID}"
RUN_DIR="$BASE_DIR/$RUN_DIR_NAME"

if [[ -d "$RUN_DIR" && -f "$RUN_DIR/meta.md" ]]; then
  echo "Error: run directory already exists at $RUN_DIR" >&2
  exit 1
fi

mkdir -p "$RUN_DIR"

CREATED_DATE="$(date +%F)"

cat <<EOF > "$RUN_DIR/meta.md"
id: $ID
created: $CREATED_DATE
title: $TITLE
stage: plan
status: active
base: $BASE
EOF

NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '%s stage=plan action=created\n' "$NOW_ISO" >> "$RUN_DIR/history.log"

abs_run_dir="$(cd "$RUN_DIR" && pwd -P)"
printf '%s\n' "$abs_run_dir"
