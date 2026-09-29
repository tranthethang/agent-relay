#!/usr/bin/env bash
# Offline checks for atry metrics (scripts/runtime/run-metrics.sh).
# Run from repo root:
#   ./tests/metrics.sh
#   make metrics
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ATRY="$ROOT/scripts/atry"
METRICS_SH="$ROOT/scripts/runtime/run-metrics.sh"

FAIL=0
pass() { echo "PASS: $1"; }
fail() {
  echo "FAIL: $1"
  FAIL=1
}

T="$(mktemp -d "${TMPDIR:-/tmp}/ar-metrics.XXXXXX")"
GIT_STATUS_BEFORE=""
if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  GIT_STATUS_BEFORE="$(git -C "$ROOT" status --porcelain)"
fi
cleanup() {
  local rc=$?
  rm -rf "$T"
  if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    local after
    after="$(git -C "$ROOT" status --porcelain)"
    if [[ "$after" != "$GIT_STATUS_BEFORE" ]]; then
      echo "FAIL: suite mutated git working tree under $ROOT" >&2
      printf 'before:\n%s\nafter:\n%s\n' "$GIT_STATUS_BEFORE" "$after" >&2
      rc=1
    fi
  fi
  exit "$rc"
}
trap cleanup EXIT

field() {
  # field <blob-or-file> <key> — extract "key: value" line value
  local src="$1" key="$2"
  if [[ -f "$src" ]]; then
    sed -n "s/^${key}:[[:space:]]*//p" "$src" | head -1
  else
    printf '%s\n' "$src" | sed -n "s/^${key}:[[:space:]]*//p" | head -1
  fi
}

# --- static: bash 3.2 compatibility ---
if grep -q 'declare -A' "$METRICS_SH"; then
  fail "run-metrics.sh contains declare -A (bash 4+ feature)"
else
  pass "run-metrics.sh does not use declare -A"
fi

# --- shared fixture repo ---
# Hermetic commit identity: CI runners (and fresh machines) have no git user.
export GIT_AUTHOR_NAME="atry-test" GIT_AUTHOR_EMAIL="atry-test@example.invalid"
export GIT_COMMITTER_NAME="atry-test" GIT_COMMITTER_EMAIL="atry-test@example.invalid"
REPO="$T/repo"
mkdir -p "$REPO"
(
  cd "$REPO"
  git init -q
  echo "base-content" >file.txt
  git add file.txt
  git commit -qm "init"
)
BASE="$(git -C "$REPO" rev-parse HEAD)"
AR="$REPO/.agent-relay"
mkdir -p "$AR"

# Append a line to file.txt so numstat is non-empty against BASE.
echo "changed" >>"$REPO/file.txt"

new_run() {
  # new_run <run-id> <slug> → sets RUN to absolute path
  local id="$1" slug="$2"
  RUN="$AR/20260927-${id}-${slug}"
  mkdir -p "$RUN"
  cat >"$RUN/meta.md" <<EOF
id: $id
slug: $slug
created: 2026-09-27
title: metrics fixture $slug
stage: distill
status: active
base: $BASE
EOF
  cat >"$RUN/plan.md" <<EOF
base: $BASE
id: $id

# Fixture $slug

<!-- relay: stage=plan tool=cursor model=plan-model base=$BASE date=2026-09-27 -->

## Tasks

1. First task (deps: )
2. Second task (deps: T1)
EOF
}

write_complete_history() {
  local run="$1"
  cat >"$run/history.log" <<'EOF'
2026-09-27T10:00:00Z stage=plan action=created tool=cursor
2026-09-27T10:10:00Z stage=implement action=started tool=cursor
2026-09-27T10:40:00Z stage=implement action=completed tool=cursor
2026-09-27T10:41:00Z stage=self-review action=started tool=cursor
2026-09-27T10:51:00Z stage=self-review action=completed tool=cursor
2026-09-27T11:00:00Z stage=cross-review action=started tool=claude
2026-09-27T11:20:00Z stage=cross-review action=completed tool=claude
2026-09-27T11:21:00Z stage=distill action=started tool=cursor
2026-09-27T11:31:00Z stage=distill action=completed tool=cursor
EOF
}

write_reviews() {
  local run="$1"
  cat >"$run/review-report.md" <<'EOF'
## Self-Review — 2026-09-27

<!-- relay: stage=self-review tool=cursor model=sr-model base=x date=2026-09-27 -->

### Issues found

- Finding one
- none

### Fixed

- none

## Cross-Review — 2026-09-27

<!-- relay: stage=cross-review tool=claude model=cr-model base=x date=2026-09-27 -->

### Issues found

- Finding two

### Fixed

- none
EOF
}

write_implement_file_form() {
  local run="$1"
  cat >"$run/implement-plan.md" <<'EOF'
# implement-plan

- [done] T1: First task
- [done] T2: Second task
EOF
  cat >"$run/implement-report.md" <<'EOF'
<!-- relay: stage=implement tool=cursor model=impl-model base=x date=2026-09-27 -->

## T1 — First task

done
EOF
}

write_implement_parallel() {
  local run="$1"
  mkdir -p "$run/implement-plan" "$run/implement-report"
  printf 'status: done\ndesc: First task\ndeps: \n' >"$run/implement-plan/T1.status"
  printf 'status: done\ndesc: Second task\ndeps: T1\n' >"$run/implement-plan/T2.status"
  printf 'status: skipped (n/a)\ndesc: Extra\ndeps: \n' >"$run/implement-plan/T3.status"
  echo "T1" >"$run/implement-plan/.order"
  echo "T2" >>"$run/implement-plan/.order"
  echo "T3" >>"$run/implement-plan/.order"
  : >"$run/implement-plan/_meta.md"
  cat >"$run/implement-report.md" <<'EOF'
# implement-report (rollup)
EOF
  cat >"$run/implement-report/T1.md" <<'EOF'
<!-- relay: stage=implement tool=cursor model=impl-model base=x date=2026-09-27 -->

done
EOF
}

write_run_note() {
  local run="$1" id="$2" slug="$3"
  mkdir -p "$run/distill"
  local note="$run/distill/20260927-${id}-${slug}.md"
  cat >"$note" <<EOF
---
type: run
run: "[[20260927-${id}-${slug}]]"
date: 2026-09-27
base: $BASE
scope: project
tags: [atry/run]
notes: []
dur_implement_min:
files_changed:
tokens:
cost:
---
<!-- relay: stage=distill type=run tool=cursor model=distill-model date=2026-09-27 -->

## Summary

Fixture body must stay byte-identical.
EOF
  printf '%s\n' "$note"
}

# ========== 1. Complete run (file-form implement-plan) ==========
new_run 1000000001 complete
write_complete_history "$RUN"
write_implement_file_form "$RUN"
write_reviews "$RUN"
NOTE="$(write_run_note "$RUN" 1000000001 complete)"
BODY_BEFORE="$(awk 'BEGIN{c=0} /^---[[:space:]]*$/{c++; if(c==2){s=1; next}} s{print}' "$NOTE")"

OUT="$("$ATRY" metrics "$RUN" --write "$NOTE" 2>/dev/null)"
[[ "$(field "$OUT" dur_implement_min)" == "30" ]] && pass "complete: dur_implement_min=30" || fail "complete: dur_implement_min=30 (got '$(field "$OUT" dur_implement_min)')"
[[ "$(field "$OUT" dur_self_review_min)" == "10" ]] && pass "complete: dur_self_review_min=10" || fail "complete: dur_self_review_min"
[[ "$(field "$OUT" dur_cross_review_min)" == "20" ]] && pass "complete: dur_cross_review_min=20" || fail "complete: dur_cross_review_min"
[[ "$(field "$OUT" dur_distill_min)" == "10" ]] && pass "complete: dur_distill_min=10" || fail "complete: dur_distill_min"
[[ "$(field "$OUT" tool_implement)" == "cursor" ]] && pass "complete: tool_implement" || fail "complete: tool_implement"
[[ "$(field "$OUT" tool_cross_review)" == "claude" ]] && pass "complete: tool_cross_review" || fail "complete: tool_cross_review"
[[ "$(field "$OUT" model_implement)" == "impl-model" ]] && pass "complete: model_implement" || fail "complete: model_implement"
[[ "$(field "$OUT" model_source)" == "self-reported" ]] && pass "complete: model_source" || fail "complete: model_source"
[[ "$(field "$OUT" files_changed)" == "1" ]] && pass "complete: files_changed=1" || fail "complete: files_changed (got '$(field "$OUT" files_changed)')"
[[ "$(field "$OUT" lines_added)" == "1" ]] && pass "complete: lines_added=1" || fail "complete: lines_added"
[[ "$(field "$OUT" tasks_planned)" == "2" ]] && pass "complete: tasks_planned=2" || fail "complete: tasks_planned"
[[ "$(field "$OUT" tasks_implemented)" == "2" ]] && pass "complete: tasks_implemented=2 (file form)" || fail "complete: tasks_implemented file form"
[[ "$(field "$OUT" review_findings)" == "2" ]] && pass "complete: review_findings=2 (skips none)" || fail "complete: review_findings (got '$(field "$OUT" review_findings)')"
[[ "$(field "$OUT" review_rounds)" == "2" ]] && pass "complete: review_rounds=2" || fail "complete: review_rounds"
[[ -z "$(field "$OUT" tokens)" ]] && pass "complete: tokens empty" || fail "complete: tokens empty"
[[ -z "$(field "$OUT" cost)" ]] && pass "complete: cost empty" || fail "complete: cost empty"

BODY_AFTER="$(awk 'BEGIN{c=0} /^---[[:space:]]*$/{c++; if(c==2){s=1; next}} s{print}' "$NOTE")"
[[ "$BODY_BEFORE" == "$BODY_AFTER" ]] && pass "--write preserves body" || fail "--write preserves body"
[[ "$(field "$NOTE" dur_implement_min)" == "30" ]] && pass "--write updates dur_implement_min in note" || fail "--write updates frontmatter"
[[ "$(field "$NOTE" model_distill)" == "distill-model" ]] && pass "--write inserts missing metric keys" || fail "--write inserts missing keys"

# ========== 2. Missing cross-review ==========
new_run 1000000002 no-cross
cat >"$RUN/history.log" <<'EOF'
2026-09-27T10:00:00Z stage=plan action=created tool=cursor
2026-09-27T10:10:00Z stage=implement action=started tool=cursor
2026-09-27T10:40:00Z stage=implement action=completed tool=cursor
2026-09-27T10:41:00Z stage=self-review action=started tool=cursor
2026-09-27T10:51:00Z stage=self-review action=completed tool=cursor
2026-09-27T11:21:00Z stage=distill action=started tool=cursor
2026-09-27T11:31:00Z stage=distill action=completed tool=cursor
EOF
write_implement_file_form "$RUN"
cat >"$RUN/review-report.md" <<'EOF'
## Self-Review — 2026-09-27

<!-- relay: stage=self-review tool=cursor model=sr-model base=x date=2026-09-27 -->

### Issues found

- Only self

### Fixed

- none
EOF

OUT="$("$ATRY" metrics "$RUN" 2>/dev/null)"
[[ -z "$(field "$OUT" dur_cross_review_min)" ]] && pass "missing cross-review: dur empty" || fail "missing cross-review: dur empty (got '$(field "$OUT" dur_cross_review_min)')"
[[ -z "$(field "$OUT" tool_cross_review)" ]] && pass "missing cross-review: tool empty" || fail "missing cross-review: tool empty"
[[ -z "$(field "$OUT" model_cross_review)" ]] && pass "missing cross-review: model empty" || fail "missing cross-review: model empty"
[[ "$(field "$OUT" review_rounds)" == "1" ]] && pass "missing cross-review: review_rounds=1" || fail "missing cross-review: review_rounds"
[[ "$(field "$OUT" dur_implement_min)" == "30" ]] && pass "missing cross-review: other stages still counted" || fail "missing cross-review: implement duration"

# ========== 3. Parallel implement layout ==========
new_run 1000000003 parallel
write_complete_history "$RUN"
write_implement_parallel "$RUN"
write_reviews "$RUN"
# Also leave a stale file-form checklist that must NOT win over the directory.
cat >"$RUN/implement-plan.md" <<'EOF'
# implement-plan (stale rollup — only 1 task on purpose)
- [done] T1: First task
EOF

OUT="$("$ATRY" metrics "$RUN" 2>/dev/null)"
[[ "$(field "$OUT" tasks_implemented)" == "3" ]] && pass "parallel: tasks_implemented counts .status files" || fail "parallel: tasks_implemented (got '$(field "$OUT" tasks_implemented)')"
[[ "$(field "$OUT" model_implement)" == "impl-model" ]] && pass "parallel: model from implement-report/T1.md" || fail "parallel: model from per-task report"

# ========== 4. Multiple review rounds ==========
new_run 1000000004 multi-round
cat >"$RUN/history.log" <<'EOF'
2026-09-27T10:00:00Z stage=plan action=created tool=cursor
2026-09-27T10:10:00Z stage=implement action=started tool=cursor
2026-09-27T10:25:00Z stage=implement action=completed tool=cursor
2026-09-27T10:30:00Z stage=self-review action=started tool=cursor
2026-09-27T10:40:00Z stage=self-review action=completed tool=cursor
2026-09-27T10:50:00Z stage=cross-review action=started tool=claude
2026-09-27T11:00:00Z stage=cross-review action=completed tool=claude
2026-09-27T12:00:00Z stage=self-review action=started tool=cursor
2026-09-27T12:15:00Z stage=self-review action=completed tool=cursor
2026-09-27T12:20:00Z stage=cross-review action=started tool=gemini
2026-09-27T12:50:00Z stage=cross-review action=completed tool=gemini
2026-09-27T13:00:00Z stage=distill action=started tool=cursor
2026-09-27T13:05:00Z stage=distill action=completed tool=cursor
EOF
write_implement_file_form "$RUN"
cat >"$RUN/review-report.md" <<'EOF'
## Self-Review — 2026-09-27

<!-- relay: stage=self-review tool=cursor model=sr1 base=x date=2026-09-27 -->

### Issues found

- Round1-A

## Cross-Review — 2026-09-27

<!-- relay: stage=cross-review tool=claude model=cr1 base=x date=2026-09-27 -->

### Issues found

- Round1-B

## Self-Review — 2026-09-28

<!-- relay: stage=self-review tool=cursor model=sr2 base=x date=2026-09-28 -->

### Issues found

- Round2-A

## Cross-Review — 2026-09-28

<!-- relay: stage=cross-review tool=gemini model=cr2 base=x date=2026-09-28 -->

### Issues found

- Round2-B
- Round2-C
EOF

OUT="$("$ATRY" metrics "$RUN" 2>/dev/null)"
[[ "$(field "$OUT" review_rounds)" == "4" ]] && pass "multi-round: review_rounds=4" || fail "multi-round: review_rounds (got '$(field "$OUT" review_rounds)')"
# self-review: 10 + 15 = 25 min; cross-review: 10 + 30 = 40 min
[[ "$(field "$OUT" dur_self_review_min)" == "25" ]] && pass "multi-round: dur_self_review_min sums rounds" || fail "multi-round: dur_self_review_min (got '$(field "$OUT" dur_self_review_min)')"
[[ "$(field "$OUT" dur_cross_review_min)" == "40" ]] && pass "multi-round: dur_cross_review_min sums rounds" || fail "multi-round: dur_cross_review_min (got '$(field "$OUT" dur_cross_review_min)')"
[[ "$(field "$OUT" tool_cross_review)" == "claude,gemini" ]] && pass "multi-round: tool_cross_review comma list" || fail "multi-round: tool_cross_review (got '$(field "$OUT" tool_cross_review)')"
[[ "$(field "$OUT" model_cross_review)" == "cr1,cr2" ]] && pass "multi-round: model_cross_review comma list" || fail "multi-round: model_cross_review (got '$(field "$OUT" model_cross_review)')"
[[ "$(field "$OUT" review_findings)" == "5" ]] && pass "multi-round: review_findings across sections" || fail "multi-round: review_findings (got '$(field "$OUT" review_findings)')"

# ========== 5. Error paths ==========
set +e
"$ATRY" metrics 9999999999 >/dev/null 2>&1
RC=$?
set -e
[[ "$RC" -ne 0 ]] && pass "unresolvable run exits non-zero" || fail "unresolvable run exits non-zero (got $RC)"

new_run 1000000005 bad-base
echo "base: not-a-real-ref-zzzz" >"$RUN/plan.md"
printf 'base: not-a-real-ref-zzzz\nid: 1000000005\n' >"$RUN/meta.md"
: >"$RUN/history.log"
set +e
"$ATRY" metrics "$RUN" >/dev/null 2>&1
RC=$?
set -e
[[ "$RC" -ne 0 ]] && pass "unreadable base exits non-zero" || fail "unreadable base exits non-zero (got $RC)"

# ========== 6. .agent-relay/ excluded from numstat ==========
new_run 1000000006 exclude-ar
write_complete_history "$RUN"
write_implement_file_form "$RUN"
# Huge file only under .agent-relay should not inflate lines_added
yes x 2>/dev/null | head -500 >"$RUN/noise.txt" || true
OUT="$("$ATRY" metrics "$RUN" 2>/dev/null)"
[[ "$(field "$OUT" files_changed)" == "1" ]] && pass ".agent-relay/ excluded from files_changed" || fail ".agent-relay/ excluded (files_changed=$(field "$OUT" files_changed))"

# ========== 7. Binary files count toward files_changed ==========
new_run 1000000007 binary
write_complete_history "$RUN"
write_implement_file_form "$RUN"
printf '\0\1\2\3' >"$REPO/bin.dat"
git -C "$REPO" add bin.dat
OUT="$("$ATRY" metrics "$RUN" 2>/dev/null)"
# file.txt (text edit) + bin.dat (binary) — both appear in numstat
[[ "$(field "$OUT" files_changed)" == "2" ]] && pass "binary: files_changed counts binary paths" || fail "binary: files_changed (got '$(field "$OUT" files_changed)')"
[[ "$(field "$OUT" lines_added)" == "1" ]] && pass "binary: lines_added ignores binary '-'" || fail "binary: lines_added (got '$(field "$OUT" lines_added)')"

# ========== 8. implement-start head= is the diff base ==========
git -C "$REPO" commit -qm "earlier run lands bin.dat"
C2="$(git -C "$REPO" rev-parse HEAD)"
new_run 1000000008 impl-head
write_implement_file_form "$RUN"
cat >"$RUN/history.log" <<EOF
2026-09-27T10:10:00Z stage=implement action=started tool=cursor head=$C2
2026-09-27T10:40:00Z stage=implement action=completed tool=cursor
EOF
OUT="$("$ATRY" metrics "$RUN" 2>/dev/null)"
[[ "$(field "$OUT" diff_base)" == "$C2" ]] && pass "head=: diff_base is the implement-start commit" || fail "head=: diff_base (got '$(field "$OUT" diff_base)')"
[[ "$(field "$OUT" files_changed)" == "1" ]] && pass "head=: earlier committed run not counted" || fail "head=: files_changed (got '$(field "$OUT" files_changed)')"
# Unreadable head= falls back to the plan base (file.txt + bin.dat).
sed -i.bak "s/head=$C2/head=deadbeefdeadbeef/" "$RUN/history.log" && rm -f "$RUN/history.log.bak"
OUT="$("$ATRY" metrics "$RUN" 2>/dev/null)"
[[ "$(field "$OUT" diff_base)" == "$BASE" && "$(field "$OUT" files_changed)" == "2" ]] && pass "head=: unreadable head falls back to plan base" || fail "head=: fallback (diff_base='$(field "$OUT" diff_base)' files=$(field "$OUT" files_changed))"

# ========== 9. repeated completed is not a new review round ==========
new_run 1000000009 dup-completed
write_implement_file_form "$RUN"
cat >"$RUN/history.log" <<'EOF'
2026-09-27T10:00:00Z stage=self-review action=started tool=cursor
2026-09-27T10:10:00Z stage=self-review action=completed tool=cursor
2026-09-27T10:20:00Z stage=cross-review action=started tool=claude
2026-09-27T10:30:00Z stage=cross-review action=completed tool=claude
2026-09-27T10:35:00Z stage=cross-review action=completed tool=claude
EOF
OUT="$("$ATRY" metrics "$RUN" 2>/dev/null)"
[[ "$(field "$OUT" review_rounds)" == "2" ]] && pass "review_rounds ignores a repeated completed" || fail "review_rounds (got '$(field "$OUT" review_rounds)')"
[[ "$(field "$OUT" dur_cross_review_min)" == "10" ]] && pass "repeated completed does not extend duration" || fail "dur_cross_review_min (got '$(field "$OUT" dur_cross_review_min)')"

# ========== 10. history append records head= on implement started ==========
new_run 1000000010 history-head
: >"$RUN/history.log"
"$ATRY" history append "$RUN" implement started tool=cursor >/dev/null 2>&1
grep -q "stage=implement action=started tool=cursor head=$C2\$" "$RUN/history.log" && pass "history append adds head= on implement started" || fail "history append head= (got '$(cat "$RUN/history.log")')"
"$ATRY" history append "$RUN" implement completed tool=cursor >/dev/null 2>&1
tail -1 "$RUN/history.log" | grep -qE "stage=implement action=completed tool=cursor head=$C2( |\$)" && pass "history append adds head= on implement completed" || fail "history append completed head= (got '$(tail -1 "$RUN/history.log")')"
"$ATRY" history append "$RUN" self-review completed tool=cursor >/dev/null 2>&1
tail -1 "$RUN/history.log" | grep -qE "head=$C2( |\$)" && pass "history append adds head= on self-review completed" || fail "self-review completed head="
"$ATRY" history append "$RUN" cross-review completed tool=claude >/dev/null 2>&1
tail -1 "$RUN/history.log" | grep -qE "head=$C2( |\$)" && pass "history append adds head= on cross-review completed" || fail "cross-review completed head="
# Explicit head= wins (do not overwrite).
"$ATRY" history append "$RUN" implement completed tool=cursor head=deadbeefdeadbeef >/dev/null 2>&1
tail -1 "$RUN/history.log" | grep -qE "head=deadbeefdeadbeef( |\$)" && pass "explicit head= wins on completed" || fail "explicit head= (got '$(tail -1 "$RUN/history.log")')"
# distill completed does not auto-record head=
"$ATRY" history append "$RUN" distill completed tool=cursor >/dev/null 2>&1
tail -1 "$RUN/history.log" | grep -q "head=" && fail "distill completed must not auto-add head=" || pass "distill completed has no auto head="

# ========== 11. metrics END cases (diff_end) ==========
# Case 1: END present and END != diff_base → commit-range; later commits excluded.
END_REPO="$T/end-repo"
mkdir -p "$END_REPO"
(
  cd "$END_REPO"
  git init -q
  echo "base" >file.txt
  git add file.txt
  git commit -qm "init"
)
E_BASE="$(git -C "$END_REPO" rev-parse HEAD)"
echo "start-marker" >>"$END_REPO/file.txt"
git -C "$END_REPO" add file.txt
git -C "$END_REPO" commit -qm "implement start"
E_START="$(git -C "$END_REPO" rev-parse HEAD)"
echo "end-change" >>"$END_REPO/file.txt"
git -C "$END_REPO" add file.txt
git -C "$END_REPO" commit -qm "implement end"
E_END="$(git -C "$END_REPO" rev-parse HEAD)"
echo "later-change" >>"$END_REPO/file.txt"
git -C "$END_REPO" add file.txt
git -C "$END_REPO" commit -qm "unrelated later"
E_LATER="$(git -C "$END_REPO" rev-parse HEAD)"
EAR="$END_REPO/.agent-relay"
mkdir -p "$EAR"
RUN="$EAR/20260927-1000000011-end-range"
mkdir -p "$RUN"
cat >"$RUN/meta.md" <<EOF
id: 1000000011
slug: end-range
created: 2026-09-27
title: end range
stage: distill
status: active
base: $E_BASE
EOF
cat >"$RUN/plan.md" <<EOF
base: $E_BASE
id: 1000000011

# end range

## Tasks

1. One (deps: )
EOF
cat >"$RUN/history.log" <<EOF
2026-09-27T10:10:00Z stage=implement action=started tool=cursor head=$E_START
2026-09-27T10:40:00Z stage=implement action=completed tool=cursor head=$E_END
2026-09-27T10:50:00Z stage=self-review action=completed tool=cursor head=$E_END
EOF
OUT="$("$ATRY" metrics "$RUN" 2>/dev/null)"
ERR="$("$ATRY" metrics "$RUN" 2>&1 >/dev/null || true)"
[[ "$(field "$OUT" diff_base)" == "$E_START" ]] && pass "case1: diff_base is implement start" || fail "case1: diff_base (got '$(field "$OUT" diff_base)')"
[[ "$(field "$OUT" diff_end)" == "$E_END" ]] && pass "case1: diff_end is last review completed head" || fail "case1: diff_end (got '$(field "$OUT" diff_end)')"
# Range E_START..E_END is one line added ("end-change"); later-change excluded.
[[ "$(field "$OUT" files_changed)" == "1" ]] && pass "case1: files_changed excludes later commit" || fail "case1: files_changed (got '$(field "$OUT" files_changed)')"
[[ "$(field "$OUT" lines_added)" == "1" ]] && pass "case1: lines_added is commit-range only" || fail "case1: lines_added (got '$(field "$OUT" lines_added)')"

# Case 2: END == diff_base and HEAD == END → working-tree diff; diff_end=worktree
RUN="$EAR/20260927-1000000012-end-wt"
mkdir -p "$RUN"
# Detach to E_START (= END); leave uncommitted edit.
git -C "$END_REPO" checkout -q "$E_START"
echo "wt-only" >>"$END_REPO/file.txt"
cat >"$RUN/meta.md" <<EOF
id: 1000000012
slug: end-wt
created: 2026-09-27
title: end wt
stage: distill
status: active
base: $E_BASE
EOF
cat >"$RUN/plan.md" <<EOF
base: $E_BASE
id: 1000000012

# end wt

## Tasks

1. One (deps: )
EOF
cat >"$RUN/history.log" <<EOF
2026-09-27T10:10:00Z stage=implement action=started tool=cursor head=$E_START
2026-09-27T10:40:00Z stage=implement action=completed tool=cursor head=$E_START
EOF
OUT="$("$ATRY" metrics "$RUN" 2>/dev/null)"
[[ "$(field "$OUT" diff_end)" == "worktree" ]] && pass "case2: diff_end=worktree when END==diff_base and HEAD==END" || fail "case2: diff_end (got '$(field "$OUT" diff_end)')"
[[ "$(field "$OUT" files_changed)" == "1" ]] && pass "case2: working-tree files_changed" || fail "case2: files_changed (got '$(field "$OUT" files_changed)')"
[[ "$(field "$OUT" lines_added)" == "1" ]] && pass "case2: working-tree lines_added" || fail "case2: lines_added (got '$(field "$OUT" lines_added)')"

# Case 3: END == diff_base but HEAD has moved → empty sizes, warning, exit 0
# Case 2 left an uncommitted edit on file.txt; discard before moving HEAD.
git -C "$END_REPO" checkout -qf "$E_LATER"
RUN="$EAR/20260927-1000000013-end-unk"
mkdir -p "$RUN"
cat >"$RUN/meta.md" <<EOF
id: 1000000013
slug: end-unk
created: 2026-09-27
title: end unk
stage: distill
status: active
base: $E_BASE
EOF
cat >"$RUN/plan.md" <<EOF
base: $E_BASE
id: 1000000013

# end unk

## Tasks

1. One (deps: )
EOF
cat >"$RUN/history.log" <<EOF
2026-09-27T10:10:00Z stage=implement action=started tool=cursor head=$E_START
2026-09-27T10:40:00Z stage=implement action=completed tool=cursor head=$E_START
EOF
set +e
OUT="$("$ATRY" metrics "$RUN" 2>/dev/null)"
ERR="$("$ATRY" metrics "$RUN" 2>&1 >/dev/null)"
RC=$?
set -e
[[ "$RC" -eq 0 ]] && pass "case3: exit 0 when size unknowable" || fail "case3: exit $RC"
[[ "$(field "$OUT" diff_end)" == "" ]] && pass "case3: diff_end empty" || fail "case3: diff_end (got '$(field "$OUT" diff_end)')"
[[ "$(field "$OUT" files_changed)" == "" ]] && pass "case3: files_changed empty" || fail "case3: files_changed (got '$(field "$OUT" files_changed)')"
[[ "$(field "$OUT" lines_added)" == "" && "$(field "$OUT" lines_deleted)" == "" ]] && pass "case3: line counts empty" || fail "case3: lines"
echo "$ERR" | grep -qi "unknowable\|cannot size\|HEAD has moved\|size is unknowable" && pass "case3: warns on stderr" || fail "case3: stderr warning (got '$ERR')"

# Case 4: no END recorded → working-tree + warning; diff_end=worktree
git -C "$END_REPO" checkout -q "$E_LATER"
# Ensure working tree dirty relative to E_START for a non-zero count
echo "case4" >>"$END_REPO/file.txt"
RUN="$EAR/20260927-1000000014-no-end"
mkdir -p "$RUN"
cat >"$RUN/meta.md" <<EOF
id: 1000000014
slug: no-end
created: 2026-09-27
title: no end
stage: distill
status: active
base: $E_BASE
EOF
cat >"$RUN/plan.md" <<EOF
base: $E_BASE
id: 1000000014

# no end

## Tasks

1. One (deps: )
EOF
cat >"$RUN/history.log" <<EOF
2026-09-27T10:10:00Z stage=implement action=started tool=cursor head=$E_START
2026-09-27T10:40:00Z stage=implement action=completed tool=cursor
EOF
set +e
OUT="$("$ATRY" metrics "$RUN" 2>/dev/null)"
ERR="$("$ATRY" metrics "$RUN" 2>&1 >/dev/null)"
RC=$?
set -e
[[ "$RC" -eq 0 ]] && pass "case4: exit 0 without END" || fail "case4: exit $RC"
[[ "$(field "$OUT" diff_end)" == "worktree" ]] && pass "case4: diff_end=worktree" || fail "case4: diff_end (got '$(field "$OUT" diff_end)')"
[[ -n "$(field "$OUT" files_changed)" ]] && pass "case4: working-tree size still computed" || fail "case4: files_changed empty"
echo "$ERR" | grep -qi "current tree\|working.tree\|no end\|no END\|diff_end" && pass "case4: warns on stderr" || fail "case4: stderr warning (got '$ERR')"

# ========== 12. size= snapshot on completed (preferred over END cases) ==========
# Snapshot: history append records size_base= / size= on implement,
# self-review and cross-review completed; metrics prefers the last one when its
# base matches diff_base, so committing afterwards does not change the size.
snap_run() {
  # snap_run <name> <id>: fresh repo + run dir; sets SNAP_REPO / SNAP_RUN / SNAP_BASE0
  SNAP_REPO="$T/snap-$1"
  mkdir -p "$SNAP_REPO"
  (
    cd "$SNAP_REPO"
    git init -q
    echo "base" >f.txt
    git add f.txt
    git commit -qm init
  )
  SNAP_BASE0="$(git -C "$SNAP_REPO" rev-parse HEAD)"
  SNAP_RUN="$SNAP_REPO/.agent-relay/20260928-$2-$1"
  mkdir -p "$SNAP_RUN"
  printf 'base: %s\nid: %s\n\n# %s\n\n## Tasks\n\n1. One (deps: )\n' "$SNAP_BASE0" "$2" "$1" >"$SNAP_RUN/plan.md"
  printf 'id: %s\nslug: %s\ncreated: 2026-09-28\ntitle: %s\nstage: plan\nstatus: active\nbase: %s\n' "$2" "$1" "$1" "$SNAP_BASE0" >"$SNAP_RUN/meta.md"
}

# Z: everything uncommitted through cross-review, human commits afterwards.
snap_run snap-uncommitted 1000000021
"$ATRY" history append "$SNAP_RUN" implement started tool=cursor 2>/dev/null
printf 'a\nb\n' >>"$SNAP_REPO/f.txt"
"$ATRY" history append "$SNAP_RUN" implement completed tool=cursor 2>/dev/null
"$ATRY" history append "$SNAP_RUN" cross-review completed tool=claude 2>/dev/null
tail -1 "$SNAP_RUN/history.log" | grep -qE " size_base=$SNAP_BASE0 size=1/2/0( |\$)" && pass "snapshot: completed records size_base= and size=" || fail "snapshot: completed size= (got '$(tail -1 "$SNAP_RUN/history.log")')"
git -C "$SNAP_REPO" commit -qam work
printf 'later\n' >>"$SNAP_REPO/f.txt"
git -C "$SNAP_REPO" commit -qam later
OUT="$("$ATRY" metrics "$SNAP_RUN" 2>/dev/null)"
[[ "$(field "$OUT" diff_end)" == "snapshot" ]] && pass "snapshot: diff_end=snapshot" || fail "snapshot: diff_end (got '$(field "$OUT" diff_end)')"
[[ "$(field "$OUT" files_changed)" == "1" && "$(field "$OUT" lines_added)" == "2" && "$(field "$OUT" lines_deleted)" == "0" ]] && pass "snapshot: size survives commit-after-review and later commits" || fail "snapshot: sizes (got $(field "$OUT" files_changed)/$(field "$OUT" lines_added)/$(field "$OUT" lines_deleted))"

# X: implement committed, reviewer fix left uncommitted at cross-review end.
snap_run snap-mixed 1000000022
"$ATRY" history append "$SNAP_RUN" implement started tool=cursor 2>/dev/null
printf 'a\nb\n' >>"$SNAP_REPO/f.txt"
git -C "$SNAP_REPO" commit -qam impl
"$ATRY" history append "$SNAP_RUN" implement completed tool=cursor 2>/dev/null
printf 'fix\n' >>"$SNAP_REPO/f.txt"
"$ATRY" history append "$SNAP_RUN" cross-review completed tool=claude 2>/dev/null
OUT="$("$ATRY" metrics "$SNAP_RUN" 2>/dev/null)"
[[ "$(field "$OUT" lines_added)" == "3" ]] && pass "snapshot: uncommitted review fix is counted" || fail "snapshot: mixed lines_added (got '$(field "$OUT" lines_added)')"

# Explicit size= wins; a snapshot from another base is ignored (falls back).
snap_run snap-explicit 1000000023
"$ATRY" history append "$SNAP_RUN" implement started tool=cursor 2>/dev/null
"$ATRY" history append "$SNAP_RUN" implement completed tool=cursor size_base=$SNAP_BASE0 size=7/8/9 2>/dev/null
tail -1 "$SNAP_RUN/history.log" | grep -qE "size=7/8/9( |\$)" && [[ "$(grep -c 'size=' <(tail -1 "$SNAP_RUN/history.log"))" -eq 1 ]] && pass "snapshot: explicit size= wins (no auto snapshot)" || fail "snapshot: explicit size= (got '$(tail -1 "$SNAP_RUN/history.log")')"
OUT="$("$ATRY" metrics "$SNAP_RUN" 2>/dev/null)"
[[ "$(field "$OUT" lines_added)" == "8" ]] && pass "snapshot: metrics uses explicit size=" || fail "snapshot: explicit metrics (got '$(field "$OUT" lines_added)')"
printf '2026-09-28T00:00:00Z stage=cross-review action=completed tool=claude size_base=0000000000000000000000000000000000000000 size=5/5/5\n' >>"$SNAP_RUN/history.log"
OUT="$("$ATRY" metrics "$SNAP_RUN" 2>/dev/null)"
[[ "$(field "$OUT" diff_end)" != "snapshot" ]] && pass "snapshot: base mismatch falls back to END cases" || fail "snapshot: base mismatch used snapshot"

if [[ "$FAIL" -ne 0 ]]; then
  echo "metrics tests FAILED"
  exit 1
fi
echo "metrics tests OK"
exit 0
