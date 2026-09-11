#!/usr/bin/env bash
# scripts/task-claim.sh
# Atomic per-task claim/update/release/list for agent-relay parallel mode.
# Bash 3.2+ compatible, POSIX tools only.
set -euo pipefail

STALE_THRESHOLD=7200 # 2 hours in seconds

usage() {
  cat <<'EOF'
Usage:
  task-claim.sh claim <id> <task-id> <session-tag>
  task-claim.sh update [--session <tag>] <id> <task-id> [<session-tag>] <status> [<reason>]
  task-claim.sh release <id> <task-id>
  task-claim.sh list <id>
  task-claim.sh rollup <id>
  task-claim.sh report-write <id> <task-id> <path-or-->
  task-claim.sh report-list <id>
  task-claim.sh report-rollup <id>
EOF
  exit 1
}

# Resolve directory where implement-plan-<id>/ lives
resolve_paths() {
  local id="$1"
  local base_dir=".agent-relay"
  if [[ -d ".agent-relay" ]]; then
    base_dir=".agent-relay"
  elif [[ -f "CURRENT" || -f "plan-${id}.md" || -d "implement-plan-${id}" ]]; then
    base_dir="."
  else
    base_dir=".agent-relay"
  fi

  PLAN_DIR="$base_dir/implement-plan-$id"
  ROLLUP_FILE="$base_dir/implement-plan-$id.md"
  BASE_DIR="$base_dir"
}

get_lock_age() {
  local lock_dir="$1"
  local now
  now="$(date +%s)"
  local lock_time=""
  if [[ -f "$lock_dir/created_epoch" ]]; then
    lock_time="$(cat "$lock_dir/created_epoch" 2>/dev/null || true)"
  fi
  if [[ -z "$lock_time" && -f "$lock_dir/owner" ]]; then
    local ts
    ts="$(awk '{print $2}' "$lock_dir/owner" 2>/dev/null || true)"
    if [[ -n "$ts" ]]; then
      lock_time="$(date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$ts" +%s 2>/dev/null || date -u -d "$ts" +%s 2>/dev/null || true)"
    fi
  fi
  if [[ -z "$lock_time" ]]; then
    lock_time="$(stat -f %m "$lock_dir" 2>/dev/null || stat -c %Y "$lock_dir" 2>/dev/null || true)"
  fi
  case "$lock_time" in
    ''|*[!0-9]*) echo 0 ;;
    *) echo "$((now - lock_time))" ;;
  esac
}

get_ordered_tasks() {
  local plan_dir="$1"
  local order_file="$plan_dir/.order"
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
      if ! grep -q "^[[:space:]]*$tid[[:space:]]*$" "$order_file" 2>/dev/null; then
        echo "$tid"
      fi
    done | sort -V 2>/dev/null || true
  else
    for f in "$plan_dir"/*.status; do
      [[ -f "$f" ]] || continue
      local fname="${f##*/}"
      echo "${fname%.status}"
    done | sort -V 2>/dev/null || true
  fi
}

regenerate_rollup() {
  local plan_dir="$1"
  local rollup_file="$2"
  local id="$3"

  # Serialize rollup rebuilds across agents updating different tasks so a
  # slower writer cannot overwrite a newer rollup (lost update on the
  # derived file). Authoritative state remains the per-task .status files.
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
      status="$(grep -E '^status:' "$sfile" | head -n 1 | sed -e 's/^status:[[:space:]]*//')"
      desc="$(grep -E '^desc:' "$sfile" | head -n 1 | sed -e 's/^desc:[[:space:]]*//')"
      echo "- [$status] $tid: $desc"
    done < <(get_ordered_tasks "$plan_dir")
  } > "$tmp_rollup"

  mv -f "$tmp_rollup" "$rollup_file"
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

    # Read tasks in order from .order if it exists in the plan dir
    # To do that, we need the plan dir. Let's find it.
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
      # Fallback: just list .md files in alphabetical order
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
list_tasks() {
  local plan_dir="$1"
  while IFS= read -r tid || [[ -n "$tid" ]]; do
    [[ -n "$tid" ]] || continue
    local sfile="$plan_dir/$tid.status"
    [[ -f "$sfile" ]] || continue
    local status=""
    local desc=""
    status="$(grep -E '^status:' "$sfile" | head -n 1 | sed -e 's/^status:[[:space:]]*//')"
    desc="$(grep -E '^desc:' "$sfile" | head -n 1 | sed -e 's/^desc:[[:space:]]*//')"
    echo "- [$status] $tid: $desc"
  done < <(get_ordered_tasks "$plan_dir")
}

# Main command handling
OPT_SESSION=""
if [[ $# -ge 2 && "$1" == "--session" ]]; then
  OPT_SESSION="$2"
  shift 2
fi

[[ $# -ge 1 ]] || usage
SUBCMD="$1"
shift

case "$SUBCMD" in
  claim)
    [[ $# -eq 3 ]] || usage
    ID="$1"
    TASK_ID="$2"
    SESSION_TAG="$3"

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

    # Check dependencies before claiming
    DEPS="$(grep -E '^deps:' "$TASK_FILE" 2>/dev/null | head -n 1 | sed -e 's/^deps:[[:space:]]*//' || true)"
    if [[ -n "$DEPS" ]]; then
      for dep in $DEPS; do
        dep_file="$PLAN_DIR/$dep.status"
        if [[ ! -f "$dep_file" ]]; then
          echo "Error: dependency '$dep' for task '$TASK_ID' does not exist." >&2
          exit 1
        fi
        dep_status="$(grep -E '^status:' "$dep_file" 2>/dev/null | head -n 1 | sed -e 's/^status:[[:space:]]*//' || true)"
        if [[ "$dep_status" != done* ]]; then
          echo "Error: dependency '$dep' is not done (status: $dep_status). Cannot claim '$TASK_ID'." >&2
          exit 1
        fi
      done
    fi

    LOCK_DIR="$PLAN_DIR/.lock-$TASK_ID"
    ISO_NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    EPOCH_NOW="$(date +%s)"

    if mkdir "$LOCK_DIR" 2>/dev/null; then
      printf '%s %s\n' "$SESSION_TAG" "$ISO_NOW" > "$LOCK_DIR/owner"
      printf '%s\n' "$EPOCH_NOW" > "$LOCK_DIR/created_epoch"
    else
      # Lock dir already exists. Check for stale lock.
      LOCK_AGE="$(get_lock_age "$LOCK_DIR")"
      if [[ "$LOCK_AGE" -ge "$STALE_THRESHOLD" ]]; then
        OLD_OWNER="$(cat "$LOCK_DIR/owner" 2>/dev/null || echo "unknown")"
        echo "WARNING: Stealing stale lock on task '$TASK_ID' (held by $OLD_OWNER for ${LOCK_AGE}s > ${STALE_THRESHOLD}s)" >&2
        rm -rf "$LOCK_DIR"
        if mkdir "$LOCK_DIR" 2>/dev/null; then
          printf '%s %s\n' "$SESSION_TAG" "$ISO_NOW" > "$LOCK_DIR/owner"
          printf '%s\n' "$EPOCH_NOW" > "$LOCK_DIR/created_epoch"
        else
          # Race condition on steal
          retries=5
          while [[ (! -s "$LOCK_DIR/owner") && $retries -gt 0 ]]; do
            sleep 0.1
            retries=$((retries - 1))
          done
          cat "$LOCK_DIR/owner" 2>/dev/null || echo "locked"
          exit 1
        fi
      else
        # Not stale. Print existing lock owner and timestamp.
        retries=5
        while [[ (! -s "$LOCK_DIR/owner") && $retries -gt 0 ]]; do
          sleep 0.1
          retries=$((retries - 1))
        done
        cat "$LOCK_DIR/owner" 2>/dev/null || echo "locked"
        exit 1
      fi
    fi

    # Update status to in-progress
    DESC="$(grep -E '^desc[[:space:]]*:' "$TASK_FILE" 2>/dev/null | head -n 1 | sed -e 's/^desc[[:space:]]*:[[:space:]]*//' || true)"
    DEPS="$(grep -E '^deps[[:space:]]*:' "$TASK_FILE" 2>/dev/null | head -n 1 | sed -e 's/^deps[[:space:]]*:[[:space:]]*//' || true)"
    if grep -q -E '^deps[[:space:]]*:' "$TASK_FILE" 2>/dev/null; then
      printf 'status: in-progress\ndesc: %s\ndeps: %s\n' "$DESC" "$DEPS" > "$TASK_FILE.tmp"
    else
      printf 'status: in-progress\ndesc: %s\n' "$DESC" > "$TASK_FILE.tmp"
    fi
    mv -f "$TASK_FILE.tmp" "$TASK_FILE"

    regenerate_rollup "$PLAN_DIR" "$ROLLUP_FILE" "$ID"
    ;;

  update)
    [[ $# -ge 3 ]] || usage
    ID="$1"
    TASK_ID="$2"
    shift 2

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

    # Determine session tag and status from remaining arguments
    ARG_SESSION=""
    ARG_STATUS=""
    REASON=""

    # Check if first remaining arg is a known status keyword
    FIRST_ARG="$1"
    case "$FIRST_ARG" in
      pending|in-progress|done|skipped*)
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

    # Resolve caller session tag
    CALLER_SESSION="${OPT_SESSION:-${ARG_SESSION:-${SESSION_TAG:-${SESSION:-}}}}"

    if [[ -z "$CALLER_SESSION" ]]; then
      echo "Error: session-tag required to update task '$TASK_ID' (held by '$OWNER_TAG')" >&2
      exit 1
    fi

    if [[ "$CALLER_SESSION" != "$OWNER_TAG" ]]; then
      echo "Error: caller session tag '$CALLER_SESSION' does not match lock owner '$OWNER_TAG' for task '$TASK_ID'" >&2
      exit 1
    fi

    # Format status string
    FINAL_STATUS="$ARG_STATUS"
    if [[ "$ARG_STATUS" == "skipped" && -n "$REASON" ]]; then
      # Strip wrapping parens if already present in reason
      CLEAN_REASON="$(echo "$REASON" | sed -e 's/^[[:space:]]*(//' -e 's/)[[:space:]]*$//')"
      FINAL_STATUS="skipped ($CLEAN_REASON)"
    elif [[ -n "$REASON" && "$ARG_STATUS" != skipped* ]]; then
      FINAL_STATUS="$ARG_STATUS ($REASON)"
    fi

    DESC="$(grep -E '^desc[[:space:]]*:' "$TASK_FILE" 2>/dev/null | head -n 1 | sed -e 's/^desc[[:space:]]*:[[:space:]]*//' || true)"
    DEPS="$(grep -E '^deps[[:space:]]*:' "$TASK_FILE" 2>/dev/null | head -n 1 | sed -e 's/^deps[[:space:]]*:[[:space:]]*//' || true)"
    if grep -q -E '^deps[[:space:]]*:' "$TASK_FILE" 2>/dev/null; then
      printf 'status: %s\ndesc: %s\ndeps: %s\n' "$FINAL_STATUS" "$DESC" "$DEPS" > "$TASK_FILE.tmp"
    else
      printf 'status: %s\ndesc: %s\n' "$FINAL_STATUS" "$DESC" > "$TASK_FILE.tmp"
    fi
    mv -f "$TASK_FILE.tmp" "$TASK_FILE"

    regenerate_rollup "$PLAN_DIR" "$ROLLUP_FILE" "$ID"
    ;;

  release)
    [[ $# -eq 2 ]] || usage
    ID="$1"
    TASK_ID="$2"

    resolve_paths "$ID"
    LOCK_DIR="$PLAN_DIR/.lock-$TASK_ID"

    if [[ -d "$LOCK_DIR" ]]; then
      rm -rf "$LOCK_DIR"
    fi

    regenerate_rollup "$PLAN_DIR" "$ROLLUP_FILE" "$ID"
    ;;


  list)
    [[ $# -eq 1 ]] || usage
    ID="$1"

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

    resolve_paths "$ID"
    [[ -d "$PLAN_DIR" ]] || {
      echo "Error: plan directory '$PLAN_DIR' does not exist." >&2
      exit 1
    }

    regenerate_rollup "$PLAN_DIR" "$ROLLUP_FILE" "$ID"
    ;;

  *)
    usage
    ;;
esac
