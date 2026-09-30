#!/usr/bin/env bash
# scripts/runtime/run-history.sh
# Append and view events in an agent-relay run's history.log
# Bash 3.2+ compatible, POSIX tools only.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESOLVE_RUN="$SCRIPT_DIR/resolve-run.sh"
# shellcheck source=scripts/runtime/diff-size.sh
source "$SCRIPT_DIR/diff-size.sh"

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

  # Advisory only: implement may start without a human plan approval.
  if [[ "$STAGE" == "implement" && "$ACTION" == "started" ]]; then
    approved=0
    if [[ -f "$RUN_DIR/history.log" ]]; then
      while IFS= read -r _hline || [[ -n "$_hline" ]]; do
        _hstage=""
        _haction=""
        for _tok in ${_hline#* }; do
          case "$_tok" in
          stage=*) _hstage="${_tok#stage=}" ;;
          action=*) _haction="${_tok#action=}" ;;
          esac
        done
        if [[ "$_hstage" == "plan" && "$_haction" == "approved" ]]; then
          approved=1
          break
        fi
      done <"$RUN_DIR/history.log"
    fi
    if [[ "$approved" -eq 0 ]]; then
      echo "run-history: warning: plan not approved (no stage=plan action=approved); continuing anyway" >&2
    fi
  fi

  NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  line="$NOW_ISO stage=$STAGE action=$ACTION"
  HAS_HEAD=0
  HAS_SIZE=0
  while [[ $# -gt 0 ]]; do
    case "$1" in head=*) HAS_HEAD=1 ;; size=* | size_base=*) HAS_SIZE=1 ;; esac
    line="$line $1"
    shift
  done

  # Record HEAD as raw data for downstream readers: implement-start is the
  # diff base; completed on implement / self-review / cross-review is the
  # run's END. Explicit head= wins. Read-only git (GIT_OPTIONAL_LOCKS=0).
  if [[ "$HAS_HEAD" -eq 0 ]]; then
    should_head=0
    if [[ "$STAGE" == "implement" && "$ACTION" == "started" ]]; then
      should_head=1
    elif [[ "$ACTION" == "completed" ]]; then
      case "$STAGE" in
      implement | self-review | cross-review) should_head=1 ;;
      esac
    fi
    if [[ "$should_head" -eq 1 ]]; then
      if head_sha="$(GIT_OPTIONAL_LOCKS=0 git -C "$RUN_DIR" rev-parse --verify HEAD 2>/dev/null)"; then
        line="$line head=$head_sha"
      fi
    fi
  fi

  # Snapshot the change size when a stage completes (raw data for downstream
  # readers): size_base=<diff base sha> size=<files>/<added>/<deleted>,
  # working tree vs the diff base (see diff-size.sh). Explicit size=/size_base=
  # wins; any git failure just skips the snapshot.
  if [[ "$ACTION" == "completed" && "$HAS_SIZE" -eq 0 ]]; then
    case "$STAGE" in
    implement | self-review | cross-review)
      if size_root="$(diff_size_git_root "$RUN_DIR")" &&
        size_base="$(diff_size_base "$RUN_DIR" "$size_root")"; then
        read -r size_f size_a size_d <<<"$(diff_size "$size_root" "$size_base")"
        line="$line size_base=$size_base size=$size_f/$size_a/$size_d"
      fi
      ;;
    esac
  fi

  printf '%s\n' "$line" >>"$RUN_DIR/history.log"

  # Update meta.md stage/status if meta.md exists. Skip record-only actions
  # (approved / attested / resolved) so approve/stamp/decide do not rewind stage.
  if [[ -f "$RUN_DIR/meta.md" ]]; then
    update_stage=0
    case "$ACTION" in
    created | started | completed | abandoned) update_stage=1 ;;
    esac
    if [[ "$update_stage" -eq 1 ]]; then
      case "$STAGE" in
      plan | implement | self-review | cross-review | done)
        sed -e "s/^stage:.*/stage: $STAGE/" "$RUN_DIR/meta.md" >"$RUN_DIR/meta.md.tmp" && mv "$RUN_DIR/meta.md.tmp" "$RUN_DIR/meta.md"
        ;;
      esac
    fi
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
