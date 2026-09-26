#!/usr/bin/env bash
# scripts/runtime/find-agent-relay-dir.sh
# Resolve the .agent-relay/ directory for a given start directory (or cwd).
# Walks up looking for an existing .agent-relay/, or the nearest .git root.
# Bash 3.2+ compatible, POSIX tools only.
set -euo pipefail

# Prints the .agent-relay/ path to use and returns 0 when either an existing
# .agent-relay/ or a git root (.git file or directory) is found walking up
# from <start> (default: cwd) to /. Returns 1 with no output when neither is
# found anywhere above <start> -- callers must not guess a location (no
# fallback to $start/.agent-relay); they should error with an actionable hint
# instead (see run-init.sh / resolve-run.sh).
# An .agent-relay/ that holds the installed atry CLI (bin/atry + lib/, i.e.
# ~/.agent-relay) is never a run root: without this, running atry from a
# non-git folder under $HOME would walk up to the install tree and write run
# dirs into it. Such a directory is skipped (walking continues upward).
is_atry_install_dir() {
  [[ -f "$1/bin/atry" && -d "$1/lib" ]]
}

find_agent_relay_dir() {
  local start="${1:-$PWD}"
  local dir
  dir="$(cd "$start" 2>/dev/null && pwd -P || pwd)"
  while true; do
    if ! is_atry_install_dir "$dir/.agent-relay"; then
      if [[ -d "$dir/.agent-relay" ]]; then
        printf '%s\n' "$dir/.agent-relay"
        return 0
      fi
      if [[ -d "$dir/.git" || -f "$dir/.git" ]]; then
        printf '%s\n' "$dir/.agent-relay"
        return 0
      fi
    fi
    if [[ "$dir" == "/" ]]; then
      break
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  START_DIR="${1:-$PWD}"
  [[ -d "$START_DIR" ]] || {
    echo "Error: not a directory: $START_DIR" >&2
    exit 1
  }
  find_agent_relay_dir "$START_DIR"
fi
