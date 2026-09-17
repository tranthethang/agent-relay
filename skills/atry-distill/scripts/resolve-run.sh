#!/usr/bin/env bash
# scripts/resolve-run.sh
# Resolves the absolute path of an agent-relay run directory.
# Bash 3.2+ compatible, POSIX tools only.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  resolve-run.sh [<RUN_ID> | <path>]

Resolves and prints the absolute path of an agent-relay run directory.
If no argument is given, resolves if exactly one run directory exists.
Exits non-zero if not found or ambiguous.
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

is_run_dirname() {
  local name="$1"
  if [[ "$name" =~ ^[0-9]{8}-[0-9]{10,11}-[a-z]+(-[a-z]+)*$ ]]; then
    return 0
  fi
  return 1
}

# 1. Argument was provided
if [[ $# -ge 1 && -n "${1:-}" ]]; then
  arg="$1"

  # Check if argument is a path or an existing file/directory
  if [[ "$arg" == *"/"* || "$arg" == "."* || -e "$arg" ]]; then
    # Resolve directory part
    if [[ -d "$arg" ]]; then
      target_dir="$arg"
    else
      target_dir="$(dirname "$arg")"
    fi
    abs_target="$(cd "$target_dir" 2>/dev/null && pwd -P || pwd)"

    # Check if target is or is inside a run directory
    check_dir="$abs_target"
    while true; do
      base_name="$(basename "$check_dir")"
      parent_name="$(basename "$(dirname "$check_dir")")"

      if is_run_dirname "$base_name" && [[ "$parent_name" == ".agent-relay" ]]; then
        printf '%s\n' "$check_dir"
        exit 0
      fi

      if [[ "$check_dir" == "/" ]]; then
        break
      fi
      check_dir="$(dirname "$check_dir")"
    done

    # If it's a directory matching run dir name format directly
    if is_run_dirname "$(basename "$abs_target")"; then
      printf '%s\n' "$abs_target"
      exit 0
    fi

    echo "Error: path '$arg' is not inside an agent-relay run directory" >&2
    exit 1
  fi

  # Argument is a RUN_ID
  id="$arg"
  case "$id" in
    *[!A-Za-z0-9._-]*|"")
      echo "Error: invalid RUN_ID '$id'" >&2
      exit 1
      ;;
  esac

  BASE_DIR="$(find_base_dir)"
  if [[ ! -d "$BASE_DIR" ]]; then
    echo "Error: .agent-relay directory not found" >&2
    exit 1
  fi

  # Search for matching run directory
  shopt -s nullglob
  matches=()
  for d in "$BASE_DIR"/*; do
    [[ -d "$d" ]] || continue
    bname="$(basename "$d")"
    if ! is_run_dirname "$bname"; then
      continue
    fi
    if [[ "$bname" == "$id" ]]; then
      matches+=("$d")
    elif [[ "$bname" =~ ^[0-9]{8}-([0-9]{10,11})-([a-z]+(-[a-z]+)*)$ ]]; then
      ts="${BASH_REMATCH[1]}"
      slug="${BASH_REMATCH[2]}"
      if [[ "$ts" == "$id" || "$slug" == "$id" ]]; then
        matches+=("$d")
      fi
    fi
  done
  shopt -u nullglob

  if [[ ${#matches[@]} -eq 1 ]]; then
    abs_path="$(cd "${matches[0]}" && pwd -P)"
    printf '%s\n' "$abs_path"
    exit 0
  fi

  if [[ ${#matches[@]} -gt 1 ]]; then
    echo "Error: ambiguous RUN_ID '$id' matches multiple run directories" >&2
    exit 1
  fi

  echo "Error: no run directory found for '$id'" >&2
  exit 1
fi

# 2. No argument provided: check if cwd is inside a run directory
check_dir="$PWD"
while true; do
  base_name="$(basename "$check_dir")"
  parent_name="$(basename "$(dirname "$check_dir")")"

  if is_run_dirname "$base_name" && [[ "$parent_name" == ".agent-relay" ]]; then
    cd "$check_dir" && pwd -P
    exit 0
  fi

  if [[ "$check_dir" == "/" ]]; then
    break
  fi
  check_dir="$(dirname "$check_dir")"
done

# Check run directories under .agent-relay
BASE_DIR="$(find_base_dir)"
if [[ ! -d "$BASE_DIR" ]]; then
  echo "Error: .agent-relay directory not found" >&2
  exit 1
fi

shopt -s nullglob
raw_dirs=("$BASE_DIR"/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-*)
shopt -u nullglob

run_dirs=()
for d in "${raw_dirs[@]}"; do
  if [[ -d "$d" ]] && is_run_dirname "$(basename "$d")"; then
    run_dirs+=("$d")
  fi
done

if [[ ${#run_dirs[@]} -eq 1 ]]; then
  cd "${run_dirs[0]}" && pwd -P
  exit 0
fi

if [[ ${#run_dirs[@]} -gt 1 ]]; then
  echo "Error: multiple run directories found in $BASE_DIR; specify RUN_ID or path" >&2
  exit 1
fi

echo "Error: no run directory found in $BASE_DIR" >&2
exit 1
