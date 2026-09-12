#!/usr/bin/env bash
# scripts/task-claim.sh
# Atomic per-task claim/update/release/list for agent-relay parallel mode.
# Bash 3.2+ compatible, POSIX tools only.
set -euo pipefail

STALE_THRESHOLD=7200 # 2 hours in seconds (informational for steal messages)

usage() {
  cat <<'EOF'
Usage:
  task-claim.sh [--session <tag>] <subcommand> ...

  task-claim.sh claim <id> <task-id> <session-tag>
  task-claim.sh steal <id> <task-id> <session-tag>
  task-claim.sh update [--session <tag>] <id> <task-id> [<session-tag>] <status> [<reason>]
  task-claim.sh release [--force] [--session <tag>] <id> <task-id> [<session-tag>]
  task-claim.sh list <id>
  task-claim.sh rollup <id>
  task-claim.sh check <id>
  task-claim.sh report-write <id> <task-id> <path-or-->
  task-claim.sh report-list <id>
  task-claim.sh report-rollup <id>

  claim flags: --allow-skipped-deps
EOF
  exit 1
}

# Reject empty, ., .., and anything outside [A-Za-z0-9._-]
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
  # Fallback: relative .agent-relay under cwd (may not exist yet).
  printf '%s\n' ".agent-relay"
}

resolve_paths() {
  local id="$1"
  validate_ident "id" "$id"
  BASE_DIR="$(find_base_dir)"
  PLAN_DIR="$BASE_DIR/implement-plan-$id"
  ROLLUP_FILE="$BASE_DIR/implement-plan-$id.md"
}

get_lock_age() {
  local lock_dir="$1"
  local now
  now="$(date +%s)"
  local lock_time=""
  if [[ -f "$lock_dir/created_epoch" ]]; then
    # Missing/unreadable epoch → treat as age 0 (not stealable by age alone).
    lock_time="$(cat "$lock_dir/created_epoch" 2>/dev/null || true)"
  fi
  if [[ -z "$lock_time" && -f "$lock_dir/owner" ]]; then
    local ts
    ts="$(awk '{print $2}' "$lock_dir/owner" 2>/dev/null || true)"
    if [[ -n "$ts" ]]; then
      # Intentional: date -j (BSD) or date -d (GNU); either may fail on odd stamps.
      lock_time="$(date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$ts" +%s 2>/dev/null || date -u -d "$ts" +%s 2>/dev/null || true)"
    fi
  fi
  if [[ -z "$lock_time" ]]; then
    # Intentional: prefer BSD stat, else GNU; missing both → age 0.
    lock_time="$(stat -f %m "$lock_dir" 2>/dev/null || stat -c %Y "$lock_dir" 2>/dev/null || true)"
  fi
  case "$lock_time" in
    ''|*[!0-9]*) echo 0 ;;
    *) echo "$((now - lock_time))" ;;
  esac
}

# Portable task id sort: T<n> numerically, then other ids lexicographically.
sort_task_ids() {
  awk '
    /^T[0-9]+$/ { printf "0\t%010d\t%s\n", substr($0,2)+0, $0; next }
    { printf "1\t%s\t%s\n", $0, $0 }
  ' | sort | cut -f3
}

get_ordered_tasks() {
  local plan_dir="$1"
  local order_file="$plan_dir/.order"
  local extras=""
  if [[ -f "$order_file" ]]; then
    while IFS= read -r tid || [[ -n "$tid" ]]; do
      tid="$(echo "$tid" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
      if [[ -n "$tid" && -f "$plan_dir/$tid.status" ]]; then
        echo "$tid"
      fi
    done < "$order_file"
    for f in "$plan_dir"/*.status; do
      [[ -f "$f" ]] || continue
      local fname="${f##*/}"
      local tid="${fname%.status}"
      if ! grep -q "^[[:space:]]*${tid}[[:space:]]*$" "$order_file"; then
        extras="${extras}${tid}"$'\n'
      fi
    done
    if [[ -n "$extras" ]]; then
      printf '%s' "$extras" | sort_task_ids
    fi
  else
    for f in "$plan_dir"/*.status; do
      [[ -f "$f" ]] || continue
      local fname="${f##*/}"
      echo "${fname%.status}"
    done | sort_task_ids
  fi
}

read_status_field() {
  local sfile="$1"
  grep -E '^status:' "$sfile" | head -n 1 | sed -e 's/^status:[[:space:]]*//'
}

read_desc_field() {
  local sfile="$1"
  grep -E '^desc:' "$sfile" | head -n 1 | sed -e 's/^desc:[[:space:]]*//'
}

read_deps_field() {
  local sfile="$1"
  # Intentional: missing deps line → empty (optional field).
  grep -E '^deps:' "$sfile" 2>/dev/null | head -n 1 | sed -e 's/^deps:[[:space:]]*//' || true
}

status_is_done() {
  local s="$1"
  [[ "$s" == "done" ]]
}

status_base() {
  # Strip "skipped (reason)" → skipped
  local s="$1"
  case "$s" in
    skipped*) echo skipped ;;
    *) echo "$s" ;;
  esac
}

deps_satisfied() {
  # args: plan_dir deps_string allow_skipped(0|1)
  # prints reason on stdout and returns 1 if blocked
  local plan_dir="$1"
  local deps="$2"
  local allow_skipped="$3"
  local dep
  local dep_file
  local dep_status
  local base
  for dep in $deps; do
    dep_file="$plan_dir/$dep.status"
    if [[ ! -f "$dep_file" ]]; then
      echo "missing dependency '$dep'"
      return 1
    fi
    dep_status="$(read_status_field "$dep_file")"
    if status_is_done "$dep_status"; then
      continue
    fi
    base="$(status_base "$dep_status")"
    if [[ "$allow_skipped" -eq 1 && "$base" == "skipped" ]]; then
      continue
    fi
    echo "dependency '$dep' is not done (status: $dep_status)"
    return 1
  done
  return 0
}

regenerate_rollup() {
  local plan_dir="$1"
  local rollup_file="$2"
  local id="$3"

  local rollup_lock="$plan_dir/.lock-rollup"
  local lock_waited=0
  while ! mkdir "$rollup_lock" 2>/dev/null; do
    sleep 0.05
    lock_waited=$((lock_waited + 1))
    # Stale rollup lock (crash mid-regen): steal after ~5s of waiting.
    if [[ "$lock_waited" -ge 100 ]]; then
      rm -rf "$rollup_lock"
      lock_waited=0
    fi
  done

  local tmp_rollup="$plan_dir/.rollup-tmp-$$.md"
  {
    if [[ -f "$plan_dir/_meta.md" && -s "$plan_dir/_meta.md" ]]; then
      cat "$plan_dir/_meta.md"
      local last_line
      # Intentional: empty _meta is fine; tail may fail on empty edge cases.
      last_line="$(tail -n 1 "$plan_dir/_meta.md" 2>/dev/null || true)"
      if [[ -n "$last_line" ]]; then
        echo ""
      fi
    else
      echo "# implement-plan ($id)"
      echo ""
    fi

    while IFS= read -r tid || [[ -n "$tid" ]]; do
      [[ -n "$tid" ]] || continue
      local sfile="$plan_dir/$tid.status"
      [[ -f "$sfile" ]] || continue
      local status=""
      local desc=""
      status="$(read_status_field "$sfile")"
      desc="$(read_desc_field "$sfile")"
      echo "- [$status] $tid: $desc"
    done < <(get_ordered_tasks "$plan_dir")
  } > "$tmp_rollup"

  mv -f "$tmp_rollup" "$rollup_file"
  # Intentional: rmdir preferred; rm -rf if non-empty after a crash.
  rmdir "$rollup_lock" 2>/dev/null || rm -rf "$rollup_lock"
}

regenerate_report_rollup() {
  local report_dir="$1"
  local rollup_file="$2"
  local id="$3"

  local rollup_lock="$report_dir/.lock-report-rollup"
  local lock_waited=0
  while ! mkdir "$rollup_lock" 2>/dev/null; do
    sleep 0.05
    lock_waited=$((lock_waited + 1))
    if [[ "$lock_waited" -ge 100 ]]; then
      rm -rf "$rollup_lock"
      lock_waited=0
    fi
  done

  local tmp_rollup="$report_dir/.rollup-tmp-$$.md"
  {
    echo "# implement-report ($id)"
    echo ""
    if [[ -f "$report_dir/_meta.md" && -s "$report_dir/_meta.md" ]]; then
      cat "$report_dir/_meta.md"
      echo ""
    fi

    local base_dir
    base_dir="$(dirname "$report_dir")"
    local plan_dir="$base_dir/implement-plan-$id"
    if [[ -d "$plan_dir" ]]; then
      while IFS= read -r tid || [[ -n "$tid" ]]; do
        [[ -n "$tid" ]] || continue
        if [[ -f "$report_dir/$tid.md" ]]; then
          echo "### $tid"
          echo ""
          cat "$report_dir/$tid.md"
          echo ""
        fi
      done < <(get_ordered_tasks "$plan_dir")
    else
      for f in "$report_dir"/*.md; do
        [[ -f "$f" ]] || continue
        local fname="${f##*/}"
        [[ "$fname" == "_meta.md" ]] && continue
        [[ "$fname" == .rollup* ]] && continue
        local tid="${fname%.md}"
        echo "### $tid"
        echo ""
        cat "$f"
        echo ""
      done
    fi
  } > "$tmp_rollup"

  mv -f "$tmp_rollup" "$rollup_file"
  rmdir "$rollup_lock" 2>/dev/null || rm -rf "$rollup_lock"
}

check_consistency() {
  # Diff each on-disk rollup against what regenerate_{rollup,report_rollup}
  # would produce from the current *.status / per-task report files. A
  # mismatch means the rollup was hand-edited (or is stale) instead of being
  # written by task-claim.sh -- the directory-based per-task files are the
  # source of truth, so this only ever flags, never repairs, the drift.
  local base_dir="$1"
  local id="$2"
  local plan_dir="$base_dir/implement-plan-$id"
  local rollup_file="$base_dir/implement-plan-$id.md"
  local report_dir="$base_dir/implement-report-$id"
  local report_rollup="$base_dir/implement-report-$id.md"
  local mismatch=0

  if [[ -d "$plan_dir" ]]; then
    local tmp_plan
    # Stage beside the plan dir so regenerate_rollup's final mv stays
    # same-filesystem (cross-device mv degrades to copy+unlink).
    tmp_plan="$(mktemp "$plan_dir/.ar-check-plan.XXXXXX")"
    regenerate_rollup "$plan_dir" "$tmp_plan" "$id"
    if [[ -f "$rollup_file" ]]; then
      if ! cmp -s "$tmp_plan" "$rollup_file"; then
        echo "MISMATCH: $rollup_file does not match the state of $plan_dir/*.status" >&2
        echo "  This means the rollup was edited by hand, or a task-claim.sh call" >&2
        echo "  never ran, since it was last regenerated. Diff (expected vs actual):" >&2
        diff -u "$tmp_plan" "$rollup_file" >&2 || true
        mismatch=1
      fi
    else
      echo "MISMATCH: $plan_dir exists but $rollup_file is missing" >&2
      mismatch=1
    fi
    rm -f "$tmp_plan"
  fi

  if [[ -d "$report_dir" ]]; then
    local tmp_report
    tmp_report="$(mktemp "$report_dir/.ar-check-report.XXXXXX")"
    regenerate_report_rollup "$report_dir" "$tmp_report" "$id"
    if [[ -f "$report_rollup" ]]; then
      if ! cmp -s "$tmp_report" "$report_rollup"; then
        echo "MISMATCH: $report_rollup does not match the per-task files in $report_dir" >&2
        mismatch=1
      fi
    else
      echo "MISMATCH: $report_dir exists but $report_rollup is missing" >&2
      mismatch=1
    fi
    rm -f "$tmp_report"
  fi

  if [[ "$mismatch" -eq 0 ]]; then
    echo "OK: rollup file(s) match the per-task directory state for id '$id'"
  fi
  return "$mismatch"
}

list_tasks() {
  local plan_dir="$1"
  local allow_skipped=0
  while IFS= read -r tid || [[ -n "$tid" ]]; do
    [[ -n "$tid" ]] || continue
    local sfile="$plan_dir/$tid.status"
    [[ -f "$sfile" ]] || continue
    local status=""
    local desc=""
    local deps=""
    local block=""
    status="$(read_status_field "$sfile")"
    desc="$(read_desc_field "$sfile")"
    deps="$(read_deps_field "$sfile")"
    if [[ "$(status_base "$status")" == "pending" && -n "$deps" ]]; then
      if ! block="$(deps_satisfied "$plan_dir" "$deps" "$allow_skipped")"; then
        echo "- [$status] $tid: $desc  [blocked: $block]"
        continue
      fi
    fi
    echo "- [$status] $tid: $desc"
  done < <(get_ordered_tasks "$plan_dir")
}

write_task_status() {
  local task_file="$1"
  local new_status="$2"
  local desc
  local deps
  desc="$(grep -E '^desc[[:space:]]*:' "$task_file" 2>/dev/null | head -n 1 | sed -e 's/^desc[[:space:]]*:[[:space:]]*//' || true)"
  deps="$(grep -E '^deps[[:space:]]*:' "$task_file" 2>/dev/null | head -n 1 | sed -e 's/^deps[[:space:]]*:[[:space:]]*//' || true)"
  if grep -q -E '^deps[[:space:]]*:' "$task_file" 2>/dev/null; then
    printf 'status: %s\ndesc: %s\ndeps: %s\n' "$new_status" "$desc" "$deps" > "$task_file.tmp"
  else
    printf 'status: %s\ndesc: %s\n' "$new_status" "$desc" > "$task_file.tmp"
  fi
  mv -f "$task_file.tmp" "$task_file"
}

acquire_lock() {
  # Create lock dir owned by SESSION_TAG. Fails if lock exists.
  local lock_dir="$1"
  local session_tag="$2"
  local iso_now="$3"
  local epoch_now="$4"
  if mkdir "$lock_dir" 2>/dev/null; then
    printf '%s %s\n' "$session_tag" "$iso_now" > "$lock_dir/owner"
    printf '%s\n' "$epoch_now" > "$lock_dir/created_epoch"
    return 0
  fi
  return 1
}

take_lock_forced() {
  # rm + mkdir + write owner. Caller must hold steal mutex.
  local lock_dir="$1"
  local session_tag="$2"
  local iso_now="$3"
  local epoch_now="$4"
  rm -rf "$lock_dir"
  mkdir "$lock_dir"
  printf '%s %s\n' "$session_tag" "$iso_now" > "$lock_dir/owner"
  printf '%s\n' "$epoch_now" > "$lock_dir/created_epoch"
}

# --- option parsing (global --session before subcommand) ---
OPT_SESSION=""
ALLOW_SKIPPED_DEPS=0
FORCE_RELEASE=0

while [[ $# -ge 1 ]]; do
  case "$1" in
    --session)
      [[ $# -ge 2 ]] || usage
      OPT_SESSION="$2"
      shift 2
      ;;
    --allow-skipped-deps)
      ALLOW_SKIPPED_DEPS=1
      shift
      ;;
    --force)
      FORCE_RELEASE=1
      shift
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "Error: unknown option '$1'" >&2
      usage
      ;;
    *)
      break
      ;;
  esac
done

[[ $# -ge 1 ]] || usage
SUBCMD="$1"
shift

case "$SUBCMD" in
  claim)
    [[ $# -eq 3 ]] || usage
    ID="$1"
    TASK_ID="$2"
    SESSION_TAG="$3"
    validate_ident "id" "$ID"
    validate_ident "task-id" "$TASK_ID"

    resolve_paths "$ID"
    [[ -d "$PLAN_DIR" ]] || {
      echo "Error: plan directory '$PLAN_DIR' does not exist. Run task-init.sh first." >&2
      exit 1
    }

    TASK_FILE="$PLAN_DIR/$TASK_ID.status"
    [[ -f "$TASK_FILE" ]] || {
      echo "Error: task '$TASK_ID' does not exist in '$PLAN_DIR'" >&2
      exit 1
    }

    DEPS="$(read_deps_field "$TASK_FILE")"
    if [[ -n "$DEPS" ]]; then
      block_reason=""
      if ! block_reason="$(deps_satisfied "$PLAN_DIR" "$DEPS" "$ALLOW_SKIPPED_DEPS")"; then
        echo "Error: $block_reason. Cannot claim '$TASK_ID'." >&2
        exit 1
      fi
    fi

    LOCK_DIR="$PLAN_DIR/.lock-$TASK_ID"
    ISO_NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    EPOCH_NOW="$(date +%s)"

    if acquire_lock "$LOCK_DIR" "$SESSION_TAG" "$ISO_NOW" "$EPOCH_NOW"; then
      :
    else
      LOCK_AGE="$(get_lock_age "$LOCK_DIR")"
      OLD_OWNER="$(cat "$LOCK_DIR/owner" 2>/dev/null || echo "unknown")"
      if [[ "$LOCK_AGE" -ge "$STALE_THRESHOLD" ]]; then
        echo "Error: lock on task '$TASK_ID' is stale (held by $OLD_OWNER for ${LOCK_AGE}s > ${STALE_THRESHOLD}s)." >&2
        echo "Run: task-claim.sh steal $ID $TASK_ID $SESSION_TAG" >&2
        exit 1
      fi
      retries=5
      while [[ (! -s "$LOCK_DIR/owner") && $retries -gt 0 ]]; do
        sleep 0.1
        retries=$((retries - 1))
      done
      cat "$LOCK_DIR/owner" 2>/dev/null || echo "locked"
      exit 1
    fi

    write_task_status "$TASK_FILE" "in-progress"
    regenerate_rollup "$PLAN_DIR" "$ROLLUP_FILE" "$ID"
    ;;

  steal)
    [[ $# -eq 3 ]] || usage
    ID="$1"
    TASK_ID="$2"
    SESSION_TAG="$3"
    validate_ident "id" "$ID"
    validate_ident "task-id" "$TASK_ID"

    resolve_paths "$ID"
    [[ -d "$PLAN_DIR" ]] || {
      echo "Error: plan directory '$PLAN_DIR' does not exist. Run task-init.sh first." >&2
      exit 1
    }

    TASK_FILE="$PLAN_DIR/$TASK_ID.status"
    [[ -f "$TASK_FILE" ]] || {
      echo "Error: task '$TASK_ID' does not exist in '$PLAN_DIR'" >&2
      exit 1
    }

    # Steal takes over an existing lock — not a backdoor claim. Same dep
    # rules as claim so unmet deps cannot be skipped by stealing.
    DEPS="$(read_deps_field "$TASK_FILE")"
    if [[ -n "$DEPS" ]]; then
      block_reason=""
      if ! block_reason="$(deps_satisfied "$PLAN_DIR" "$DEPS" "$ALLOW_SKIPPED_DEPS")"; then
        echo "Error: $block_reason. Cannot steal '$TASK_ID'." >&2
        exit 1
      fi
    fi

    LOCK_DIR="$PLAN_DIR/.lock-$TASK_ID"
    STEAL_MUTEX="$PLAN_DIR/.lock-steal-$TASK_ID"
    ISO_NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    EPOCH_NOW="$(date +%s)"

    if ! mkdir "$STEAL_MUTEX" 2>/dev/null; then
      echo "Error: another agent is stealing lock on task '$TASK_ID'" >&2
      exit 1
    fi

    # Critical section: require existing lock → read age → delete → recreate.
    # Lock check is inside the mutex so release cannot race into a free claim.
    if [[ ! -d "$LOCK_DIR" ]]; then
      rmdir "$STEAL_MUTEX" 2>/dev/null || rm -rf "$STEAL_MUTEX"
      echo "Error: task '$TASK_ID' is not locked; use claim instead of steal" >&2
      exit 1
    fi

    LOCK_AGE="$(get_lock_age "$LOCK_DIR")"
    OLD_OWNER="$(cat "$LOCK_DIR/owner" 2>/dev/null || echo "unknown")"
    echo "Stealing lock on task '$TASK_ID' (was held by $OLD_OWNER, age ${LOCK_AGE}s)" >&2

    # Test hook: optional pause inside the mutex so concurrent stealers
    # still serialize on mkdir(STEAL_MUTEX) rather than overlapping rm/mkdir.
    if [[ -n "${AGENT_RELAY_TEST_STEAL_PAUSE:-}" ]]; then
      sleep "$AGENT_RELAY_TEST_STEAL_PAUSE"
    fi

    take_lock_forced "$LOCK_DIR" "$SESSION_TAG" "$ISO_NOW" "$EPOCH_NOW"

    rmdir "$STEAL_MUTEX" 2>/dev/null || rm -rf "$STEAL_MUTEX"

    write_task_status "$TASK_FILE" "in-progress"
    regenerate_rollup "$PLAN_DIR" "$ROLLUP_FILE" "$ID"
    ;;

  update)
    # Allow --session after subcommand too.
    while [[ $# -ge 1 ]]; do
      case "$1" in
        --session)
          [[ $# -ge 2 ]] || usage
          OPT_SESSION="$2"
          shift 2
          ;;
        *)
          break
          ;;
      esac
    done

    [[ $# -ge 3 ]] || usage
    ID="$1"
    TASK_ID="$2"
    shift 2
    validate_ident "id" "$ID"
    validate_ident "task-id" "$TASK_ID"

    resolve_paths "$ID"
    [[ -d "$PLAN_DIR" ]] || {
      echo "Error: plan directory '$PLAN_DIR' does not exist." >&2
      exit 1
    }

    TASK_FILE="$PLAN_DIR/$TASK_ID.status"
    [[ -f "$TASK_FILE" ]] || {
      echo "Error: task '$TASK_ID' does not exist in '$PLAN_DIR'" >&2
      exit 1
    }

    LOCK_DIR="$PLAN_DIR/.lock-$TASK_ID"
    [[ -d "$LOCK_DIR" ]] || {
      echo "Error: task '$TASK_ID' is not claimed/locked" >&2
      exit 1
    }

    OWNER_TAG="$(awk '{print $1}' "$LOCK_DIR/owner" 2>/dev/null || true)"

    ARG_SESSION=""
    ARG_STATUS=""
    REASON=""

    FIRST_ARG="$1"
    case "$FIRST_ARG" in
      pending|in-progress|done|skipped)
        ARG_STATUS="$FIRST_ARG"
        shift
        REASON="$*"
        ;;
      *)
        ARG_SESSION="$FIRST_ARG"
        shift
        [[ $# -ge 1 ]] || usage
        ARG_STATUS="$1"
        shift
        REASON="$*"
        ;;
    esac

    # Explicit --session wins over positional session-tag. No ambient env.
    CALLER_SESSION="${OPT_SESSION:-$ARG_SESSION}"

    if [[ -z "$CALLER_SESSION" ]]; then
      echo "Error: session-tag required to update task '$TASK_ID' (held by '$OWNER_TAG')" >&2
      exit 1
    fi

    if [[ "$CALLER_SESSION" != "$OWNER_TAG" ]]; then
      echo "Error: caller session tag '$CALLER_SESSION' does not match lock owner '$OWNER_TAG' for task '$TASK_ID'" >&2
      exit 1
    fi

    case "$ARG_STATUS" in
      pending|in-progress|done|skipped) ;;
      *)
        echo "Error: invalid status '$ARG_STATUS' (allowed: pending, in-progress, done, skipped)" >&2
        exit 1
        ;;
    esac

    FINAL_STATUS="$ARG_STATUS"
    if [[ "$ARG_STATUS" == "skipped" ]]; then
      if [[ -z "$REASON" ]]; then
        echo "Error: skipped requires a reason" >&2
        exit 1
      fi
      CLEAN_REASON="$(echo "$REASON" | sed -e 's/^[[:space:]]*(//' -e 's/)[[:space:]]*$//')"
      FINAL_STATUS="skipped ($CLEAN_REASON)"
    elif [[ -n "$REASON" ]]; then
      echo "Error: status '$ARG_STATUS' does not take a reason" >&2
      exit 1
    fi

    write_task_status "$TASK_FILE" "$FINAL_STATUS"
    regenerate_rollup "$PLAN_DIR" "$ROLLUP_FILE" "$ID"
    ;;

  release)
    while [[ $# -ge 1 ]]; do
      case "$1" in
        --session)
          [[ $# -ge 2 ]] || usage
          OPT_SESSION="$2"
          shift 2
          ;;
        --force)
          FORCE_RELEASE=1
          shift
          ;;
        *)
          break
          ;;
      esac
    done

    [[ $# -ge 2 ]] || usage
    ID="$1"
    TASK_ID="$2"
    shift 2
    validate_ident "id" "$ID"
    validate_ident "task-id" "$TASK_ID"

    ARG_SESSION=""
    if [[ $# -ge 1 ]]; then
      ARG_SESSION="$1"
    fi
    CALLER_SESSION="${OPT_SESSION:-$ARG_SESSION}"

    resolve_paths "$ID"
    LOCK_DIR="$PLAN_DIR/.lock-$TASK_ID"

    if [[ -d "$LOCK_DIR" ]]; then
      OWNER_TAG="$(awk '{print $1}' "$LOCK_DIR/owner" 2>/dev/null || true)"
      if [[ "$FORCE_RELEASE" -eq 1 ]]; then
        echo "WARNING: force-releasing lock on task '$TASK_ID' (owner was '$OWNER_TAG')" >&2
      else
        if [[ -z "$CALLER_SESSION" ]]; then
          echo "Error: session-tag required to release task '$TASK_ID' (held by '$OWNER_TAG'); use --force to override" >&2
          exit 1
        fi
        if [[ "$CALLER_SESSION" != "$OWNER_TAG" ]]; then
          echo "Error: caller session tag '$CALLER_SESSION' does not match lock owner '$OWNER_TAG' for task '$TASK_ID'" >&2
          exit 1
        fi
      fi
      rm -rf "$LOCK_DIR"
    fi

    regenerate_rollup "$PLAN_DIR" "$ROLLUP_FILE" "$ID"
    ;;

  list)
    [[ $# -eq 1 ]] || usage
    ID="$1"
    validate_ident "id" "$ID"
    resolve_paths "$ID"
    [[ -d "$PLAN_DIR" ]] || {
      echo "Error: plan directory '$PLAN_DIR' does not exist." >&2
      exit 1
    }
    list_tasks "$PLAN_DIR"
    ;;

  report-write)
    [[ $# -eq 3 ]] || usage
    ID="$1"
    TASK_ID="$2"
    IN_FILE="$3"
    validate_ident "id" "$ID"
    validate_ident "task-id" "$TASK_ID"

    resolve_paths "$ID"
    report_dir="$BASE_DIR/implement-report-$ID"
    mkdir -p "$report_dir"

    if [[ "$IN_FILE" == "-" ]]; then
      cat > "$report_dir/$TASK_ID.md"
    else
      cp "$IN_FILE" "$report_dir/$TASK_ID.md"
    fi

    regenerate_report_rollup "$report_dir" "$BASE_DIR/implement-report-$ID.md" "$ID"
    ;;

  report-list)
    [[ $# -eq 1 ]] || usage
    ID="$1"
    validate_ident "id" "$ID"
    resolve_paths "$ID"
    report_dir="$BASE_DIR/implement-report-$ID"
    [[ -d "$report_dir" ]] || {
      echo "Error: report directory '$report_dir' does not exist." >&2
      exit 1
    }

    plan_dir="$BASE_DIR/implement-plan-$ID"
    if [[ -d "$plan_dir" ]]; then
      while IFS= read -r tid || [[ -n "$tid" ]]; do
        [[ -n "$tid" ]] || continue
        if [[ -f "$report_dir/$tid.md" ]]; then
          echo "$report_dir/$tid.md"
        fi
      done < <(get_ordered_tasks "$plan_dir")
    else
      for f in "$report_dir"/*.md; do
        [[ -f "$f" ]] || continue
        fname="${f##*/}"
        [[ "$fname" == "_meta.md" ]] && continue
        [[ "$fname" == .rollup* ]] && continue
        echo "$f"
      done
    fi
    ;;

  report-rollup)
    [[ $# -eq 1 ]] || usage
    ID="$1"
    validate_ident "id" "$ID"
    resolve_paths "$ID"
    report_dir="$BASE_DIR/implement-report-$ID"
    [[ -d "$report_dir" ]] || {
      echo "Error: report directory '$report_dir' does not exist." >&2
      exit 1
    }
    regenerate_report_rollup "$report_dir" "$BASE_DIR/implement-report-$ID.md" "$ID"
    ;;

  rollup)
    [[ $# -eq 1 ]] || usage
    ID="$1"
    validate_ident "id" "$ID"
    resolve_paths "$ID"
    [[ -d "$PLAN_DIR" ]] || {
      echo "Error: plan directory '$PLAN_DIR' does not exist." >&2
      exit 1
    }
    regenerate_rollup "$PLAN_DIR" "$ROLLUP_FILE" "$ID"
    ;;

  check)
    [[ $# -eq 1 ]] || usage
    ID="$1"
    validate_ident "id" "$ID"
    resolve_paths "$ID"
    if [[ ! -d "$PLAN_DIR" && ! -d "$BASE_DIR/implement-report-$ID" ]]; then
      echo "Error: neither '$PLAN_DIR' nor an implement-report-$ID directory exists for id '$ID'." >&2
      echo "Nothing to check (this id has no parallel-mode directories)." >&2
      exit 1
    fi
    check_consistency "$BASE_DIR" "$ID"
    ;;

  *)
    usage
    ;;
esac
