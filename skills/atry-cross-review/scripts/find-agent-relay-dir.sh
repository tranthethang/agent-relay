#!/usr/bin/env bash
# scripts/find-agent-relay-dir.sh
# Resolve the .agent-relay/ directory for a given start directory (or cwd).
# Walks up looking for an existing .agent-relay/, or the nearest .git root.
# Bash 3.2+ compatible, POSIX tools only.
set -euo pipefail

find_agent_relay_dir() {
  local start="${1:-$PWD}"
  local dir
  dir="$(cd "$start" 2>/dev/null && pwd -P || pwd)"
  local start_abs="$dir"
  while true; do
    if [[ -d "$dir/.agent-relay" ]]; then
      printf '%s\n' "$dir/.agent-relay"
      return 0
    fi
    if [[ -d "$dir/.git" || -f "$dir/.git" ]]; then
      printf '%s\n' "$dir/.agent-relay"
      return 0
    fi
    if [[ "$dir" == "/" ]]; then
      break
    fi
    dir="$(dirname "$dir")"
  done
  printf '%s\n' "$start_abs/.agent-relay"
  return 0
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  START_DIR="${1:-$PWD}"
  [[ -d "$START_DIR" ]] || { echo "Error: not a directory: $START_DIR" >&2; exit 1; }
  find_agent_relay_dir "$START_DIR"
fi
