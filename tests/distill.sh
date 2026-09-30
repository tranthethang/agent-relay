#!/usr/bin/env bash
# Offline checks for atry distill (scripts/runtime/distill-manifest.sh).
# Run from repo root:
#   ./tests/distill.sh
#   make distill
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ATRY="$ROOT/scripts/atry"
DISTILL_SH="$ROOT/scripts/runtime/distill-manifest.sh"

FAIL=0
pass() { echo "PASS: $1"; }
fail() {
  echo "FAIL: $1"
  FAIL=1
}

T="$(mktemp -d "${TMPDIR:-/tmp}/ar-distill.XXXXXX")"
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
  local src="$1" key="$2"
  if [[ -f "$src" ]]; then
    sed -n "s/^${key}:[[:space:]]*//p" "$src" | head -1
  else
    printf '%s\n' "$src" | sed -n "s/^${key}:[[:space:]]*//p" | head -1
  fi
}

file_lines_only() {
  # Strip distilled_at (and keep schema/run_id/state/file.*) for idempotence compares.
  sed '/^distilled_at:/d' "$1"
}

# --- static: bash 3.2 compatibility ---
if grep -q 'declare -A' "$DISTILL_SH"; then
  fail "distill-manifest.sh contains declare -A (bash 4+ feature)"
else
  pass "distill-manifest.sh does not use declare -A"
fi

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

new_run() {
  local id="$1" slug="$2"
  (
    cd "$REPO"
    "$ATRY" run-init "$id" --slug "$slug" --title "distill fixture $slug" --base "$BASE" --tool cursor
  )
}

# ---------- missing run → exit 1 ----------
MISS_RC=0
MISS_OUT=""
MISS_OUT="$(
  cd "$REPO"
  "$ATRY" distill 1790999999-no-such-run 2>&1
)" || MISS_RC=$?
if [[ "$MISS_RC" -eq 1 ]]; then
  pass "missing run exits 1"
else
  fail "missing run exits 1 (got $MISS_RC: $MISS_OUT)"
fi

# ---------- fresh write ----------
RUN="$(new_run 1790900001 distill-fresh)"
# Extra files for sorting + exclusion
mkdir -p "$RUN/subdir" "$RUN/.hidden" "$RUN/distill"
echo "alpha" >"$RUN/a.txt"
echo "zeta" >"$RUN/z.txt"
echo "mid" >"$RUN/subdir/m.txt"
echo "secret" >"$RUN/.hidden/secret.txt"
echo "tmpdata" >"$RUN/scratch.tmp"
echo "locked" >"$RUN/work.lock"
echo "old-note" >"$RUN/distill/old-note.md"
echo "dotfile" >"$RUN/.order"
echo "# plan" >"$RUN/plan.md"

META_BEFORE="$(cat "$RUN/meta.md")"
HIST_BEFORE="$(cat "$RUN/history.log")"

ERR1=""
RC1=0
ERR1="$(
  cd "$REPO"
  "$ATRY" distill "$RUN" 2>&1 >/dev/null
)" || RC1=$?

if [[ "$RC1" -eq 0 ]]; then
  pass "fresh distill exits 0"
else
  fail "fresh distill exits 0 (rc=$RC1 err=$ERR1)"
fi

MANIFEST="$RUN/distill/manifest"
if [[ -f "$MANIFEST" ]]; then
  pass "fresh distill writes distill/manifest"
else
  fail "fresh distill writes distill/manifest"
fi

if printf '%s\n' "$ERR1" | grep -q "distill: wrote .*manifest"; then
  pass "stderr reports distill: wrote path"
else
  fail "stderr reports distill: wrote path (got: $ERR1)"
fi

[[ "$(field "$MANIFEST" schema)" == "1" ]] && pass "schema: 1" || fail "schema: 1 (got $(field "$MANIFEST" schema))"
[[ "$(field "$MANIFEST" run_id)" == "$(basename "$RUN")" ]] && pass "run_id matches basename" || fail "run_id matches basename"
[[ -n "$(field "$MANIFEST" distilled_at)" ]] && pass "distilled_at present" || fail "distilled_at present"
[[ -n "$(field "$MANIFEST" state)" ]] && pass "state present" || fail "state present"

# ---------- exclusion rules ----------
if grep -q '^file\.distill/' "$MANIFEST"; then
  fail "excludes distill/ contents"
else
  pass "excludes distill/ contents"
fi
if grep -q '^file\.\.hidden/' "$MANIFEST" || grep -q '^file\.\.order:' "$MANIFEST"; then
  fail "excludes dot-segment paths"
else
  pass "excludes dot-segment paths"
fi
if grep -q '\.tmp:' "$MANIFEST" || grep -q '\.lock:' "$MANIFEST"; then
  fail "excludes .tmp / .lock segments"
else
  pass "excludes .tmp / .lock segments"
fi

# Included files
for key in file.a.txt file.z.txt file.subdir/m.txt file.meta.md file.plan.md file.history.log; do
  if grep -q "^${key}:" "$MANIFEST"; then
    pass "includes $key"
  else
    fail "includes $key"
  fi
done

# ---------- sorting (LC_ALL=C) ----------
FILE_KEYS="$(grep '^file\.' "$MANIFEST" | sed 's/:.*//')"
SORTED_KEYS="$(printf '%s\n' "$FILE_KEYS" | LC_ALL=C sort)"
if [[ "$FILE_KEYS" == "$SORTED_KEYS" ]]; then
  pass "file.* lines are LC_ALL=C sorted"
else
  fail "file.* lines are LC_ALL=C sorted"
fi

# ---------- no history / meta mutation ----------
META_AFTER="$(cat "$RUN/meta.md")"
HIST_AFTER="$(cat "$RUN/history.log")"
if [[ "$META_BEFORE" == "$META_AFTER" ]]; then
  pass "distill does not change meta.md"
else
  fail "distill does not change meta.md"
fi
if [[ "$HIST_BEFORE" == "$HIST_AFTER" ]]; then
  pass "distill does not append history.log"
else
  fail "distill does not append history.log"
fi
if ! grep -q 'stage=distill' "$RUN/history.log"; then
  pass "no stage=distill history line"
else
  fail "no stage=distill history line"
fi

# ---------- re-run idempotence (same file lines; distilled_at may change) ----------
STABLE_A="$(file_lines_only "$MANIFEST")"
sleep 1
ERR2=""
RC2=0
ERR2="$(
  cd "$REPO"
  "$ATRY" distill "$RUN" 2>&1 >/dev/null
)" || RC2=$?
if [[ "$RC2" -ne 0 ]]; then
  fail "re-run distill exits 0 (rc=$RC2 err=$ERR2)"
else
  pass "re-run distill exits 0"
fi
STABLE_B="$(file_lines_only "$MANIFEST")"
if [[ "$STABLE_A" == "$STABLE_B" ]]; then
  pass "re-run keeps schema/run_id/state/file.* identical"
else
  fail "re-run keeps schema/run_id/state/file.* identical"
fi
[[ -n "$(field "$MANIFEST" distilled_at)" ]] &&
  pass "re-run still writes distilled_at" ||
  fail "re-run still writes distilled_at"

# ---------- abandoned state ----------
RUN_AB="$(new_run 1790900002 distill-abandon)"
(
  cd "$REPO"
  "$ATRY" close "$RUN_AB" --abandon "test abandon" >/dev/null
)
AB_RC=0
AB_ERR="$(
  cd "$REPO"
  "$ATRY" distill "$RUN_AB" 2>&1 >/dev/null
)" || AB_RC=$?
if [[ "$AB_RC" -eq 0 ]]; then
  pass "distill works on abandoned run"
else
  fail "distill works on abandoned run (rc=$AB_RC err=$AB_ERR)"
fi
AB_STATE="$(field "$RUN_AB/distill/manifest" state)"
if [[ "$AB_STATE" == "abandoned" ]]; then
  pass "abandoned run manifest state=abandoned"
else
  fail "abandoned run manifest state=abandoned (got $AB_STATE)"
fi

# ---------- usage / no args ----------
USAGE_RC=0
(
  cd "$REPO"
  "$ATRY" distill
) >/dev/null 2>&1 || USAGE_RC=$?
if [[ "$USAGE_RC" -eq 1 ]]; then
  pass "distill with no args exits 1"
else
  fail "distill with no args exits 1 (got $USAGE_RC)"
fi

if [[ "$FAIL" -ne 0 ]]; then
  echo "distill tests: FAILED"
  exit 1
fi
echo "distill tests: OK"
