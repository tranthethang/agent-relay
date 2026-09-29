#!/usr/bin/env bash
# scripts/runtime/run-cockpit.sh
# Human cockpit writers: approve, close, stamp, decide.
# Thin wrappers over run-history.sh append with by=human.
# Bash 3.2+ compatible, POSIX tools only. Record, don't enforce.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESOLVE_RUN="$SCRIPT_DIR/resolve-run.sh"
HISTORY_SH="$SCRIPT_DIR/run-history.sh"

usage() {
  cat <<'EOF'
Usage:
  run-cockpit.sh approve <run-dir-or-id> plan [note=<token>]
  run-cockpit.sh close <run-dir-or-id>
  run-cockpit.sh close <run-dir-or-id> --abandon <reason>
  run-cockpit.sh stamp <run-dir-or-id> <stage> tool=<t> model=<m>
  run-cockpit.sh decide <run-dir-or-id> <id> <resolution>

All commands append a by=human history event. decide also appends one
line to decisions.md. Free-text for decide lives in that file; history
only carries id=<slug>. reason/note tokens must not contain spaces.
EOF
  exit 1
}

if [[ $# -lt 1 ]]; then
  usage
fi

SUB="$1"
shift

resolve_run_dir() {
  local target="$1"
  local run_dir
  if [[ -x "$RESOLVE_RUN" || -f "$RESOLVE_RUN" ]]; then
    run_dir="$("$RESOLVE_RUN" "$target")"
  else
    run_dir="$target"
  fi
  if [[ ! -d "$run_dir" || "$(basename "$run_dir")" == ".agent-relay" ]]; then
    echo "Error: run directory '$run_dir' not found" >&2
    exit 1
  fi
  printf '%s\n' "$run_dir"
}

append_history() {
  local run_dir="$1"
  shift
  bash "$HISTORY_SH" append "$run_dir" "$@"
}

valid_slug() {
  local s="$1"
  if [[ ${#s} -lt 3 || ${#s} -gt 48 ]]; then
    return 1
  fi
  [[ "$s" =~ ^[a-z]+(-[a-z]+)*$ ]]
}

safe_token() {
  # True when value is a single history token (no whitespace).
  local v="$1"
  [[ -n "$v" ]] || return 1
  case "$v" in
  *[[:space:]]*) return 1 ;;
  esac
  return 0
}

reject_unknown() {
  local label="$1"
  local val="$2"
  if [[ -z "$val" ]]; then
    echo "Error: $label must not be empty" >&2
    exit 1
  fi
  if [[ "$val" == "unknown" ]]; then
    echo "Error: $label must not be 'unknown' (use atry stamp with the real value)" >&2
    exit 1
  fi
}

case "$SUB" in
approve)
  [[ $# -ge 2 ]] || usage
  TARGET="$1"
  WHAT="$2"
  shift 2
  if [[ "$WHAT" != "plan" ]]; then
    echo "Error: approve only supports 'plan' (got '$WHAT')" >&2
    exit 1
  fi
  NOTE_KV=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
    note=*)
      note_val="${1#note=}"
      if ! safe_token "$note_val"; then
        echo "Error: note= value must be a single token without spaces" >&2
        exit 1
      fi
      NOTE_KV="note=$note_val"
      shift
      ;;
    *)
      echo "Error: unexpected argument '$1'" >&2
      usage
      ;;
    esac
  done
  RUN_DIR="$(resolve_run_dir "$TARGET")"
  if [[ -n "$NOTE_KV" ]]; then
    append_history "$RUN_DIR" plan approved by=human "$NOTE_KV"
  else
    append_history "$RUN_DIR" plan approved by=human
  fi
  echo "approve: recorded plan approved for $(basename "$RUN_DIR")"
  ;;

close)
  [[ $# -ge 1 ]] || usage
  TARGET="$1"
  shift
  ABANDON=0
  REASON=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
    --abandon)
      shift
      [[ $# -ge 1 ]] || {
        echo "Error: --abandon requires a reason" >&2
        exit 1
      }
      ABANDON=1
      REASON="$1"
      shift
      ;;
    *)
      echo "Error: unexpected argument '$1'" >&2
      usage
      ;;
    esac
  done
  RUN_DIR="$(resolve_run_dir "$TARGET")"
  if [[ "$ABANDON" -eq 1 ]]; then
    # Collapse whitespace to hyphens so the history token stays parseable.
    reason_tok="$(printf '%s' "$REASON" | tr -s '[:space:]' '-' | sed -e 's/^-//' -e 's/-$//')"
    if [[ -z "$reason_tok" ]] || ! safe_token "$reason_tok"; then
      echo "Error: abandon reason must yield a non-empty token (letters, digits, ._+-)" >&2
      exit 1
    fi
    case "$reason_tok" in
    *[!A-Za-z0-9._+-]*)
      echo "Error: abandon reason has unsupported characters after normalizing spaces" >&2
      exit 1
      ;;
    esac
    append_history "$RUN_DIR" "done" abandoned by=human "reason=$reason_tok"
    echo "close: abandoned $(basename "$RUN_DIR") reason=$reason_tok"
  else
    append_history "$RUN_DIR" "done" completed by=human
    echo "close: completed $(basename "$RUN_DIR")"
  fi
  ;;

stamp)
  [[ $# -ge 3 ]] || usage
  TARGET="$1"
  STAGE="$2"
  shift 2
  case "$STAGE" in
  plan | implement | self-review | cross-review | distill) ;;
  *)
    echo "Error: stamp stage must be plan|implement|self-review|cross-review|distill (got '$STAGE')" >&2
    exit 1
    ;;
  esac
  TOOL=""
  MODEL=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
    tool=*)
      TOOL="${1#tool=}"
      shift
      ;;
    model=*)
      MODEL="${1#model=}"
      shift
      ;;
    *)
      echo "Error: unexpected argument '$1' (expected tool= and model=)" >&2
      usage
      ;;
    esac
  done
  [[ -n "$TOOL" && -n "$MODEL" ]] || {
    echo "Error: stamp requires tool=<t> and model=<m>" >&2
    exit 1
  }
  if ! safe_token "$TOOL"; then
    echo "Error: tool= must be a single token without spaces" >&2
    exit 1
  fi
  if ! safe_token "$MODEL"; then
    echo "Error: model= must be a single token without spaces" >&2
    exit 1
  fi
  reject_unknown "tool" "$TOOL"
  reject_unknown "model" "$MODEL"
  RUN_DIR="$(resolve_run_dir "$TARGET")"
  append_history "$RUN_DIR" "$STAGE" attested by=human "tool=$TOOL" "model=$MODEL"
  echo "stamp: attested $STAGE tool=$TOOL model=$MODEL for $(basename "$RUN_DIR")"
  ;;

decide)
  [[ $# -ge 3 ]] || usage
  TARGET="$1"
  DEC_ID="$2"
  shift 2
  # Remaining args joined as the resolution (may contain spaces).
  RESOLUTION="$*"
  [[ -n "$RESOLUTION" ]] || {
    echo "Error: decide requires a non-empty resolution" >&2
    exit 1
  }
  if ! valid_slug "$DEC_ID"; then
    echo "Error: decide id must match ^[a-z]+(-[a-z]+)*\$ and length 3-48 (got '$DEC_ID')" >&2
    exit 1
  fi
  case "$RESOLUTION" in
  *$'\n'* | *$'\r'*)
    echo "Error: resolution must be a single line" >&2
    exit 1
    ;;
  esac
  RUN_DIR="$(resolve_run_dir "$TARGET")"
  TODAY="$(date +%F)"
  {
    printf -- '- %s %s: %s (by=human)\n' "$TODAY" "$DEC_ID" "$RESOLUTION"
  } >>"$RUN_DIR/decisions.md"
  append_history "$RUN_DIR" decision resolved by=human "id=$DEC_ID"
  echo "decide: recorded $DEC_ID in $(basename "$RUN_DIR")/decisions.md"
  ;;

-h | --help | help)
  usage
  ;;

*)
  echo "Error: unknown cockpit command '$SUB'" >&2
  usage
  ;;
esac
