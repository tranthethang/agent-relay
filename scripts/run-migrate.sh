#!/usr/bin/env bash
# scripts/run-migrate.sh
# Migrate legacy flat .agent-relay files into .agent-relay/{YMD}_{RUN_ID}/
# Bash 3.2+ compatible, POSIX tools only.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  run-migrate.sh <RUN_ID>
EOF
  exit 1
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
  # Fallback: relative .agent-relay under cwd
  printf '%s\n' ".agent-relay"
}

if [[ $# -lt 1 ]]; then
  usage
fi

ID="$1"

# Validate ID
case "$ID" in
  *[!A-Za-z0-9._-]*|"")
    echo "Error: invalid RUN_ID '$ID'" >&2
    exit 1
    ;;
esac

BASE_DIR="$(find_base_dir)"
if [[ ! -d "$BASE_DIR" ]]; then
  echo "Error: .agent-relay directory not found" >&2
  exit 1
fi

PLAN_LEGACY="$BASE_DIR/plan-$ID.md"
IMP_PLAN_LEGACY="$BASE_DIR/implement-plan-$ID.md"
IMP_PLAN_DIR_LEGACY="$BASE_DIR/implement-plan-$ID"
IMP_REP_LEGACY="$BASE_DIR/implement-report-$ID.md"
IMP_REP_DIR_LEGACY="$BASE_DIR/implement-report-$ID"
REV_REP_LEGACY="$BASE_DIR/review-report-$ID.md"
REV_WALK_LEGACY="$BASE_DIR/review-walkthrough-$ID.md"

found=0
for f in "$PLAN_LEGACY" "$IMP_PLAN_LEGACY" "$IMP_PLAN_DIR_LEGACY" "$IMP_REP_LEGACY" "$IMP_REP_DIR_LEGACY" "$REV_REP_LEGACY" "$REV_WALK_LEGACY"; do
  if [[ -e "$f" ]]; then
    found=1
    break
  fi
done

if [[ "$found" -eq 0 ]]; then
  echo "Error: no legacy files found for id '$ID' in $BASE_DIR" >&2
  exit 1
fi

# Derive YMD
YMD=""
if [[ -f "$PLAN_LEGACY" ]]; then
  # Try finding date=YYYY-MM-DD in provenance
  prov_date="$(sed -n 's/.*date=\([0-9]\{4\}\)-\([0-9]\{2\}\)-\([0-9]\{2\}\).*/\1\2\3/p' "$PLAN_LEGACY" | head -n 1)"
  if [[ -n "$prov_date" ]]; then
    YMD="$prov_date"
  fi
fi

if [[ -z "$YMD" ]]; then
  # Fall back to file modification date or current date
  target_for_mtime="$PLAN_LEGACY"
  [[ -f "$target_for_mtime" ]] || target_for_mtime="$IMP_PLAN_LEGACY"
  if [[ -f "$target_for_mtime" ]]; then
    # Try BSD stat then GNU stat
    mtime="$(stat -f "%Sm" -t "%Y%m%d" "$target_for_mtime" 2>/dev/null || true)"
    if [[ -z "$mtime" ]]; then
      mtime="$(stat -c "%y" "$target_for_mtime" 2>/dev/null | cut -c 1-10 | tr -d '-' || true)"
    fi
    if [[ "$mtime" =~ ^[0-9]{8}$ ]]; then
      YMD="$mtime"
    fi
  fi
fi

if [[ -z "$YMD" ]]; then
  YMD="$(date +%Y%m%d)"
fi

RUN_DIR="$BASE_DIR/${YMD}_${ID}"
mkdir -p "$RUN_DIR"

# Move files to short names inside RUN_DIR
if [[ -f "$PLAN_LEGACY" ]]; then
  mv "$PLAN_LEGACY" "$RUN_DIR/plan.md"
fi
if [[ -f "$IMP_PLAN_LEGACY" ]]; then
  mv "$IMP_PLAN_LEGACY" "$RUN_DIR/implement-plan.md"
fi
if [[ -d "$IMP_PLAN_DIR_LEGACY" ]]; then
  mv "$IMP_PLAN_DIR_LEGACY" "$RUN_DIR/implement-plan"
fi
if [[ -f "$IMP_REP_LEGACY" ]]; then
  mv "$IMP_REP_LEGACY" "$RUN_DIR/implement-report.md"
fi
if [[ -d "$IMP_REP_DIR_LEGACY" ]]; then
  mv "$IMP_REP_DIR_LEGACY" "$RUN_DIR/implement-report"
fi
if [[ -f "$REV_REP_LEGACY" ]]; then
  mv "$REV_REP_LEGACY" "$RUN_DIR/review-report.md"
fi
if [[ -f "$REV_WALK_LEGACY" ]]; then
  mv "$REV_WALK_LEGACY" "$RUN_DIR/review-walkthrough.md"
fi

# Clean up CURRENT if it points to ID
if [[ -f "$BASE_DIR/CURRENT" ]]; then
  current_id="$(tr -d '[:space:]' < "$BASE_DIR/CURRENT")"
  if [[ "$current_id" == "$ID" ]]; then
    rm -f "$BASE_DIR/CURRENT"
  fi
fi

# Create meta.md if not exists
if [[ ! -f "$RUN_DIR/meta.md" ]]; then
  base_ref="unknown"
  title="(migrated run $ID)"
  if [[ -f "$RUN_DIR/plan.md" ]]; then
    parsed_base="$(sed -n 's/^base:[[:space:]]*//p' "$RUN_DIR/plan.md" | head -n 1)"
    if [[ -n "$parsed_base" ]]; then
      base_ref="$parsed_base"
    fi
    parsed_title="$(sed -n 's/^#[[:space:]]*//p' "$RUN_DIR/plan.md" | head -n 1)"
    if [[ -n "$parsed_title" ]]; then
      title="$parsed_title"
    fi
  fi

  stage="plan"
  if [[ -f "$RUN_DIR/review-report.md" || -f "$RUN_DIR/review-walkthrough.md" ]]; then
    if grep -q '## Cross-Review' "$RUN_DIR/review-report.md" 2>/dev/null; then
      stage="cross-review"
    else
      stage="self-review"
    fi
  elif [[ -f "$RUN_DIR/implement-report.md" || -d "$RUN_DIR/implement-report" ]]; then
    stage="self-review"
  elif [[ -f "$RUN_DIR/implement-plan.md" || -d "$RUN_DIR/implement-plan" ]]; then
    stage="implement"
  fi

  created_date="${YMD:0:4}-${YMD:4:2}-${YMD:6:2}"
  cat <<EOF > "$RUN_DIR/meta.md"
id: $ID
created: $created_date
title: $title
stage: $stage
status: active
base: $base_ref
EOF
fi

if [[ ! -f "$RUN_DIR/history.log" ]]; then
  NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '%s stage=migrate action=migrated from=flat\n' "$NOW_ISO" > "$RUN_DIR/history.log"
fi

abs_run_dir="$(cd "$RUN_DIR" && pwd -P)"
printf '%s\n' "$abs_run_dir"
