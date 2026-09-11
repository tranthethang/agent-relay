#!/usr/bin/env bash
# scripts/task-init.sh
# Initialize or migrate task directory for agent-relay parallel mode.
# Bash 3.2+ compatible, POSIX tools only.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAIM_SH="$SCRIPT_DIR/task-claim.sh"

usage() {
  cat <<'EOF'
Usage:
  task-init.sh <id>
  task-init.sh <id> --migrate
EOF
  exit 1
}

MIGRATE=0
ID=""

for arg in "$@"; do
  case "$arg" in
    --migrate)
      MIGRATE=1
      ;;
    -h|--help)
      usage
      ;;
    *)
      if [[ -z "$ID" ]]; then
        ID="$arg"
      else
        echo "Error: unexpected argument '$arg'" >&2
        usage
      fi
      ;;
  esac
done

[[ -n "$ID" ]] || usage

# Resolve base dir
BASE_DIR=".agent-relay"
if [[ -d ".agent-relay" ]]; then
  BASE_DIR=".agent-relay"
elif [[ -f "CURRENT" || -f "plan-${ID}.md" || -f "implement-plan-${ID}.md" || -d "implement-plan-${ID}" ]]; then
  BASE_DIR="."
else
  BASE_DIR=".agent-relay"
fi

PLAN_DIR="$BASE_DIR/implement-plan-$ID"
ROLLUP_FILE="$BASE_DIR/implement-plan-$ID.md"
PLAN_FILE="$BASE_DIR/plan-$ID.md"
REPORT_DIR="$BASE_DIR/implement-report-$ID"
REPORT_ROLLUP_FILE="$BASE_DIR/implement-report-$ID.md"

if [[ "$MIGRATE" -eq 1 ]]; then
  # Migration mode
  if [[ ! -f "$ROLLUP_FILE" ]]; then
    echo "Error: legacy file '$ROLLUP_FILE' does not exist to migrate." >&2
    exit 1
  fi

  if [[ -d "$PLAN_DIR" ]]; then
    # Check if non-empty
    if [[ -n "$(ls -A "$PLAN_DIR" 2>/dev/null)" ]]; then
      echo "Error: destination directory '$PLAN_DIR' already exists and is not empty." >&2
      exit 1
    fi
  else
    mkdir -p "$PLAN_DIR"
  fi

  META_TMP="$PLAN_DIR/_meta.tmp"
  ORDER_TMP="$PLAN_DIR/.order.tmp"
  : > "$META_TMP"
  : > "$ORDER_TMP"

  while IFS= read -r line || [[ -n "$line" ]]; do
    # Check if line is a task entry: - [<status>] <task-id>: <desc>
    if [[ "$line" =~ ^[[:space:]]*-[[:space:]]*\[([^]]+)\][[:space:]]*([^:]+):[[:space:]]*(.*)$ ]]; then
      status="${BASH_REMATCH[1]}"
      tid="${BASH_REMATCH[2]}"
      desc="${BASH_REMATCH[3]}"
      # Trim
      status="$(echo "$status" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
      tid="$(echo "$tid" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
      desc="$(echo "$desc" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

      echo "$tid" >> "$ORDER_TMP"
      printf 'status: %s\ndesc: %s\ndeps: \n' "$status" "$desc" > "$PLAN_DIR/$tid.status"
    else
      echo "$line" >> "$META_TMP"
    fi
  done < "$ROLLUP_FILE"

  # Move meta file into place if it has non-blank content
  if grep -q '[^[:space:]]' "$META_TMP" 2>/dev/null; then
    mv -f "$META_TMP" "$PLAN_DIR/_meta.md"
  else
    rm -f "$META_TMP"
    : > "$PLAN_DIR/_meta.md"
  fi

  mv -f "$ORDER_TMP" "$PLAN_DIR/.order"

  # Keep original as .bak
  mv "$ROLLUP_FILE" "$ROLLUP_FILE.bak"

  # Regenerate rollup
  "$CLAIM_SH" rollup "$ID"
  echo "Migrated '$ROLLUP_FILE' -> '$PLAN_DIR/' (backup saved to '$ROLLUP_FILE.bak')"

  # Migrate report if exists
  if [[ -f "$REPORT_ROLLUP_FILE" && ! -d "$REPORT_DIR" ]]; then
    mkdir -p "$REPORT_DIR"
    # Basic migration: move whole body into _meta.md
    cp "$REPORT_ROLLUP_FILE" "$REPORT_DIR/_meta.md"
    mv "$REPORT_ROLLUP_FILE" "$REPORT_ROLLUP_FILE.bak"
    "$CLAIM_SH" report-rollup "$ID"
    echo "Migrated '$REPORT_ROLLUP_FILE' -> '$REPORT_DIR/' (backup saved to '$REPORT_ROLLUP_FILE.bak')"
  fi

else
  # Init from plan
  if [[ ! -f "$PLAN_FILE" ]]; then
    # Check legacy unsuffixed plan.md
    if [[ -f "$BASE_DIR/plan.md" ]]; then
      PLAN_FILE="$BASE_DIR/plan.md"
    else
      echo "Error: plan file '$PLAN_FILE' not found." >&2
      exit 1
    fi
  fi

  # Refuse to clobber an existing sequential rollup — that loses statuses.
  # Callers must --migrate (preserves .bak) or remove the file first.
  if [[ -f "$ROLLUP_FILE" ]]; then
    echo "Error: legacy file '$ROLLUP_FILE' already exists." >&2
    echo "Use --migrate to convert it (preserves statuses + .bak), or remove it to re-init from the plan." >&2
    exit 1
  fi

  if [[ -d "$PLAN_DIR" ]]; then
    if [[ -n "$(ls -A "$PLAN_DIR" 2>/dev/null)" ]]; then
      echo "Error: plan directory '$PLAN_DIR' already exists and is not empty." >&2
      exit 1
    fi
  else
    mkdir -p "$PLAN_DIR"
  fi

  : > "$PLAN_DIR/_meta.md"
  ORDER_TMP="$PLAN_DIR/.order.tmp"
  : > "$ORDER_TMP"

  found_count=0

  # Two-pass: first check if a ## Tasks section exists to know whether to scope parsing
  has_tasks_section=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^##[[:space:]]+Tasks ]]; then
      has_tasks_section=1
      break
    fi
  done < "$PLAN_FILE"

  in_tasks=0

  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^##[[:space:]]+Tasks ]]; then
      in_tasks=1
      continue
    elif [[ "$line" =~ ^##[[:space:]]+ && "$in_tasks" -eq 1 ]]; then
      in_tasks=0
    fi

    # Only parse items when inside ## Tasks (or if file has no ## Tasks section at all — fallback)
    [[ "$in_tasks" -eq 1 || "$has_tasks_section" -eq 0 ]] || continue

    # We parse numbered list: 1. ...
    if [[ "$line" =~ ^[[:space:]]*([0-9]+)\.[[:space:]]+(.*)$ ]]; then
      num="${BASH_REMATCH[1]}"
      rest="${BASH_REMATCH[2]}"
      tid="T$num"
      desc="$(echo "$rest" | sed -e 's/^\*\*//' -e 's/\.\*\*/\*\*/' -e 's/\*\*[[:space:]]*[:-]\{0,1\}[[:space:]]*/: /' -e 's/: :/: /' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
      deps=""
      re='[[:space:]]*\(?deps:[[:space:]]*([^)]+)\)?$'
      if [[ "$desc" =~ $re ]]; then
        deps="${BASH_REMATCH[1]}"
        desc="${desc%%${BASH_REMATCH[0]}}"
        desc="$(echo "$desc" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
        deps="$(echo "$deps" | sed -e 's/,/ /g' | xargs)"
      fi
      echo "$tid" >> "$ORDER_TMP"
      printf 'status: pending\ndesc: %s\ndeps: %s\n' "$desc" "$deps" > "$PLAN_DIR/$tid.status"
      found_count=$((found_count + 1))
    elif [[ "$line" =~ ^[[:space:]]*-[[:space:]]*\[([^]]*)\][[:space:]]*([^:]+):[[:space:]]*(.*)$ ]]; then
      # Format: - [pending] T1: desc
      s="${BASH_REMATCH[1]}"
      tid="${BASH_REMATCH[2]}"
      desc="${BASH_REMATCH[3]}"
      tid="$(echo "$tid" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
      desc="$(echo "$desc" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
      deps=""
      re='[[:space:]]*\(?deps:[[:space:]]*([^)]+)\)?$'
      if [[ "$desc" =~ $re ]]; then
        deps="${BASH_REMATCH[1]}"
        desc="${desc%%${BASH_REMATCH[0]}}"
        desc="$(echo "$desc" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
        deps="$(echo "$deps" | sed -e 's/,/ /g' | xargs)"
      fi
      [[ -n "$s" ]] || s="pending"
      echo "$tid" >> "$ORDER_TMP"
      printf 'status: %s\ndesc: %s\ndeps: %s\n' "$s" "$desc" "$deps" > "$PLAN_DIR/$tid.status"
      found_count=$((found_count + 1))
    fi
  done < "$PLAN_FILE"

  mv -f "$ORDER_TMP" "$PLAN_DIR/.order"

  mkdir -p "$REPORT_DIR"
  : > "$REPORT_DIR/_meta.md"

  "$CLAIM_SH" rollup "$ID"
  "$CLAIM_SH" report-rollup "$ID"
  echo "Initialized '$PLAN_DIR/' and '$REPORT_DIR/' with $found_count task(s)."
fi
