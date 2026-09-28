#!/usr/bin/env bash
# scripts/runtime/run-history.sh
# Append and view events in an agent-relay run's history.log
# Bash 3.2+ compatible, POSIX tools only.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESOLVE_RUN="$SCRIPT_DIR/resolve-run.sh"

usage() {
  cat <<'EOF'
Usage:
  run-history.sh append <run-dir-or-id> <stage> <action> [k=v ...]
  run-history.sh show <run-dir-or-id>
EOF
  exit 1
}

if [[ $# -lt 2 ]]; then
  usage
fi

SUBCOMMAND="$1"
shift

case "$SUBCOMMAND" in
append)
  [[ $# -ge 3 ]] || usage
  TARGET="$1"
  STAGE="$2"
  ACTION="$3"
  shift 3

  if [[ -x "$RESOLVE_RUN" ]]; then
    RUN_DIR="$("$RESOLVE_RUN" "$TARGET")"
  else
    RUN_DIR="$TARGET"
  fi

  if [[ ! -d "$RUN_DIR" || "$(basename "$RUN_DIR")" == ".agent-relay" ]]; then
    echo "Error: run directory '$RUN_DIR' not found" >&2
    exit 1
  fi

  NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  line="$NOW_ISO stage=$STAGE action=$ACTION"
  HAS_HEAD=0
  while [[ $# -gt 0 ]]; do
    case "$1" in head=*) HAS_HEAD=1 ;; esac
    line="$line $1"
    shift
  done

  # Record the commit implement starts from, so `atry metrics` can size this
  # run's change even when several plans share one `base:`. Read-only git.
  if [[ "$STAGE" == "implement" && "$ACTION" == "started" && "$HAS_HEAD" -eq 0 ]]; then
    if head_sha="$(GIT_OPTIONAL_LOCKS=0 git -C "$RUN_DIR" rev-parse --verify HEAD 2>/dev/null)"; then
      line="$line head=$head_sha"
    fi
  fi

  printf '%s\n' "$line" >>"$RUN_DIR/history.log"

  # Update meta.md stage/status if meta.md exists
  if [[ -f "$RUN_DIR/meta.md" ]]; then
    case "$STAGE" in
    plan | implement | self-review | cross-review | distill | done)
      sed -e "s/^stage:.*/stage: $STAGE/" "$RUN_DIR/meta.md" >"$RUN_DIR/meta.md.tmp" && mv "$RUN_DIR/meta.md.tmp" "$RUN_DIR/meta.md"
      ;;
    esac
    if [[ "$ACTION" == "completed" && "$STAGE" == "done" ]]; then
      sed -e "s/^status:.*/status: done/" "$RUN_DIR/meta.md" >"$RUN_DIR/meta.md.tmp" && mv "$RUN_DIR/meta.md.tmp" "$RUN_DIR/meta.md"
    elif [[ "$ACTION" == "abandoned" ]]; then
      sed -e "s/^status:.*/status: abandoned/" "$RUN_DIR/meta.md" >"$RUN_DIR/meta.md.tmp" && mv "$RUN_DIR/meta.md.tmp" "$RUN_DIR/meta.md"
    fi
  fi
  ;;

show | list)
  TARGET="$1"
  if [[ -x "$RESOLVE_RUN" ]]; then
    RUN_DIR="$("$RESOLVE_RUN" "$TARGET")"
  else
    RUN_DIR="$TARGET"
  fi

  if [[ -f "$RUN_DIR/history.log" ]]; then
    cat "$RUN_DIR/history.log"
  fi
  ;;

*)
  usage
  ;;
esac
