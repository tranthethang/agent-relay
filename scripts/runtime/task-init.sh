#!/usr/bin/env bash
# scripts/runtime/task-init.sh
# Initialize task directory for agent-relay parallel mode.
# Bash 3.2+ compatible, POSIX tools only.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAIM_SH="$SCRIPT_DIR/task-claim.sh"
RESOLVE_RUN="$SCRIPT_DIR/resolve-run.sh"

usage() {
  cat <<'EOF'
Usage:
  task-init.sh <id-or-path>
EOF
  exit 1
}

validate_ident() {
  local kind="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "Error: $kind must not be empty" >&2
    [[ -n "${PLAN_DIR:-}" ]] && rm -rf "$PLAN_DIR"
    exit 1
  fi
  if [[ "$value" == "." || "$value" == ".." ]]; then
    echo "Error: $kind '$value' is not allowed" >&2
    [[ -n "${PLAN_DIR:-}" ]] && rm -rf "$PLAN_DIR"
    exit 1
  fi
  case "$value" in
    *[!A-Za-z0-9._-]*)
      echo "Error: $kind '$value' must match ^[A-Za-z0-9._-]+$" >&2
      [[ -n "${PLAN_DIR:-}" ]] && rm -rf "$PLAN_DIR"
      exit 1
      ;;
  esac
}

validate_task_status() {
  local s="$1"
  case "$s" in
    pending|in-progress|done|skipped) return 0 ;;
  esac
  case "$s" in
    skipped\ *) return 0 ;;
  esac
  return 1
}

validate_deps_string() {
  # Validate each dependency token against the same ident rule as task ids.
  local deps="$1"
  local dep
  local _noglob_was=0
  case "$-" in *f*) _noglob_was=1 ;; esac
  set -f
  for dep in $deps; do
    if [[ -z "$dep" ]]; then
      continue
    fi
    if [[ "$dep" == "." || "$dep" == ".." ]]; then
      [[ "$_noglob_was" -eq 0 ]] && set +f
      echo "Error: dependency id '$dep' is not allowed" >&2
      return 1
    fi
    case "$dep" in
      *[!A-Za-z0-9._-]*)
        [[ "$_noglob_was" -eq 0 ]] && set +f
        echo "Error: dependency id '$dep' must match ^[A-Za-z0-9._-]+$" >&2
        return 1
        ;;
    esac
  done
  [[ "$_noglob_was" -eq 0 ]] && set +f
  return 0
}

refuse_init() {
  # Remove partially written plan dir so a failed init does not block re-init.
  rm -rf "$PLAN_DIR"
  exit 1
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
    local _noglob_was=0
    case "$-" in *f*) _noglob_was=1 ;; esac
    set -f
    for dep in $deps; do
      if [[ ! -f "$plan_dir/$dep.status" ]]; then
        echo "Error: task '$tid' depends on unknown task '$dep'" >&2
        [[ "$_noglob_was" -eq 0 ]] && set +f
        rm -rf "$tmp"
        return 1
      fi
      echo "$dep $tid" >> "$tmp/edges"
      local n
      n="$(cat "$tmp/indegree.$tid")"
      echo $((n + 1)) > "$tmp/indegree.$tid"
    done
    [[ "$_noglob_was" -eq 0 ]] && set +f
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
    return 1
  fi
  rm -rf "$tmp"
  return 0
}

ID=""
for arg in "$@"; do
  case "$arg" in
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
TARGET="$ID"

RUN_DIR=""
if [[ -x "$RESOLVE_RUN" ]]; then
  RUN_DIR="$("$RESOLVE_RUN" "$TARGET" 2>/dev/null || true)"
fi

if [[ -z "$RUN_DIR" || ! -d "$RUN_DIR" || "$(basename "$RUN_DIR")" == ".agent-relay" ]]; then
  echo "Error: could not resolve run directory for '$TARGET'" >&2
  exit 1
fi

PLAN_DIR="$RUN_DIR/implement-plan"
ROLLUP_FILE="$RUN_DIR/implement-plan.md"
PLAN_FILE="$RUN_DIR/plan.md"
REPORT_DIR="$RUN_DIR/implement-report"
REPORT_ROLLUP_FILE="$RUN_DIR/implement-report.md"
bname="$(basename "$RUN_DIR")"
if [[ "$bname" =~ ^[0-9]{8}-([0-9]{10,11})-[a-z]+(-[a-z]+)*$ ]]; then
  ID="${BASH_REMATCH[1]}"
else
  ID="$bname"
fi

if [[ ! -f "$PLAN_FILE" ]]; then
  echo "Error: plan file '$PLAN_FILE' not found." >&2
  exit 1
fi

if [[ -f "$ROLLUP_FILE" ]]; then
  echo "Error: file '$ROLLUP_FILE' already exists." >&2
  echo "Remove it to re-init from the plan." >&2
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
  refuse_init
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
    refuse_init
  fi

  if [[ "$line" =~ ^([0-9]+)\.[[:space:]]+(.*)$ ]]; then
    rest="${BASH_REMATCH[2]}"
    task_seq=$((task_seq + 1))
    tid="T${task_seq}"
    if [[ -f "$PLAN_DIR/$tid.status" ]]; then
      echo "Error: duplicate task id '$tid' in the same init run" >&2
      refuse_init
    fi
    desc="$(clean_desc "$rest")"
    extract_deps "$desc"
    desc="$DESC_OUT"
    deps="$DEPS_OUT"
    if ! validate_deps_string "$deps"; then
      refuse_init
    fi
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
      refuse_init
    fi
    extract_deps "$desc"
    desc="$DESC_OUT"
    deps="$DEPS_OUT"
    if ! validate_deps_string "$deps"; then
      refuse_init
    fi
    [[ -n "$s" ]] || s="pending"
    # Checkbox form "- [ ] id: desc" captures a single space; treat blank as pending.
    s="$(echo "$s" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    [[ -n "$s" ]] || s="pending"
    if ! validate_task_status "$s"; then
      echo "Error: invalid initial status '$s' for task '$tid' (allowed: pending, in-progress, done, skipped)" >&2
      refuse_init
    fi
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
  refuse_init
fi

if [[ "$found_count" -eq 0 ]]; then
  echo "Error: ## Tasks section produced zero tasks" >&2
  refuse_init
fi

mv -f "$ORDER_TMP" "$PLAN_DIR/.order"

if ! check_dep_cycles "$PLAN_DIR"; then
  refuse_init
fi

mkdir -p "$REPORT_DIR"
: > "$REPORT_DIR/_meta.md"

"$CLAIM_SH" rollup "$TARGET"
"$CLAIM_SH" report-rollup "$TARGET"
echo "Initialized '$PLAN_DIR/' and '$REPORT_DIR/' with $found_count task(s)."
