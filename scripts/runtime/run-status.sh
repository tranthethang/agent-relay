#!/usr/bin/env bash
# scripts/runtime/run-status.sh
# Read-only human cockpit: list runs or show one run's detail + next step.
# Never writes meta.md or status files. Bash 3.2+ / POSIX tools only.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESOLVE_RUN="$SCRIPT_DIR/resolve-run.sh"
# shellcheck source=scripts/runtime/find-agent-relay-dir.sh
source "$SCRIPT_DIR/find-agent-relay-dir.sh"

usage() {
  cat <<'EOF'
Usage:
  run-status.sh [<run-dir-or-id>]

With no argument and more than one run: one line per run (newest first).
With a run argument (or exactly one run): detail for that run.
Never writes. Plain text only (no colour).
EOF
  exit 1
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
fi

TARGET="${1:-}"

find_base_dir() {
  local dir
  if ! dir="$(find_agent_relay_dir "$PWD")"; then
    echo "Error: no .agent-relay/ directory or git repository found above $PWD" >&2
    echo "Hint: run from the repo root, or 'git init', or 'mkdir .agent-relay' here." >&2
    exit 1
  fi
  printf '%s\n' "$dir"
}

is_run_dirname() {
  local name="$1"
  [[ "$name" =~ ^[0-9]{8}-[0-9]{10,11}-[a-z]+(-[a-z]+)*$ ]]
}

iso_to_epoch() {
  local ts="$1" epoch
  if epoch="$(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$ts" "+%s" 2>/dev/null)"; then
    printf '%s\n' "$epoch"
    return 0
  fi
  if epoch="$(date -u -d "$ts" "+%s" 2>/dev/null)"; then
    printf '%s\n' "$epoch"
    return 0
  fi
  return 1
}

age_of() {
  local ts="$1" now epoch delta
  if ! epoch="$(iso_to_epoch "$ts")"; then
    printf '%s\n' "?"
    return 0
  fi
  now="$(date -u +%s)"
  delta=$((now - epoch))
  if [[ "$delta" -lt 0 ]]; then
    delta=0
  fi
  if [[ "$delta" -lt 60 ]]; then
    printf '%ss\n' "$delta"
  elif [[ "$delta" -lt 3600 ]]; then
    printf '%sm\n' "$((delta / 60))"
  elif [[ "$delta" -lt 86400 ]]; then
    printf '%sh\n' "$((delta / 3600))"
  else
    printf '%sd\n' "$((delta / 86400))"
  fi
}

list_run_dirs() {
  local base="$1"
  local d name
  shopt -s nullglob
  for d in "$base"/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-*; do
    [[ -d "$d" ]] || continue
    name="$(basename "$d")"
    if is_run_dirname "$name"; then
      printf '%s\n' "$d"
    fi
  done
  shopt -u nullglob
}

meta_field() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || {
    printf '\n'
    return 0
  }
  sed -n "s/^${key}:[[:space:]]*//p" "$file" | head -n 1 | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

last_history_ts() {
  local hist="$1" line ts
  [[ -f "$hist" ]] || {
    printf '\n'
    return 0
  }
  line="$(tail -n 1 "$hist" 2>/dev/null || true)"
  [[ -n "$line" ]] || {
    printf '\n'
    return 0
  }
  ts="${line%% *}"
  printf '%s\n' "$ts"
}

# Scan history into STATE_* and ATT_* / TOOL_* / MODEL_* variables.
# Call as: scan_history "$RUN_DIR"
scan_history() {
  local run_dir="$1"
  local hist="$run_dir/history.log"
  local line rest tok
  local hstage haction htool hmodel
  STATE="planned"
  APPROVED=0
  IMPL_TOOL=""
  SR_TOOL=""
  CR_TOOL=""
  DIST_TOOL=""
  IMPL_MODEL=""
  SR_MODEL=""
  CR_MODEL=""
  DIST_MODEL=""
  IMPL_ATTESTED=0
  SR_ATTESTED=0
  CR_ATTESTED=0
  DIST_ATTESTED=0
  PLAN_TOOL=""
  PLAN_MODEL=""
  PLAN_ATTESTED=0
  USED_TOOLS=""

  # Self-report accumulators (latest non-attested tool= per stage).
  PLAN_TOOL_SR=""
  IMPL_TOOL_SR=""
  SR_TOOL_SR=""
  CR_TOOL_SR=""
  DIST_TOOL_SR=""

  [[ -f "$hist" ]] || return 0

  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -n "$line" ]] || continue
    case "$line" in
    *" stage="*) ;;
    *) continue ;;
    esac
    rest="${line#* }"
    hstage=""
    haction=""
    htool=""
    hmodel=""
    for tok in $rest; do
      case "$tok" in
      stage=*) hstage="${tok#stage=}" ;;
      action=*) haction="${tok#action=}" ;;
      tool=*) htool="${tok#tool=}" ;;
      model=*) hmodel="${tok#model=}" ;;
      esac
    done
    [[ -n "$hstage" && -n "$haction" ]] || continue

    case "$haction" in
    attested)
      case "$hstage" in
      plan)
        PLAN_ATTESTED=1
        [[ -n "$htool" ]] && PLAN_TOOL="$htool"
        [[ -n "$hmodel" ]] && PLAN_MODEL="$hmodel"
        ;;
      implement)
        IMPL_ATTESTED=1
        [[ -n "$htool" ]] && IMPL_TOOL="$htool"
        [[ -n "$hmodel" ]] && IMPL_MODEL="$hmodel"
        ;;
      self-review)
        SR_ATTESTED=1
        [[ -n "$htool" ]] && SR_TOOL="$htool"
        [[ -n "$hmodel" ]] && SR_MODEL="$hmodel"
        ;;
      cross-review)
        CR_ATTESTED=1
        [[ -n "$htool" ]] && CR_TOOL="$htool"
        [[ -n "$hmodel" ]] && CR_MODEL="$hmodel"
        ;;
      distill)
        DIST_ATTESTED=1
        [[ -n "$htool" ]] && DIST_TOOL="$htool"
        [[ -n "$hmodel" ]] && DIST_MODEL="$hmodel"
        ;;
      esac
      ;;
    approved)
      if [[ "$hstage" == "plan" ]]; then
        APPROVED=1
        case "$STATE" in
        planned) STATE="approved" ;;
        esac
      fi
      ;;
    created)
      if [[ "$hstage" == "plan" ]]; then
        case "$STATE" in
        planned | approved) ;;
        *) STATE="planned" ;;
        esac
      fi
      ;;
    started)
      case "$hstage" in
      implement) STATE="implementing" ;;
      self-review) STATE="self_reviewing" ;;
      cross-review) STATE="cross_reviewing" ;;
      distill) STATE="distilling" ;;
      esac
      ;;
    completed)
      case "$hstage" in
      plan)
        case "$STATE" in
        planned | approved) ;;
        *) STATE="planned" ;;
        esac
        ;;
      implement) STATE="implemented" ;;
      self-review) STATE="self_reviewed" ;;
      cross-review) STATE="cross_reviewed" ;;
      distill) STATE="distilled" ;;
      done) STATE="done" ;;
      esac
      ;;
    abandoned)
      STATE="abandoned"
      ;;
    esac

    # Self-report tools from non-attested history lines; track used tools for next-step.
    # Latest wins so a restarted stage (e.g. self-review re-run in another tool)
    # shows the tool that actually finished, matching attested overwrite semantics.
    if [[ -n "$htool" && "$haction" != "attested" ]]; then
      case "$hstage" in
      plan) PLAN_TOOL_SR="$htool" ;;
      implement) IMPL_TOOL_SR="$htool" ;;
      self-review) SR_TOOL_SR="$htool" ;;
      cross-review) CR_TOOL_SR="$htool" ;;
      distill) DIST_TOOL_SR="$htool" ;;
      esac
      case ",$USED_TOOLS," in
      *",$htool,"*) ;;
      *)
        if [[ -z "$USED_TOOLS" ]]; then
          USED_TOOLS="$htool"
        else
          USED_TOOLS="$USED_TOOLS,$htool"
        fi
        ;;
      esac
    fi
  done <"$hist"

  # Prefer attested tool; else latest self-report from history.
  if [[ "$PLAN_ATTESTED" -eq 0 ]]; then PLAN_TOOL="$PLAN_TOOL_SR"; fi
  if [[ "$IMPL_ATTESTED" -eq 0 ]]; then IMPL_TOOL="$IMPL_TOOL_SR"; fi
  if [[ "$SR_ATTESTED" -eq 0 ]]; then SR_TOOL="$SR_TOOL_SR"; fi
  if [[ "$CR_ATTESTED" -eq 0 ]]; then CR_TOOL="$CR_TOOL_SR"; fi
  if [[ "$DIST_ATTESTED" -eq 0 ]]; then DIST_TOOL="$DIST_TOOL_SR"; fi

  # Models from provenance when not attested (latest match for that stage).
  if [[ "$PLAN_ATTESTED" -eq 0 ]]; then
    PLAN_MODEL="$(extract_model_prov "$run_dir" plan)"
  fi
  if [[ "$IMPL_ATTESTED" -eq 0 ]]; then
    IMPL_MODEL="$(extract_model_prov "$run_dir" implement)"
  fi
  if [[ "$SR_ATTESTED" -eq 0 ]]; then
    SR_MODEL="$(extract_model_prov "$run_dir" self-review)"
  fi
  if [[ "$CR_ATTESTED" -eq 0 ]]; then
    CR_MODEL="$(extract_model_prov "$run_dir" cross-review)"
  fi
  if [[ "$DIST_ATTESTED" -eq 0 ]]; then
    DIST_MODEL="$(extract_model_prov "$run_dir" distill)"
  fi

  # Re-apply approve if we saw it (plan created after approve is rare).
  if [[ "$APPROVED" -eq 1 ]]; then
    case "$STATE" in
    planned) STATE="approved" ;;
    esac
  fi
}

extract_model_prov() {
  local run_dir="$1" want="$2"
  local f models="" line model
  for f in "$run_dir/plan.md" "$run_dir/implement-report.md" "$run_dir/review-report.md" "$run_dir/review-walkthrough.md"; do
    [[ -f "$f" ]] || continue
    while IFS= read -r line || [[ -n "$line" ]]; do
      case "$line" in
      *"relay: stage=${want}"*)
        model=""
        for tok in $line; do
          case "$tok" in
          model=*)
            model="${tok#model=}"
            model="${model%%-->*}"
            model="${model%%\"*}"
            model="${model%%\'*}"
            ;;
          esac
        done
        if [[ -n "$model" ]]; then
          models="$model"
        fi
        ;;
      esac
    done <"$f"
  done
  if [[ -d "$run_dir/distill" ]]; then
    for f in "$run_dir/distill"/*.md; do
      [[ -f "$f" ]] || continue
      while IFS= read -r line || [[ -n "$line" ]]; do
        case "$line" in
        *"relay: stage=${want}"*)
          model=""
          for tok in $line; do
            case "$tok" in
            model=*)
              model="${tok#model=}"
              model="${model%%-->*}"
              ;;
            esac
          done
          if [[ -n "$model" ]]; then
            models="$model"
          fi
          ;;
        esac
      done <"$f"
    done
  fi
  printf '%s\n' "$models"
}

next_step_for() {
  local state="$1"
  case "$state" in
  planned) printf 'atry approve <run> plan, then atry-implement\n' ;;
  approved) printf 'atry-implement\n' ;;
  implementing) printf 'implement in progress\n' ;;
  implemented) printf 'atry-self-review\n' ;;
  self_reviewing) printf 'self-review in progress\n' ;;
  self_reviewed)
    if [[ -n "$USED_TOOLS" ]]; then
      printf 'atry-cross-review (different tool; already used: %s) or atry close\n' "$USED_TOOLS"
    else
      printf 'atry-cross-review (different tool) or atry close\n'
    fi
    ;;
  cross_reviewing) printf 'cross-review in progress\n' ;;
  cross_reviewed) printf 'atry-distill or atry close\n' ;;
  distilling) printf 'distill in progress\n' ;;
  distilled) printf 'none (awaiting done completed)\n' ;;
  done | abandoned) printf 'none\n' ;;
  *) printf 'unknown\n' ;;
  esac
}

# Extract unfenced ### Open decisions bullets from the latest Self-Review
# and Cross-Review sections in review-report.md.
extract_open_decisions() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  awk '
    function fence_match(s,   indent, rest, i, ch, len) {
      indent = 0
      while (substr(s, indent + 1, 1) == " " || substr(s, indent + 1, 1) == "\t") indent++
      rest = substr(s, indent + 1)
      if (substr(rest, 1, 1) != "`" && substr(rest, 1, 1) != "~") return 0
      ch = substr(rest, 1, 1)
      len = 1
      while (substr(rest, len + 1, 1) == ch) len++
      if (len < 3) return 0
      fence_indent = indent
      fence_char = ch
      fence_len = len
      fence_rest = substr(rest, len + 1)
      return 1
    }
    BEGIN {
      fence = 0
      in_section = 0
      in_od = 0
      kind = ""
      # Buffers for latest section of each kind
      sr_n = 0
      cr_n = 0
    }
    {
      if (fence_match($0)) {
        if (!fence) {
          fence = 1
          open_indent = fence_indent
          open_char = fence_char
          open_len = fence_len
        } else if (fence_char == open_char && fence_len >= open_len && fence_indent <= open_indent && fence_rest ~ /^[ \t]*$/) {
          fence = 0
        }
      }
      if (!fence && $0 ~ /^## Self-Review — /) {
        in_section = 1
        kind = "sr"
        in_od = 0
        sr_n = 0
        next
      }
      if (!fence && $0 ~ /^## Cross-Review — /) {
        in_section = 1
        kind = "cr"
        in_od = 0
        cr_n = 0
        next
      }
      if (!fence && $0 ~ /^## /) {
        in_section = 0
        in_od = 0
        kind = ""
        next
      }
      if (!in_section || fence) next
      if ($0 ~ /^### Open decisions([[:space:]]|$)/) {
        in_od = 1
        next
      }
      if (in_od && $0 ~ /^### /) {
        in_od = 0
        next
      }
      if (in_od && $0 ~ /^- /) {
        if (kind == "sr") {
          sr_n++
          sr[sr_n] = $0
        } else if (kind == "cr") {
          cr_n++
          cr[cr_n] = $0
        }
      }
    }
    END {
      if (sr_n > 0) {
        print "open-decisions (Self-Review):"
        for (i = 1; i <= sr_n; i++) print sr[i]
      }
      if (cr_n > 0) {
        print "open-decisions (Cross-Review):"
        for (i = 1; i <= cr_n; i++) print cr[i]
      }
      if (sr_n == 0 && cr_n == 0) {
        print "open-decisions: (none)"
      }
    }
  ' "$file"
}

fmt_stage_line() {
  local label="$1" tool="$2" model="$3" attested="$4"
  local t_mark="" m_mark=""
  if [[ "$attested" -eq 1 ]]; then
    t_mark="*"
    m_mark="*"
  fi
  if [[ -z "$tool" ]]; then tool="-"; fi
  if [[ -z "$model" ]]; then model="-"; fi
  printf '  %-13s tool=%s%s  model=%s%s\n' "$label" "$tool" "$t_mark" "$model" "$m_mark"
}

print_list_line() {
  local run_dir="$1"
  local name stage status ts age next
  name="$(basename "$run_dir")"
  stage="$(meta_field "$run_dir/meta.md" stage)"
  status="$(meta_field "$run_dir/meta.md" status)"
  [[ -n "$stage" ]] || stage="?"
  [[ -n "$status" ]] || status="?"
  scan_history "$run_dir"
  ts="$(last_history_ts "$run_dir/history.log")"
  if [[ -n "$ts" ]]; then
    age="$(age_of "$ts")"
  else
    age="?"
  fi
  next="$(next_step_for "$STATE")"
  printf '%s  stage=%s  status=%s  age=%s  next: %s\n' "$name" "$stage" "$status" "$age" "$next"
}

print_detail() {
  local run_dir="$1"
  local name stage status
  name="$(basename "$run_dir")"
  stage="$(meta_field "$run_dir/meta.md" stage)"
  status="$(meta_field "$run_dir/meta.md" status)"
  scan_history "$run_dir"

  printf 'run: %s\n' "$name"
  printf 'meta: stage=%s status=%s\n' "${stage:-?}" "${status:-?}"
  printf 'plan approved: %s\n' "$([[ "$APPROVED" -eq 1 ]] && echo yes || echo no)"
  printf 'lifecycle: %s\n' "$STATE"
  printf 'stages:\n'
  fmt_stage_line "plan" "$PLAN_TOOL" "$PLAN_MODEL" "$PLAN_ATTESTED"
  fmt_stage_line "implement" "$IMPL_TOOL" "$IMPL_MODEL" "$IMPL_ATTESTED"
  fmt_stage_line "self-review" "$SR_TOOL" "$SR_MODEL" "$SR_ATTESTED"
  fmt_stage_line "cross-review" "$CR_TOOL" "$CR_MODEL" "$CR_ATTESTED"
  fmt_stage_line "distill" "$DIST_TOOL" "$DIST_MODEL" "$DIST_ATTESTED"

  # Independence warnings
  if [[ -n "$IMPL_TOOL" && -n "$CR_TOOL" && "$IMPL_TOOL" == "$CR_TOOL" ]]; then
    printf 'warning: implement tool == cross-review tool (%s)\n' "$IMPL_TOOL"
  fi
  if [[ -n "$SR_TOOL" && -n "$CR_TOOL" && "$SR_TOOL" == "$CR_TOOL" &&
    -n "$SR_MODEL" && -n "$CR_MODEL" && "$SR_MODEL" == "$CR_MODEL" ]]; then
    printf 'warning: self-review tool+model == cross-review tool+model (%s / %s)\n' "$SR_TOOL" "$SR_MODEL"
  fi

  extract_open_decisions "$run_dir/review-report.md"

  if [[ -f "$run_dir/decisions.md" ]]; then
    printf 'decisions.md:\n'
    # Indent each line for readability
    sed 's/^/  /' "$run_dir/decisions.md"
  else
    printf 'decisions.md: (none)\n'
  fi

  printf 'next: %s\n' "$(next_step_for "$STATE")"
}

# ---- main ----
BASE_DIR="$(find_base_dir)"
echo "atry: using $BASE_DIR" >&2

if [[ -n "$TARGET" ]]; then
  RUN_DIR="$("$RESOLVE_RUN" "$TARGET")"
  print_detail "$RUN_DIR"
  exit 0
fi

# Collect runs, newest first (dirname sorts by YMD then RUN_ID).
RUNS=()
while IFS= read -r d; do
  [[ -n "$d" ]] || continue
  RUNS+=("$d")
done < <(list_run_dirs "$BASE_DIR" | sort -r)

if [[ ${#RUNS[@]} -eq 0 ]]; then
  echo "Error: no run directory found in $BASE_DIR" >&2
  exit 1
fi

if [[ ${#RUNS[@]} -eq 1 ]]; then
  print_detail "${RUNS[0]}"
  exit 0
fi

for d in "${RUNS[@]}"; do
  print_list_line "$d"
done
