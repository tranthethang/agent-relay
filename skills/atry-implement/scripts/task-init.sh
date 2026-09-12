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

validate_ident() {
  local kind="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "Error: $kind must not be empty" >&2
    exit 1
  fi
  if [[ "$value" == "." || "$value" == ".." ]]; then
    echo "Error: $kind '$value' is not allowed" >&2
    exit 1
  fi
  case "$value" in
    *[!A-Za-z0-9._-]*)
      echo "Error: $kind '$value' must match ^[A-Za-z0-9._-]+$" >&2
      exit 1
      ;;
  esac
}

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
  printf '%s\n' ".agent-relay"
}

# Strip markdown bold/backticks from a task description remnant.
clean_desc() {
  local rest="$1"
  # Drop leading **bold** label forms: **Label.** rest / **Label**: rest / **Label** rest
  rest="$(printf '%s' "$rest" | sed \
    -e 's/^\*\*[^*][^*]*\*\*[[:space:]]*[:-][[:space:]]*//' \
    -e 's/^\*\*[^*][^*]*\.\*\*[[:space:]]*//' \
    -e 's/^\*\*[^*][^*]*\*\*[[:space:]]*//' \
    -e 's/`//g' \
    -e 's/^[[:space:]]*//' \
    -e 's/[[:space:]]*$//')"
  # Collapse doubled colons left by awkward markdown
  rest="$(printf '%s' "$rest" | sed -e 's/^:[[:space:]]*//' -e 's/: :/: /')"
  printf '%s' "$rest"
}

extract_deps() {
  # Sets globals: DESC_OUT DEPS_OUT from input desc string
  local desc="$1"
  local deps=""
  local re='[[:space:]]*\(deps:[[:space:]]*([^)]+)\)[[:space:]]*$'
  if [[ "$desc" =~ $re ]]; then
    deps="${BASH_REMATCH[1]}"
    desc="${desc%%${BASH_REMATCH[0]}}"
    desc="$(printf '%s' "$desc" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    # xargs may fail under tight sandbox ARG_MAX; fall back to tr.
    deps="$(printf '%s' "$deps" | sed -e 's/,/ /g' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/[[:space:]][[:space:]]*/ /g')"
  fi
  DESC_OUT="$desc"
  DEPS_OUT="$deps"
}

# Cycle detection on deps graph. Prints cycle and exits 1 if found.
check_dep_cycles() {
  local plan_dir="$1"
  # Kahn's algorithm without associative arrays (bash 3.2).
  local tids=""
  local f fname tid
  for f in "$plan_dir"/*.status; do
    [[ -f "$f" ]] || continue
    fname="${f##*/}"
    tid="${fname%.status}"
    tids="$tids $tid"
  done

  # Build indegree file and edges file in a temp dir
  local tmp
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/ar-cycle.XXXXXX")"
  : > "$tmp/edges"
  : > "$tmp/nodes"
  for tid in $tids; do
    echo "$tid" >> "$tmp/nodes"
    echo "0" > "$tmp/indegree.$tid"
  done

  for tid in $tids; do
    local deps
    deps="$(grep -E '^deps:' "$plan_dir/$tid.status" 2>/dev/null | head -n 1 | sed -e 's/^deps:[[:space:]]*//' || true)"
    local dep
    for dep in $deps; do
      if [[ ! -f "$plan_dir/$dep.status" ]]; then
        echo "Error: task '$tid' depends on unknown task '$dep'" >&2
        rm -rf "$tmp"
        exit 1
      fi
      echo "$dep $tid" >> "$tmp/edges"
      local n
      n="$(cat "$tmp/indegree.$tid")"
      echo $((n + 1)) > "$tmp/indegree.$tid"
    done
  done

  local queue=""
  for tid in $tids; do
    if [[ "$(cat "$tmp/indegree.$tid")" -eq 0 ]]; then
      queue="$queue $tid"
    fi
  done

  local visited=0
  while [[ -n "$(echo "$queue" | sed -e 's/^[[:space:]]*//')" ]]; do
    # pop first
    set -- $queue
    local cur="$1"
    shift
    queue="$*"
    visited=$((visited + 1))
    # reduce indegree of neighbors
    while IFS= read -r edge || [[ -n "$edge" ]]; do
      [[ -n "$edge" ]] || continue
      local from to
      from="$(echo "$edge" | awk '{print $1}')"
      to="$(echo "$edge" | awk '{print $2}')"
      if [[ "$from" == "$cur" ]]; then
        local n
        n="$(cat "$tmp/indegree.$to")"
        n=$((n - 1))
        echo "$n" > "$tmp/indegree.$to"
        if [[ "$n" -eq 0 ]]; then
          queue="$queue $to"
        fi
      fi
    done < "$tmp/edges"
  done

  local total
  total="$(wc -l < "$tmp/nodes" | tr -d ' ')"
  if [[ "$visited" -lt "$total" ]]; then
    echo "Error: dependency cycle detected among tasks:" >&2
    for tid in $tids; do
      if [[ "$(cat "$tmp/indegree.$tid")" -gt 0 ]]; then
        local deps
        deps="$(grep -E '^deps:' "$plan_dir/$tid.status" 2>/dev/null | head -n 1 | sed -e 's/^deps:[[:space:]]*//' || true)"
        echo "  $tid -> $deps" >&2
      fi
    done
    rm -rf "$tmp"
    exit 1
  fi
  rm -rf "$tmp"
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
validate_ident "id" "$ID"

BASE_DIR="$(find_base_dir)"
# Ensure the directory exists for init paths that create under it.
mkdir -p "$BASE_DIR"

PLAN_DIR="$BASE_DIR/implement-plan-$ID"
ROLLUP_FILE="$BASE_DIR/implement-plan-$ID.md"
PLAN_FILE="$BASE_DIR/plan-$ID.md"
REPORT_DIR="$BASE_DIR/implement-report-$ID"
REPORT_ROLLUP_FILE="$BASE_DIR/implement-report-$ID.md"

if [[ "$MIGRATE" -eq 1 ]]; then
  if [[ ! -f "$ROLLUP_FILE" ]]; then
    echo "Error: legacy file '$ROLLUP_FILE' does not exist to migrate." >&2
    exit 1
  fi

  if [[ -d "$PLAN_DIR" ]]; then
    if [[ -n "$(ls -A "$PLAN_DIR" 2>/dev/null || true)" ]]; then
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
    if [[ "$line" =~ ^[[:space:]]*-[[:space:]]*\[([^]]+)\][[:space:]]*([^:]+):[[:space:]]*(.*)$ ]]; then
      status="${BASH_REMATCH[1]}"
      tid="${BASH_REMATCH[2]}"
      desc="${BASH_REMATCH[3]}"
      status="$(echo "$status" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
      tid="$(echo "$tid" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
      desc="$(echo "$desc" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
      validate_ident "task-id" "$tid"
      echo "$tid" >> "$ORDER_TMP"
      printf 'status: %s\ndesc: %s\ndeps: \n' "$status" "$desc" > "$PLAN_DIR/$tid.status"
    else
      echo "$line" >> "$META_TMP"
    fi
  done < "$ROLLUP_FILE"

  if grep -q '[^[:space:]]' "$META_TMP" 2>/dev/null; then
    mv -f "$META_TMP" "$PLAN_DIR/_meta.md"
  else
    rm -f "$META_TMP"
    : > "$PLAN_DIR/_meta.md"
  fi

  mv -f "$ORDER_TMP" "$PLAN_DIR/.order"

  mv "$ROLLUP_FILE" "$ROLLUP_FILE.bak"

  "$CLAIM_SH" rollup "$ID"
  echo "Migrated '$ROLLUP_FILE' -> '$PLAN_DIR/' (backup saved to '$ROLLUP_FILE.bak')"

  if [[ -f "$REPORT_ROLLUP_FILE" && ! -d "$REPORT_DIR" ]]; then
    mkdir -p "$REPORT_DIR"
    cp "$REPORT_ROLLUP_FILE" "$REPORT_DIR/_meta.md"
    mv "$REPORT_ROLLUP_FILE" "$REPORT_ROLLUP_FILE.bak"
    "$CLAIM_SH" report-rollup "$ID"
    echo "Migrated '$REPORT_ROLLUP_FILE' -> '$REPORT_DIR/' (backup saved to '$REPORT_ROLLUP_FILE.bak')"
  fi

else
  if [[ ! -f "$PLAN_FILE" ]]; then
    if [[ -f "$BASE_DIR/plan.md" ]]; then
      PLAN_FILE="$BASE_DIR/plan.md"
    else
      echo "Error: plan file '$PLAN_FILE' not found." >&2
      exit 1
    fi
  fi

  if [[ -f "$ROLLUP_FILE" ]]; then
    echo "Error: legacy file '$ROLLUP_FILE' already exists." >&2
    echo "Use --migrate to convert it (preserves statuses + .bak), or remove it to re-init from the plan." >&2
    exit 1
  fi

  if [[ -d "$PLAN_DIR" ]]; then
    if [[ -n "$(ls -A "$PLAN_DIR" 2>/dev/null || true)" ]]; then
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
  task_seq=0

  has_tasks_section=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^##[[:space:]]+Tasks([[:space:]]|$) ]]; then
      has_tasks_section=1
      break
    fi
  done < "$PLAN_FILE"

  if [[ "$has_tasks_section" -eq 0 ]]; then
    echo "Error: plan '$PLAN_FILE' has no '## Tasks' heading. Refusing to guess task lists from other sections." >&2
    rm -rf "$PLAN_DIR"
    exit 1
  fi

  in_tasks=0

  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^##[[:space:]]+Tasks([[:space:]]|$) ]]; then
      in_tasks=1
      continue
    elif [[ "$line" =~ ^##[[:space:]]+ && "$in_tasks" -eq 1 ]]; then
      in_tasks=0
    fi

    [[ "$in_tasks" -eq 1 ]] || continue

    # Nested numbered lists — fail loudly (they used to be swallowed as duplicate ids).
    if [[ "$line" =~ ^[[:space:]]+[0-9]+\. ]]; then
      echo "Error: nested numbered list under ## Tasks is not allowed: $line" >&2
      echo "Use a single flat numbered list. See docs/file-conventions.md." >&2
      rm -rf "$PLAN_DIR"
      exit 1
    fi

    if [[ "$line" =~ ^([0-9]+)\.[[:space:]]+(.*)$ ]]; then
      rest="${BASH_REMATCH[2]}"
      task_seq=$((task_seq + 1))
      tid="T${task_seq}"
      if [[ -f "$PLAN_DIR/$tid.status" ]]; then
        echo "Error: duplicate task id '$tid' in the same init run" >&2
        rm -rf "$PLAN_DIR"
        exit 1
      fi
      desc="$(clean_desc "$rest")"
      extract_deps "$desc"
      desc="$DESC_OUT"
      deps="$DEPS_OUT"
      validate_ident "task-id" "$tid"
      echo "$tid" >> "$ORDER_TMP"
      printf 'status: pending\ndesc: %s\ndeps: %s\n' "$desc" "$deps" > "$PLAN_DIR/$tid.status"
      found_count=$((found_count + 1))
    elif [[ "$line" =~ ^-[[:space:]]*\[([^]]*)\][[:space:]]*([^:]+):[[:space:]]*(.*)$ ]]; then
      s="${BASH_REMATCH[1]}"
      tid="${BASH_REMATCH[2]}"
      desc="${BASH_REMATCH[3]}"
      tid="$(echo "$tid" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
      desc="$(echo "$desc" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
      validate_ident "task-id" "$tid"
      if [[ -f "$PLAN_DIR/$tid.status" ]]; then
        echo "Error: duplicate task id '$tid' in the same init run" >&2
        rm -rf "$PLAN_DIR"
        exit 1
      fi
      extract_deps "$desc"
      desc="$DESC_OUT"
      deps="$DEPS_OUT"
      [[ -n "$s" ]] || s="pending"
      echo "$tid" >> "$ORDER_TMP"
      printf 'status: %s\ndesc: %s\ndeps: %s\n' "$s" "$desc" "$deps" > "$PLAN_DIR/$tid.status"
      found_count=$((found_count + 1))
    fi
  done < "$PLAN_FILE"

  # found_count must match real .status files
  real_count=0
  for f in "$PLAN_DIR"/*.status; do
    [[ -f "$f" ]] || continue
    real_count=$((real_count + 1))
  done
  if [[ "$found_count" -ne "$real_count" ]]; then
    echo "Error: internal count mismatch (found_count=$found_count real_count=$real_count)" >&2
    rm -rf "$PLAN_DIR"
    exit 1
  fi

  if [[ "$found_count" -eq 0 ]]; then
    echo "Error: ## Tasks section produced zero tasks" >&2
    rm -rf "$PLAN_DIR"
    exit 1
  fi

  mv -f "$ORDER_TMP" "$PLAN_DIR/.order"

  check_dep_cycles "$PLAN_DIR"

  mkdir -p "$REPORT_DIR"
  : > "$REPORT_DIR/_meta.md"

  "$CLAIM_SH" rollup "$ID"
  "$CLAIM_SH" report-rollup "$ID"
  echo "Initialized '$PLAN_DIR/' and '$REPORT_DIR/' with $found_count task(s)."
fi
