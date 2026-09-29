#!/usr/bin/env bash
# scripts/runtime/distill-finalize.sh
# Deterministic tail of atry-distill: bank check, metrics, push, set-status,
# Bank push line, vault-only re-push, and closing history events.
# Judgment (classify / write notes) stays in the skill; this helper only
# runs the fixed sequence. See skills/atry-distill/SKILL.md and docs/bank.md.
#
# Bash 3.2+ compatible, POSIX tools only.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESOLVE_RUN="$SCRIPT_DIR/resolve-run.sh"
BANK_CHECK="$SCRIPT_DIR/bank-check.sh"
BANK_PUSH="$SCRIPT_DIR/bank-push.sh"
BANK_SET_STATUS="$SCRIPT_DIR/bank-set-status.sh"
RUN_METRICS="$SCRIPT_DIR/run-metrics.sh"
RUN_HISTORY="$SCRIPT_DIR/run-history.sh"
# shellcheck source=scripts/runtime/find-agent-relay-dir.sh
source "$SCRIPT_DIR/find-agent-relay-dir.sh"

usage() {
  cat <<'EOF'
Usage:
  distill-finalize.sh <run-dir-or-id> [k=v ...]

Finalize a distill stage after notes exist under $RUN_DIR/distill/:
  1. Require exactly one type: run note
  2. bank check
  3. metrics --write on the run note
  4. bank push when a sink is usable
  5. set-status for supersedes: / resolves:
  6. Write one Bank push: line on the run note
  7. bank push --vault-only when step 4 exited 0
  8. history: distill completed (+ optional k=v) then done completed

Exit 0: finished (bank/metrics failures are recorded on the run note).
Exit 1: validation failure (missing distill/, no/duplicate run note, bad args).
EOF
  exit 1
}

[[ $# -ge 1 ]] || usage
TARGET="$1"
shift
HISTORY_KV=("$@")

frontmatter_field() {
  local f="$1" key="$2"
  awk -v key="$key" '
    /^---[[:space:]]*$/ {
      c++
      if (c >= 2) exit
      next
    }
    c == 1 {
      prefix = key ":"
      if (index($0, prefix) == 1) {
        rest = substr($0, length(prefix) + 1)
        sub(/^[[:space:]]+/, "", rest)
        sub(/[[:space:]]+$/, "", rest)
        print rest
        exit
      }
    }
  ' "$f"
}

# Strip optional quotes and [[…]] from a frontmatter wikilink value.
# Echoes basename without .md, or empty if unset/placeholder.
wikilink_stem() {
  local raw="$1"
  local s="$raw"
  # Strip surrounding double quotes
  if [[ "$s" == \"*\" ]]; then
    s="${s#\"}"
    s="${s%\"}"
  fi
  # Strip [[…]]
  if [[ "$s" == \[\[*\]\] ]]; then
    s="${s#\[\[}"
    s="${s%\]\]}"
  fi
  # Drop accidental .md suffix
  s="${s%.md}"
  # Empty / placeholder
  case "$s" in
  "" | "<"* | "{"*)
    printf ''
    return 0
    ;;
  esac
  printf '%s\n' "$s"
}

read_status_field() {
  local status_file="$1" field="$2"
  [[ -f "$status_file" ]] || {
    printf ''
    return 0
  }
  sed -n "s/^${field}: //p" "$status_file" | head -1
}

# Replace the body of ## Bank push with exactly one "Bank push: …" line
# (plus optional extras). Any prior content under that heading is dropped.
write_bank_push_section() {
  local note="$1"
  local line="$2"
  shift 2
  local extras=("$@")
  local tmp e
  tmp="$(mktemp "${TMPDIR:-/tmp}/ar-distill-bp.XXXXXX")"
  {
    awk -v newline="$line" '
      BEGIN { in_bp=0; wrote=0 }
      /^##[[:space:]]/ {
        if (in_bp && !wrote) {
          print ""
          print newline
          wrote=1
        }
        in_bp=0
        if ($0 ~ /^##[[:space:]]+Bank push[[:space:]]*$/) in_bp=1
        print
        next
      }
      in_bp { next }
      { print }
      END {
        if (in_bp && !wrote) {
          print ""
          print newline
        }
        if (!in_bp && !wrote) {
          print ""
          print "## Bank push"
          print ""
          print newline
        }
      }
    ' "$note"
    # Extraneous: awk already wrote the line; extras need a second pass.
  } >"$tmp"
  if [[ ${#extras[@]} -gt 0 ]]; then
    local tmp2
    tmp2="$(mktemp "${TMPDIR:-/tmp}/ar-distill-bp2.XXXXXX")"
    {
      while IFS= read -r l || [[ -n "$l" ]]; do
        printf '%s\n' "$l"
        if [[ "$l" == "Bank push:"* ]]; then
          for e in "${extras[@]}"; do
            printf '%s\n' "$e"
          done
        fi
      done
    } <"$tmp" >"$tmp2"
    mv "$tmp2" "$tmp"
  fi
  mv "$tmp" "$note"
}

append_metrics_failure() {
  local note="$1"
  local reason="$2"
  local tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/ar-distill-met.XXXXXX")"
  awk -v reason="$reason" '
    BEGIN { in_m=0; wrote=0 }
    /^##[[:space:]]/ {
      if (in_m && !wrote) {
        print "Metrics failed: " reason
        wrote=1
      }
      in_m=0
      if ($0 ~ /^##[[:space:]]+Metrics[[:space:]]*$/) in_m=1
      print
      next
    }
    in_m && /^Metrics failed:/ { next }
    { print }
    END {
      if (in_m && !wrote) print "Metrics failed: " reason
      if (!in_m && !wrote) {
        print ""
        print "## Metrics"
        print ""
        print "Metrics failed: " reason
      }
    }
  ' "$note" >"$tmp"
  mv "$tmp" "$note"
}

# ---- resolve run ----
if [[ ! -f "$RESOLVE_RUN" ]]; then
  echo "Error: missing resolve-run helper at $RESOLVE_RUN" >&2
  exit 1
fi
RUN_DIR="$("$RESOLVE_RUN" "$TARGET")"
if [[ ! -d "$RUN_DIR" || "$(basename "$RUN_DIR")" == ".agent-relay" ]]; then
  echo "Error: run directory '$RUN_DIR' not found" >&2
  exit 1
fi

DISTILL_DIR="$RUN_DIR/distill"
if [[ ! -d "$DISTILL_DIR" ]]; then
  echo "Error: distill directory missing: $DISTILL_DIR" >&2
  exit 1
fi

# ---- find exactly one type: run note ----
RUN_NOTES=()
shopt -s nullglob
for f in "$DISTILL_DIR"/*.md; do
  [[ -f "$f" ]] || continue
  type="$(frontmatter_field "$f" type)"
  if [[ "$type" == "run" ]]; then
    RUN_NOTES+=("$f")
  fi
done
shopt -u nullglob

if [[ ${#RUN_NOTES[@]} -eq 0 ]]; then
  echo "Error: no type: run note in $DISTILL_DIR" >&2
  exit 1
fi
if [[ ${#RUN_NOTES[@]} -gt 1 ]]; then
  echo "Error: multiple type: run notes in $DISTILL_DIR:" >&2
  for f in "${RUN_NOTES[@]}"; do
    echo "  $(basename "$f")" >&2
  done
  exit 1
fi
RUN_NOTE="${RUN_NOTES[0]}"

# ---- bank check ----
CHECK_RC=0
set +e
bash "$BANK_CHECK" "$RUN_DIR" >/dev/null
CHECK_RC=$?
set -e

AGENT_RELAY_DIR=""
BANK_STATUS=""
CONFIGURED=""
REACHABLE=""
ATRY_REACHABLE=""
AM_REACHABLE=""
BANK_PATH=""
ATRY_PATH=""
SINK_USABLE=0

if AGENT_RELAY_DIR="$(find_agent_relay_dir "$RUN_DIR" 2>/dev/null)"; then
  BANK_STATUS="$AGENT_RELAY_DIR/bank-status.md"
  if [[ -f "$BANK_STATUS" ]]; then
    CONFIGURED="$(read_status_field "$BANK_STATUS" configured)"
    REACHABLE="$(read_status_field "$BANK_STATUS" reachable)"
    ATRY_REACHABLE="$(read_status_field "$BANK_STATUS" atry_reachable)"
    AM_REACHABLE="$(read_status_field "$BANK_STATUS" agentmemory_reachable)"
    BANK_PATH="$(read_status_field "$BANK_STATUS" bank_path)"
    ATRY_PATH="$(read_status_field "$BANK_STATUS" atry_path)"
    if [[ "$CHECK_RC" -eq 0 && "$CONFIGURED" == "true" ]]; then
      if [[ "$REACHABLE" == "true" || "$ATRY_REACHABLE" == "true" || "$AM_REACHABLE" == "true" ]]; then
        SINK_USABLE=1
      fi
    fi
  fi
fi

# ---- metrics --write ----
METRICS_RC=0
set +e
bash "$RUN_METRICS" "$RUN_DIR" --write "$RUN_NOTE" >/dev/null
METRICS_RC=$?
set -e
if [[ "$METRICS_RC" -ne 0 ]]; then
  append_metrics_failure "$RUN_NOTE" "atry metrics exited $METRICS_RC"
fi

# ---- bank push (when usable) ----
PUSH_RC=2
PUSH_SKIPPED=0
PUSH_REASON=""
SET_STATUS_EXTRAS=()
PROJ_COUNT=0
ATRY_COUNT=0

count_lane_notes() {
  local scope_want="$1"
  local f scope type
  local n=0
  shopt -s nullglob
  for f in "$DISTILL_DIR"/*.md; do
    [[ -f "$f" ]] || continue
    type="$(frontmatter_field "$f" type)"
    scope="$(frontmatter_field "$f" scope)"
    if [[ "$scope_want" == "atry" ]]; then
      if [[ "$scope" == "atry" ]]; then
        n=$((n + 1))
      fi
    else
      # project lane: project or module:*
      if [[ "$scope" != "atry" ]]; then
        n=$((n + 1))
      fi
    fi
  done
  shopt -u nullglob
  printf '%s\n' "$n"
}

if [[ "$SINK_USABLE" -eq 1 ]]; then
  PROJ_COUNT="$(count_lane_notes project)"
  ATRY_COUNT="$(count_lane_notes atry)"
  set +e
  bash "$BANK_PUSH" "$RUN_DIR" "$DISTILL_DIR" >/dev/null
  PUSH_RC=$?
  set -e
  if [[ "$PUSH_RC" -eq 2 ]]; then
    PUSH_SKIPPED=1
    PUSH_REASON="no usable sink"
  elif [[ "$PUSH_RC" -ne 0 ]]; then
    PUSH_REASON="bank push exited $PUSH_RC"
  fi
else
  PUSH_SKIPPED=1
  if [[ "$CHECK_RC" -ne 0 ]]; then
    PUSH_REASON="bank check exited $CHECK_RC"
  elif [[ "$CONFIGURED" != "true" ]]; then
    PUSH_REASON="bank not configured"
  else
    PUSH_REASON="no usable sink"
  fi
fi

# ---- set-status for supersedes / resolves (after successful push path) ----
# Run whenever push exited 0 (vault copies exist). Failures never fail the stage.
if [[ "$PUSH_RC" -eq 0 ]]; then
  shopt -s nullglob
  for f in "$DISTILL_DIR"/*.md; do
    [[ -f "$f" ]] || continue
    type="$(frontmatter_field "$f" type)"
    [[ "$type" != "run" ]] || continue
    new_base="$(basename "$f")"
    super_raw="$(frontmatter_field "$f" supersedes)"
    resolve_raw="$(frontmatter_field "$f" resolves)"
    super_stem="$(wikilink_stem "$super_raw")"
    resolve_stem="$(wikilink_stem "$resolve_raw")"
    if [[ -n "$super_stem" ]]; then
      set +e
      bash "$BANK_SET_STATUS" "$RUN_DIR" "${super_stem}.md" superseded --by "$new_base" >/dev/null 2>/dev/null
      ss_rc=$?
      set -e
      if [[ "$ss_rc" -ne 0 ]]; then
        SET_STATUS_EXTRAS+=("set-status failed: ${super_stem}.md superseded --by $new_base (exit $ss_rc)")
      fi
    fi
    if [[ -n "$resolve_stem" ]]; then
      set +e
      bash "$BANK_SET_STATUS" "$RUN_DIR" "${resolve_stem}.md" resolved --by "$new_base" >/dev/null 2>/dev/null
      ss_rc=$?
      set -e
      if [[ "$ss_rc" -ne 0 ]]; then
        SET_STATUS_EXTRAS+=("set-status failed: ${resolve_stem}.md resolved --by $new_base (exit $ss_rc)")
      fi
    fi
  done
  shopt -u nullglob
fi

# ---- Bank push: line ----
BANK_LINE=""
if [[ "$PUSH_SKIPPED" -eq 1 ]]; then
  case "$PUSH_REASON" in
  "bank not configured")
    BANK_LINE="Bank push: skipped — bank not configured"
    ;;
  *)
    BANK_LINE="Bank push: skipped — $PUSH_REASON"
    ;;
  esac
elif [[ "$PUSH_RC" -ne 0 ]]; then
  BANK_LINE="Bank push: failed — $PUSH_REASON"
else
  # Success: mention lanes that received notes.
  if [[ -n "$BANK_PATH" && "$REACHABLE" == "true" && "$PROJ_COUNT" -gt 0 ]]; then
    BANK_LINE="Bank push: pushed $PROJ_COUNT notes to $BANK_PATH"
    if [[ -n "$ATRY_PATH" && "$ATRY_REACHABLE" == "true" && "$ATRY_COUNT" -gt 0 ]]; then
      if [[ "$BANK_PATH" == "$ATRY_PATH" ]]; then
        # Equal paths: one write root; still mention atry count when present.
        BANK_LINE="Bank push: pushed $PROJ_COUNT notes to $BANK_PATH and $ATRY_COUNT to $ATRY_PATH"
      else
        BANK_LINE="Bank push: pushed $PROJ_COUNT notes to $BANK_PATH and $ATRY_COUNT to $ATRY_PATH"
      fi
    fi
  elif [[ -n "$ATRY_PATH" && "$ATRY_REACHABLE" == "true" && "$ATRY_COUNT" -gt 0 ]]; then
    BANK_LINE="Bank push: pushed $ATRY_COUNT notes to $ATRY_PATH"
  elif [[ "$AM_REACHABLE" == "true" ]]; then
    # Agentmemory-only success (no vault notes written, or vaults unused).
    total=0
    shopt -s nullglob
    for f in "$DISTILL_DIR"/*.md; do
      [[ -f "$f" ]] && total=$((total + 1))
    done
    shopt -u nullglob
    BANK_LINE="Bank push: pushed $total notes to agentmemory"
  else
    BANK_LINE="Bank push: pushed notes"
  fi
fi

if [[ ${#SET_STATUS_EXTRAS[@]} -gt 0 ]]; then
  write_bank_push_section "$RUN_NOTE" "$BANK_LINE" "${SET_STATUS_EXTRAS[@]}"
else
  write_bank_push_section "$RUN_NOTE" "$BANK_LINE"
fi

# ---- vault-only re-push when first push exited 0 ----
if [[ "$PUSH_RC" -eq 0 ]]; then
  set +e
  bash "$BANK_PUSH" --vault-only "$RUN_DIR" "$DISTILL_DIR" >/dev/null
  set -e
  # Ignore vault-only failures — never fail the stage on bank I/O.
fi

# ---- history: distill completed then done completed ----
if [[ ${#HISTORY_KV[@]} -gt 0 ]]; then
  bash "$RUN_HISTORY" append "$RUN_DIR" distill completed "${HISTORY_KV[@]}"
else
  bash "$RUN_HISTORY" append "$RUN_DIR" distill completed
fi
bash "$RUN_HISTORY" append "$RUN_DIR" "done" completed

exit 0
