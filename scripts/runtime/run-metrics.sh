#!/usr/bin/env bash
# scripts/runtime/run-metrics.sh
# Compute deterministic benchmark metrics for an agent-relay run from files
# already on disk. Prints flat `key: value` lines (frontmatter-ready).
# Optional --write replaces those keys in a run note's first frontmatter block.
#
# Bash 3.2+ compatible, POSIX tools only. Never writes the git index
# (GIT_OPTIONAL_LOCKS=0). Exits non-zero only for an unresolvable run or an
# unreadable base; a missing stage artifact leaves only its keys empty.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESOLVE_RUN="$SCRIPT_DIR/resolve-run.sh"
# shellcheck source=scripts/runtime/diff-size.sh
source "$SCRIPT_DIR/diff-size.sh"

usage() {
  cat <<'EOF'
Usage:
  run-metrics.sh <run-dir-or-id> [--write <run-note>]

Print flat key: value metric lines for the resolved run (stdout).
With --write, also replace those keys inside the note's first YAML
frontmatter block; the body after the closing --- stays byte-identical.

Exit 0: metrics printed (and note updated when --write was given).
Exit 1: unresolvable run, unreadable base, or bad arguments.
EOF
  exit 1
}

WRITE_NOTE=""
TARGET=""
while [[ $# -gt 0 ]]; do
  case "$1" in
  --write)
    shift
    [[ $# -ge 1 ]] || {
      echo "Error: --write requires a path" >&2
      exit 1
    }
    WRITE_NOTE="$1"
    shift
    ;;
  -h | --help) usage ;;
  *)
    if [[ -z "$TARGET" ]]; then
      TARGET="$1"
      shift
    else
      echo "Error: unexpected argument '$1'" >&2
      usage
    fi
    ;;
  esac
done

[[ -n "$TARGET" ]] || usage

if [[ ! -x "$RESOLVE_RUN" && ! -f "$RESOLVE_RUN" ]]; then
  echo "Error: missing resolve-run helper at $RESOLVE_RUN" >&2
  exit 1
fi

RUN_DIR="$("$RESOLVE_RUN" "$TARGET")"
if [[ ! -d "$RUN_DIR" || "$(basename "$RUN_DIR")" == ".agent-relay" ]]; then
  echo "Error: run directory '$RUN_DIR' not found" >&2
  exit 1
fi

# ---- helpers (bash 3.2: no associative arrays) ----

iso_to_epoch() {
  local ts="$1" epoch
  # Prefer BSD date (macOS); fall back to GNU date -d.
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

# Append val to comma-separated list if not already present. Echoes new list.
csv_append_unique() {
  local list="$1"
  local val="$2"
  local part
  [[ -n "$val" ]] || {
    printf '%s\n' "$list"
    return 0
  }
  if [[ -z "$list" ]]; then
    printf '%s\n' "$val"
    return 0
  fi
  oldIFS="$IFS"
  IFS=','
  # shellcheck disable=SC2086
  set -- $list
  IFS="$oldIFS"
  for part in "$@"; do
    if [[ "$part" == "$val" ]]; then
      printf '%s\n' "$list"
      return 0
    fi
  done
  printf '%s\n' "$list,$val"
}

find_git_root() {
  local d="$1"
  while [[ "$d" != "/" ]]; do
    if [[ -d "$d/.git" || -f "$d/.git" ]]; then
      printf '%s\n' "$d"
      return 0
    fi
    d="$(dirname "$d")"
  done
  return 1
}

read_base_ref() {
  local f val
  for f in "$RUN_DIR/plan.md" "$RUN_DIR/meta.md"; do
    [[ -f "$f" ]] || continue
    val="$(sed -n 's/^base:[[:space:]]*//p' "$f" | head -n 1 | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    if [[ -n "$val" ]]; then
      printf '%s\n' "$val"
      return 0
    fi
  done
  return 1
}

# Metric key names (order used for stdout and --write inserts).
METRIC_KEYS="dur_implement_min dur_self_review_min dur_cross_review_min dur_distill_min tool_implement tool_self_review tool_cross_review tool_distill model_implement model_self_review model_cross_review model_distill model_source diff_base diff_end files_changed lines_added lines_deleted tasks_planned tasks_implemented review_findings review_rounds tokens cost"

# Values stored as METRIC_VAL_<key> (keys use only [a-z_]). Use printf -v so
# values with quotes/spaces do not break an eval assignment.
metric_set() {
  local key="$1"
  local val="$2"
  # shellcheck disable=SC2086
  printf -v "METRIC_VAL_${key}" '%s' "$val"
}

metric_get() {
  local key="$1"
  local var="METRIC_VAL_${key}"
  eval "printf '%s\\n' \"\${$var-}\""
}

for _k in $METRIC_KEYS; do
  metric_set "$_k" ""
done
metric_set model_source "self-reported"

# ---- duration + tools from history.log ----
# Stage names in history use hyphens; metric key suffixes use underscores.

HISTORY="$RUN_DIR/history.log"

stage_to_key() {
  case "$1" in
  implement) printf 'implement\n' ;;
  self-review) printf 'self_review\n' ;;
  cross-review) printf 'cross_review\n' ;;
  distill) printf 'distill\n' ;;
  *) return 1 ;;
  esac
}

for _s in implement self_review cross_review distill; do
  eval "STAGE_START_${_s}="
  eval "STAGE_SECS_${_s}=0"
  eval "STAGE_HADPAIR_${_s}=0"
  eval "STAGE_TOOLS_${_s}="
  eval "STAGE_ATTESTED_TOOL_${_s}="
  eval "STAGE_ATTESTED_MODEL_${_s}="
  eval "STAGE_HAD_ATTEST_${_s}=0"
done

REVIEW_ROUNDS=0
# First `head=` recorded on an `implement started` line (see run-history.sh).
IMPL_HEAD=""
# Last `head=` on implement / self-review / cross-review `completed` (END for sizing).
DIFF_END_SHA=""
# Last `size=` snapshot (and the diff base it was measured from) on those events.
SNAP_SIZE=""
SNAP_BASE=""

if [[ -f "$HISTORY" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -n "$line" ]] || continue
    # Expect: <ISO> stage=<stage> action=<action> [k=v ...]
    case "$line" in
    *" stage="*) ;;
    *) continue ;;
    esac
    ts="${line%% *}"
    rest="${line#* }"
    stage=""
    action=""
    tool=""
    model=""
    head=""
    size=""
    size_base=""
    for tok in $rest; do
      case "$tok" in
      stage=*) stage="${tok#stage=}" ;;
      action=*) action="${tok#action=}" ;;
      tool=*) tool="${tok#tool=}" ;;
      model=*) model="${tok#model=}" ;;
      head=*) head="${tok#head=}" ;;
      size=*) size="${tok#size=}" ;;
      size_base=*) size_base="${tok#size_base=}" ;;
      esac
    done
    [[ -n "$stage" && -n "$action" ]] || continue

    if [[ "$stage" == "implement" && "$action" == "started" && -n "$head" && -z "$IMPL_HEAD" ]]; then
      IMPL_HEAD="$head"
    fi
    if [[ "$action" == "completed" && -n "$head" ]]; then
      case "$stage" in
      implement | self-review | cross-review) DIFF_END_SHA="$head" ;;
      esac
    fi
    if [[ "$action" == "completed" && -n "$size" && -n "$size_base" ]]; then
      case "$stage" in
      implement | self-review | cross-review)
        SNAP_SIZE="$size"
        SNAP_BASE="$size_base"
        ;;
      esac
    fi

    sk=""
    sk="$(stage_to_key "$stage")" || true

    # Latest human attestation wins for tool/model when present.
    if [[ "$action" == "attested" && -n "$sk" ]]; then
      eval "STAGE_HAD_ATTEST_${sk}=1"
      if [[ -n "$tool" ]]; then
        printf -v "STAGE_ATTESTED_TOOL_${sk}" '%s' "$tool"
      fi
      if [[ -n "$model" ]]; then
        printf -v "STAGE_ATTESTED_MODEL_${sk}" '%s' "$model"
      fi
    fi

    [[ -n "$sk" ]] || continue

    if [[ -n "$tool" && "$action" != "attested" ]]; then
      cur=""
      eval "cur=\"\$STAGE_TOOLS_${sk}\""
      cur="$(csv_append_unique "$cur" "$tool")"
      printf -v "STAGE_TOOLS_${sk}" '%s' "$cur"
    fi

    case "$action" in
    started)
      epoch=""
      if epoch="$(iso_to_epoch "$ts")"; then
        eval "STAGE_START_${sk}=\"\$epoch\""
      fi
      ;;
    completed)
      start=""
      eval "start=\"\$STAGE_START_${sk}\""
      if [[ -n "$start" ]]; then
        end=""
        if end="$(iso_to_epoch "$ts")"; then
          if [[ "$end" -ge "$start" ]]; then
            delta=$((end - start))
            secs=0
            eval "secs=\"\$STAGE_SECS_${sk}\""
            secs=$((secs + delta))
            eval "STAGE_SECS_${sk}=$secs"
            eval "STAGE_HADPAIR_${sk}=1"
          fi
        fi
        eval "STAGE_START_${sk}="
        # A review round is a completed event that closes a started one;
        # a repeated `completed` without a new `started` is not a new round.
        case "$sk" in
        self_review | cross_review) REVIEW_ROUNDS=$((REVIEW_ROUNDS + 1)) ;;
        esac
      fi
      ;;
    esac
  done <"$HISTORY"
fi

for sk in implement self_review cross_review distill; do
  had=0
  eval "had=\"\$STAGE_HADPAIR_${sk}\""
  if [[ "$had" -eq 1 ]]; then
    secs=0
    eval "secs=\"\$STAGE_SECS_${sk}\""
    metric_set "dur_${sk}_min" "$((secs / 60))"
  else
    metric_set "dur_${sk}_min" ""
  fi
  tools=""
  attested=0
  eval "attested=\"\$STAGE_HAD_ATTEST_${sk}\""
  if [[ "$attested" -eq 1 ]]; then
    eval "tools=\"\$STAGE_ATTESTED_TOOL_${sk}\""
  else
    eval "tools=\"\$STAGE_TOOLS_${sk}\""
  fi
  metric_set "tool_${sk}" "$tools"
done

metric_set review_rounds "$REVIEW_ROUNDS"

# ---- models from provenance comments ----
# Scan known run artifacts for <!-- relay: stage=<hyphen-stage> ... model=... -->

extract_models_from_file() {
  local file="$1"
  local want_stage="$2" # hyphen form
  local models="" line
  [[ -f "$file" ]] || {
    printf '%s\n' ""
    return 0
  }
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
    *"relay: stage=${want_stage}"*)
      # Pull model= token from the comment
      model=""
      # Normalize: take content after stage=...
      for tok in $line; do
        case "$tok" in
        model=* | model=*/ | model=*--\>)
          model="${tok#model=}"
          model="${model%%-->*}"
          model="${model%%\"*}"
          model="${model%%\'*}"
          ;;
        esac
      done
      if [[ -n "$model" ]]; then
        models="$(csv_append_unique "$models" "$model")"
      fi
      ;;
    esac
  done <"$file"
  printf '%s\n' "$models"
}

merge_models() {
  local acc="$1"
  local add="$2"
  local part
  [[ -n "$add" ]] || {
    printf '%s\n' "$acc"
    return 0
  }
  oldIFS="$IFS"
  IFS=','
  # shellcheck disable=SC2086
  set -- $add
  IFS="$oldIFS"
  for part in "$@"; do
    acc="$(csv_append_unique "$acc" "$part")"
  done
  printf '%s\n' "$acc"
}

collect_model() {
  local hyphen_stage="$1"
  local acc="" m
  m="$(extract_models_from_file "$RUN_DIR/plan.md" "$hyphen_stage")"
  acc="$(merge_models "$acc" "$m")"
  m="$(extract_models_from_file "$RUN_DIR/implement-report.md" "$hyphen_stage")"
  acc="$(merge_models "$acc" "$m")"
  if [[ -d "$RUN_DIR/implement-report" ]]; then
    local f
    for f in "$RUN_DIR/implement-report"/*.md; do
      [[ -f "$f" ]] || continue
      m="$(extract_models_from_file "$f" "$hyphen_stage")"
      acc="$(merge_models "$acc" "$m")"
    done
  fi
  m="$(extract_models_from_file "$RUN_DIR/review-report.md" "$hyphen_stage")"
  acc="$(merge_models "$acc" "$m")"
  m="$(extract_models_from_file "$RUN_DIR/review-walkthrough.md" "$hyphen_stage")"
  acc="$(merge_models "$acc" "$m")"
  if [[ -d "$RUN_DIR/distill" ]]; then
    for f in "$RUN_DIR/distill"/*.md; do
      [[ -f "$f" ]] || continue
      m="$(extract_models_from_file "$f" "$hyphen_stage")"
      acc="$(merge_models "$acc" "$m")"
    done
  fi
  printf '%s\n' "$acc"
}

metric_set model_implement "$(collect_model implement)"
metric_set model_self_review "$(collect_model self-review)"
metric_set model_cross_review "$(collect_model cross-review)"
metric_set model_distill "$(collect_model distill)"

# Prefer latest attested model= over provenance self-report when present.
ATTESTED_MEASURED=0
MEASURED_STAGES=0
for sk in implement self_review cross_review distill; do
  attested=0
  eval "attested=\"\$STAGE_HAD_ATTEST_${sk}\""
  if [[ "$attested" -eq 1 ]]; then
    amodel=""
    eval "amodel=\"\$STAGE_ATTESTED_MODEL_${sk}\""
    if [[ -n "$amodel" ]]; then
      metric_set "model_${sk}" "$amodel"
    fi
  fi
  # A stage "counts" toward model_source when it has a tool or model value.
  tval="$(metric_get "tool_${sk}")"
  mval="$(metric_get "model_${sk}")"
  if [[ -n "$tval" || -n "$mval" ]]; then
    MEASURED_STAGES=$((MEASURED_STAGES + 1))
    if [[ "$attested" -eq 1 ]]; then
      ATTESTED_MEASURED=$((ATTESTED_MEASURED + 1))
    fi
  fi
done

if [[ "$MEASURED_STAGES" -eq 0 || "$ATTESTED_MEASURED" -eq 0 ]]; then
  metric_set model_source "self-reported"
elif [[ "$ATTESTED_MEASURED" -eq "$MEASURED_STAGES" ]]; then
  metric_set model_source "human-attested"
else
  metric_set model_source "mixed"
fi

# ---- git change size ----
BASE_REF=""
if ! BASE_REF="$(read_base_ref)"; then
  echo "Error: no base: ref in plan.md or meta.md" >&2
  exit 1
fi

GIT_ROOT=""
if ! GIT_ROOT="$(find_git_root "$RUN_DIR")"; then
  echo "Error: no git repository above run directory $RUN_DIR" >&2
  exit 1
fi

if ! GIT_OPTIONAL_LOCKS=0 git -C "$GIT_ROOT" rev-parse --verify "${BASE_REF}^{commit}" >/dev/null 2>&1; then
  echo "Error: unreadable base '$BASE_REF' in $GIT_ROOT" >&2
  exit 1
fi

# Prefer the commit implement started from (history `head=`): several chained
# plans can share one `base:`, and diffing from it would count earlier runs'
# changes too. Fall back to the plan's base when absent or unreadable.
DIFF_BASE="$BASE_REF"
if [[ -n "$IMPL_HEAD" ]] && GIT_OPTIONAL_LOCKS=0 git -C "$GIT_ROOT" rev-parse --verify "${IMPL_HEAD}^{commit}" >/dev/null 2>&1; then
  DIFF_BASE="$IMPL_HEAD"
fi
metric_set diff_base "$DIFF_BASE"

# Resolve END: last completed head= among implement / self-review / cross-review.
# Four cases (see docs/metrics.md):
# 1. END present, END != DIFF_BASE → commit-range diff (later commits excluded)
# 2. END present, END == DIFF_BASE, HEAD == END → working-tree (change never committed)
# 3. END present, END == DIFF_BASE, HEAD moved → unknowable; empty sizes + warn
# 4. No END → working-tree + warn (legacy runs)
END_OK=0
if [[ -n "$DIFF_END_SHA" ]] && GIT_OPTIONAL_LOCKS=0 git -C "$GIT_ROOT" rev-parse --verify "${DIFF_END_SHA}^{commit}" >/dev/null 2>&1; then
  END_OK=1
fi

CURRENT_HEAD=""
CURRENT_HEAD="$(GIT_OPTIONAL_LOCKS=0 git -C "$GIT_ROOT" rev-parse --verify HEAD 2>/dev/null || true)"

# Preferred: the last size= snapshot that `atry history append` took when a
# stage completed, if it was measured from this same diff base. It does not
# depend on when the work is committed afterwards. Otherwise fall back to the
# four END cases.
DIFF_BASE_SHA="$(GIT_OPTIONAL_LOCKS=0 git -C "$GIT_ROOT" rev-parse --verify "${DIFF_BASE}^{commit}" 2>/dev/null || true)"
SNAP_OK=0
if [[ -n "$SNAP_SIZE" && -n "$DIFF_BASE_SHA" && "$SNAP_BASE" == "$DIFF_BASE_SHA" && "$SNAP_SIZE" =~ ^[0-9]+/[0-9]+/[0-9]+$ ]]; then
  SNAP_OK=1
fi

DIFF_MODE="" # snapshot | range | worktree | empty
DIFF_END_VAL=""
if [[ "$SNAP_OK" -eq 1 ]]; then
  DIFF_MODE="snapshot"
  DIFF_END_VAL="snapshot"
elif [[ "$END_OK" -eq 1 && "$DIFF_END_SHA" != "${DIFF_BASE_SHA:-$DIFF_BASE}" ]]; then
  DIFF_MODE="range"
  DIFF_END_VAL="$DIFF_END_SHA"
elif [[ "$END_OK" -eq 1 && -n "$CURRENT_HEAD" && "$CURRENT_HEAD" == "$DIFF_END_SHA" ]]; then
  DIFF_MODE="worktree"
  DIFF_END_VAL="worktree"
elif [[ "$END_OK" -eq 1 ]]; then
  DIFF_MODE="empty"
  DIFF_END_VAL=""
  echo "run-metrics: warning: change size is unknowable (END equals diff_base but HEAD has moved, and no size= snapshot); leaving files_changed/lines_* empty" >&2
else
  DIFF_MODE="worktree"
  DIFF_END_VAL="worktree"
  echo "run-metrics: warning: no size= snapshot or END head= on implement/self-review/cross-review completed; size is measured to the current tree" >&2
fi
metric_set diff_end "$DIFF_END_VAL"

FILES_CHANGED=""
LINES_ADDED=""
LINES_DELETED=""
case "$DIFF_MODE" in
snapshot)
  FILES_CHANGED="${SNAP_SIZE%%/*}"
  _rest="${SNAP_SIZE#*/}"
  LINES_ADDED="${_rest%%/*}"
  LINES_DELETED="${_rest#*/}"
  ;;
range) read -r FILES_CHANGED LINES_ADDED LINES_DELETED <<<"$(diff_size "$GIT_ROOT" "$DIFF_BASE" "$DIFF_END_SHA")" ;;
worktree) read -r FILES_CHANGED LINES_ADDED LINES_DELETED <<<"$(diff_size "$GIT_ROOT" "$DIFF_BASE")" ;;
esac

metric_set files_changed "$FILES_CHANGED"
metric_set lines_added "$LINES_ADDED"
metric_set lines_deleted "$LINES_DELETED"

# ---- tasks_planned from plan.md ## Tasks ----
TASKS_PLANNED=0
if [[ -f "$RUN_DIR/plan.md" ]]; then
  in_tasks=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^##[[:space:]]+Tasks([[:space:]]|$) ]]; then
      in_tasks=1
      continue
    elif [[ "$line" =~ ^##[[:space:]]+ && "$in_tasks" -eq 1 ]]; then
      in_tasks=0
    fi
    [[ "$in_tasks" -eq 1 ]] || continue
    if [[ "$line" =~ ^[0-9]+\.[[:space:]]+ ]]; then
      TASKS_PLANNED=$((TASKS_PLANNED + 1))
    elif [[ "$line" =~ ^-[[:space:]]*\[[^]]*\][[:space:]]*[^:]+: ]]; then
      TASKS_PLANNED=$((TASKS_PLANNED + 1))
    fi
  done <"$RUN_DIR/plan.md"
fi
metric_set tasks_planned "$TASKS_PLANNED"

# ---- tasks_implemented from implement-plan (dir preferred over file) ----
TASKS_IMPLEMENTED=0
if [[ -d "$RUN_DIR/implement-plan" ]]; then
  for f in "$RUN_DIR/implement-plan"/*.status; do
    [[ -f "$f" ]] || continue
    TASKS_IMPLEMENTED=$((TASKS_IMPLEMENTED + 1))
  done
elif [[ -f "$RUN_DIR/implement-plan.md" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^-[[:space:]]*\[[^]]*\][[:space:]]*[^:]+: ]]; then
      TASKS_IMPLEMENTED=$((TASKS_IMPLEMENTED + 1))
    fi
  done <"$RUN_DIR/implement-plan.md"
fi
metric_set tasks_implemented "$TASKS_IMPLEMENTED"

# ---- review_findings from every ### Issues found ----
REVIEW_FINDINGS=0
if [[ -f "$RUN_DIR/review-report.md" ]]; then
  in_issues=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^###[[:space:]]+Issues[[:space:]]+found([[:space:]]|$) ]]; then
      in_issues=1
      continue
    fi
    if [[ "$in_issues" -eq 1 ]]; then
      if [[ "$line" =~ ^## ]] || [[ "$line" =~ ^### ]]; then
        in_issues=0
        # Re-check if this line opens another Issues found
        if [[ "$line" =~ ^###[[:space:]]+Issues[[:space:]]+found([[:space:]]|$) ]]; then
          in_issues=1
        fi
        continue
      fi
      if [[ "$line" =~ ^-[[:space:]]+ ]]; then
        text="$(printf '%s' "$line" | sed -e 's/^-[[:space:]]*//' -e 's/[[:space:]]*$//')"
        # Skip placeholder "none"
        case "$(printf '%s' "$text" | tr '[:upper:]' '[:lower:]')" in
        none | none. | "") ;;
        *) REVIEW_FINDINGS=$((REVIEW_FINDINGS + 1)) ;;
        esac
      fi
    fi
  done <"$RUN_DIR/review-report.md"
fi
metric_set review_findings "$REVIEW_FINDINGS"

# tokens / cost always empty (already set)

# ---- emit ----
emit_metrics() {
  local k
  for k in $METRIC_KEYS; do
    printf '%s: %s\n' "$k" "$(metric_get "$k")"
  done
}

emit_metrics

# ---- optional --write ----
if [[ -z "$WRITE_NOTE" ]]; then
  exit 0
fi

if [[ ! -f "$WRITE_NOTE" ]]; then
  echo "Error: --write target not found: $WRITE_NOTE" >&2
  exit 1
fi

if [[ "$(head -1 "$WRITE_NOTE")" != "---" ]]; then
  echo "Error: --write note frontmatter must open with --- on line 1: $WRITE_NOTE" >&2
  exit 1
fi

# Build a temp file of key=value for awk (avoid huge ENVIRON / bash 4 assoc).
KV_FILE="$(mktemp "${TMPDIR:-/tmp}/ar-metrics-kv.XXXXXX")"
KEYS_FILE="$(mktemp "${TMPDIR:-/tmp}/ar-metrics-keys.XXXXXX")"
cleanup_kv() { rm -f "$KV_FILE" "$KEYS_FILE"; }
trap cleanup_kv EXIT

for k in $METRIC_KEYS; do
  printf '%s\n' "$k" >>"$KEYS_FILE"
  # Encode as key<TAB>value (value may be empty)
  printf '%s\t%s\n' "$k" "$(metric_get "$k")" >>"$KV_FILE"
done

tmp="$(mktemp "${TMPDIR:-/tmp}/ar-metrics-note.XXXXXX")"
WRITE_NOTE="$WRITE_NOTE" KV_FILE="$KV_FILE" KEYS_FILE="$KEYS_FILE" awk '
  BEGIN {
    note = ENVIRON["WRITE_NOTE"]
    kv = ENVIRON["KV_FILE"]
    keys = ENVIRON["KEYS_FILE"]
    while ((getline line < kv) > 0) {
      split(line, a, "\t")
      k = a[1]
      v = substr(line, length(k) + 2)
      val[k] = v
      known[k] = 1
    }
    close(kv)
    nkeys = 0
    while ((getline line < keys) > 0) {
      nkeys++
      keyorder[nkeys] = line
    }
    close(keys)
  }
  {
    if (done) { print; next }
    if ($0 ~ /^---[[:space:]]*$/) {
      c++
      if (c == 2) {
        # Insert any metric keys not already present, in canonical order.
        for (i = 1; i <= nkeys; i++) {
          k = keyorder[i]
          if (!seen[k]) {
            print k ": " val[k]
            seen[k] = 1
          }
        }
        print
        done = 1
        next
      }
      print
      next
    }
    if (c == 1) {
      # Replace value when key is one we own.
      if (match($0, /^[A-Za-z0-9_]+:/)) {
        k = substr($0, 1, RLENGTH - 1)
        if (known[k]) {
          print k ": " val[k]
          seen[k] = 1
          next
        }
      }
      print
      next
    }
    print
  }
  END {
    if (c < 2) {
      print "Error: note missing closing frontmatter delimiter" > "/dev/stderr"
      exit 1
    }
  }
' "$WRITE_NOTE" >"$tmp"

# Verify body after second --- is unchanged.
body_orig="$(awk 'BEGIN{c=0} /^---[[:space:]]*$/{c++; if(c==2){s=1; next}} s{print}' "$WRITE_NOTE")"
body_new="$(awk 'BEGIN{c=0} /^---[[:space:]]*$/{c++; if(c==2){s=1; next}} s{print}' "$tmp")"
if [[ "$body_orig" != "$body_new" ]]; then
  echo "Error: internal: body changed while writing metrics (refusing write)" >&2
  rm -f "$tmp"
  exit 1
fi

cat "$tmp" >"$WRITE_NOTE"
rm -f "$tmp"
echo "run-metrics: wrote metrics into $WRITE_NOTE" >&2
