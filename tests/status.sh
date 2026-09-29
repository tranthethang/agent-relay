#!/usr/bin/env bash
# Offline checks for human cockpit commands (status / approve / close / stamp / decide).
# Run from repo root:
#   ./tests/status.sh
#   make status
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ATRY="$ROOT/scripts/atry"
COCKPIT_SH="$ROOT/scripts/runtime/run-cockpit.sh"
STATUS_SH="$ROOT/scripts/runtime/run-status.sh"

FAIL=0
pass() { echo "PASS: $1"; }
fail() {
  echo "FAIL: $1"
  FAIL=1
}

T="$(mktemp -d "${TMPDIR:-/tmp}/ar-status.XXXXXX")"
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

# --- static: bash 3.2 compatibility ---
for f in "$COCKPIT_SH" "$STATUS_SH"; do
  if grep -q 'declare -A' "$f"; then
    fail "$(basename "$f") contains declare -A (bash 4+ feature)"
  else
    pass "$(basename "$f") does not use declare -A"
  fi
done

# --- hermetic fixture repo ---
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
    "$ATRY" run-init "$id" --slug "$slug" --title "status fixture $slug" --base "$BASE" --tool cursor
  )
}

# Resolve run path from id
run_path() {
  local id="$1"
  (
    cd "$REPO"
    "$ATRY" resolve "$id"
  )
}

# ---------- approve / stamp / decide / close ----------
RUN1="$(new_run 1790888001 cockpit-one)"
META_STAGE_BEFORE="$(sed -n 's/^stage:[[:space:]]*//p' "$RUN1/meta.md" | head -1)"

if (
  cd "$REPO"
  "$ATRY" approve "$RUN1" plan
) >/dev/null; then
  if grep -q 'stage=plan action=approved by=human' "$RUN1/history.log"; then
    pass "approve appends plan approved by=human"
  else
    fail "approve history line missing"
  fi
else
  fail "approve exited non-zero"
fi

META_STAGE_AFTER="$(sed -n 's/^stage:[[:space:]]*//p' "$RUN1/meta.md" | head -1)"
if [[ "$META_STAGE_AFTER" == "$META_STAGE_BEFORE" ]]; then
  pass "approve does not rewind meta stage"
else
  fail "approve changed meta stage from $META_STAGE_BEFORE to $META_STAGE_AFTER"
fi

if (
  cd "$REPO"
  "$ATRY" stamp "$RUN1" implement tool=cursor model=composer-test
) >/dev/null; then
  if grep -q 'stage=implement action=attested by=human tool=cursor model=composer-test' "$RUN1/history.log"; then
    pass "stamp appends attested event"
  else
    fail "stamp history line missing"
  fi
else
  fail "stamp exited non-zero"
fi

if (
  cd "$REPO"
  "$ATRY" stamp "$RUN1" implement tool=unknown model=x
) >/dev/null 2>"$T/stamp-unknown.err"; then
  fail "stamp should reject tool=unknown"
else
  if grep -q "unknown" "$T/stamp-unknown.err"; then
    pass "stamp rejects tool=unknown"
  else
    fail "stamp unknown rejection message missing"
  fi
fi

if (
  cd "$REPO"
  "$ATRY" stamp "$RUN1" bogus tool=cursor model=x
) >/dev/null 2>"$T/stamp-stage.err"; then
  fail "stamp should reject bad stage"
else
  pass "stamp rejects bad stage"
fi

if (
  cd "$REPO"
  "$ATRY" decide "$RUN1" pick-color "go with blue"
) >/dev/null; then
  if [[ -f "$RUN1/decisions.md" ]] && grep -q 'pick-color: go with blue (by=human)' "$RUN1/decisions.md"; then
    pass "decide writes decisions.md"
  else
    fail "decisions.md missing or wrong"
  fi
  if grep -q 'stage=decision action=resolved by=human id=pick-color' "$RUN1/history.log"; then
    pass "decide appends history event"
  else
    fail "decide history line missing"
  fi
else
  fail "decide exited non-zero"
fi

if (
  cd "$REPO"
  "$ATRY" decide "$RUN1" BadId "x"
) >/dev/null 2>"$T/decide-id.err"; then
  fail "decide should reject invalid id"
else
  pass "decide rejects invalid id"
fi

# close without abandon
RUN_CLOSE="$(new_run 1790888002 cockpit-close)"
if (
  cd "$REPO"
  "$ATRY" close "$RUN_CLOSE"
) >/dev/null; then
  if grep -q 'stage=done action=completed by=human' "$RUN_CLOSE/history.log"; then
    pass "close appends done completed by=human"
  else
    fail "close history line missing"
  fi
  st="$(sed -n 's/^status:[[:space:]]*//p' "$RUN_CLOSE/meta.md" | head -1)"
  if [[ "$st" == "done" ]]; then
    pass "close sets meta status=done"
  else
    fail "close meta status=$st want done"
  fi
else
  fail "close exited non-zero"
fi

# close --abandon
RUN_AB="$(new_run 1790888003 cockpit-abandon)"
if (
  cd "$REPO"
  "$ATRY" close "$RUN_AB" --abandon "scope too large"
) >/dev/null; then
  if grep -q 'stage=done action=abandoned by=human reason=scope-too-large' "$RUN_AB/history.log"; then
    pass "close --abandon normalizes reason token"
  else
    fail "abandon history line missing or wrong: $(tail -1 "$RUN_AB/history.log")"
  fi
  st="$(sed -n 's/^status:[[:space:]]*//p' "$RUN_AB/meta.md" | head -1)"
  if [[ "$st" == "abandoned" ]]; then
    pass "close --abandon sets meta status=abandoned"
  else
    fail "abandon meta status=$st want abandoned"
  fi
else
  fail "close --abandon exited non-zero"
fi

# ---------- approval warning ----------
RUN_WARN="$(new_run 1790888004 cockpit-warn)"
if (
  cd "$REPO"
  "$ATRY" history append "$RUN_WARN" implement started tool=cursor
) >/dev/null 2>"$T/warn.err"; then
  if grep -q 'plan not approved' "$T/warn.err"; then
    pass "implement started warns when plan unapproved"
  else
    fail "missing approval warning on stderr"
  fi
  if grep -q 'stage=implement action=started' "$RUN_WARN/history.log"; then
    pass "implement started still appends after warning"
  else
    fail "implement started did not append"
  fi
else
  fail "implement started exited non-zero (should warn and continue)"
fi

# Approved run: no warning
RUN_OK="$(new_run 1790888005 cockpit-ok)"
(
  cd "$REPO"
  "$ATRY" approve "$RUN_OK" plan
) >/dev/null
if (
  cd "$REPO"
  "$ATRY" history append "$RUN_OK" implement started tool=cursor
) >/dev/null 2>"$T/nowarn.err"; then
  if grep -q 'plan not approved' "$T/nowarn.err"; then
    fail "approved run should not warn on implement started"
  else
    pass "approved run: no approval warning"
  fi
else
  fail "approved implement started failed"
fi

# ---------- status list / detail ----------
# Ensure at least two active-ish runs for list mode (we already have several).
LIST_OUT="$(
  cd "$REPO"
  "$ATRY" status 2>/dev/null
)"
# List mode: one line per run, no "run:" header
if printf '%s\n' "$LIST_OUT" | grep -q '^run: '; then
  # Exactly one run would detail; we have many → expect list lines
  fail "status with many runs should list, not detail (got run: header)"
else
  if printf '%s\n' "$LIST_OUT" | grep -q 'cockpit-one'; then
    pass "status list includes run dirname"
  else
    fail "status list missing cockpit-one"
  fi
  if printf '%s\n' "$LIST_OUT" | grep -q 'next:'; then
    pass "status list includes next step"
  else
    fail "status list missing next:"
  fi
fi

DETAIL="$(
  cd "$REPO"
  "$ATRY" status "$RUN1" 2>/dev/null
)"
if printf '%s\n' "$DETAIL" | grep -q '^plan approved: yes'; then
  pass "status detail shows plan approved yes"
else
  fail "status detail plan approved missing: $DETAIL"
fi
if printf '%s\n' "$DETAIL" | grep -q 'tool=cursor\*'; then
  pass "status detail marks attested tool with *"
else
  fail "status detail missing attested marker"
fi
if printf '%s\n' "$DETAIL" | grep -q 'pick-color: go with blue'; then
  pass "status detail shows decisions.md entry"
else
  fail "status detail missing decisions.md"
fi

# Fence-aware open decisions
RUN_OD="$(new_run 1790888006 cockpit-od)"
cat >"$RUN_OD/review-report.md" <<'EOF'
## Self-Review — 2026-09-29

### Open decisions

- real-open-item should appear

```markdown
## Self-Review — 2099-01-01

### Open decisions

- fenced-should-not-appear
```

## Cross-Review — 2026-09-29

### Open decisions

- cross-open-item
EOF

OD_OUT="$(
  cd "$REPO"
  "$ATRY" status "$RUN_OD" 2>/dev/null
)"
if printf '%s\n' "$OD_OUT" | grep -q 'real-open-item should appear'; then
  pass "status extracts unfenced open decisions"
else
  fail "missing unfenced open decision"
fi
if printf '%s\n' "$OD_OUT" | grep -q 'fenced-should-not-appear'; then
  fail "status leaked fenced open decision"
else
  pass "status ignores fenced open decisions"
fi
if printf '%s\n' "$OD_OUT" | grep -q 'cross-open-item'; then
  pass "status extracts Cross-Review open decisions"
else
  fail "missing cross-review open decision"
fi

# Independence warnings
RUN_IND="$(new_run 1790888007 cockpit-ind)"
cat >"$RUN_IND/history.log" <<EOF
2026-09-29T10:00:00Z stage=plan action=created tool=cursor
2026-09-29T10:01:00Z stage=implement action=started tool=cursor
2026-09-29T10:02:00Z stage=implement action=completed tool=cursor
2026-09-29T10:03:00Z stage=self-review action=started tool=cursor
2026-09-29T10:04:00Z stage=self-review action=completed tool=cursor
2026-09-29T10:05:00Z stage=cross-review action=started tool=cursor
2026-09-29T10:06:00Z stage=cross-review action=completed tool=cursor
EOF
cat >"$RUN_IND/review-report.md" <<'EOF'
## Self-Review — 2026-09-29

<!-- relay: stage=self-review tool=cursor model=same-model base=x date=2026-09-29 -->

## Cross-Review — 2026-09-29

<!-- relay: stage=cross-review tool=cursor model=same-model base=x date=2026-09-29 -->
EOF
IND_OUT="$(
  cd "$REPO"
  "$ATRY" status "$RUN_IND" 2>/dev/null
)"
if printf '%s\n' "$IND_OUT" | grep -q 'implement tool == cross-review tool'; then
  pass "status warns implement == cross-review tool"
else
  fail "missing implement/cross-review tool warning"
fi
if printf '%s\n' "$IND_OUT" | grep -q 'self-review tool+model == cross-review'; then
  pass "status warns self-review == cross-review tool+model"
else
  fail "missing self-review/cross-review warning"
fi
if printf '%s\n' "$IND_OUT" | grep -q 'next: atry-distill or atry close'; then
  pass "status next step after cross-review"
else
  fail "wrong next step after cross-review: $IND_OUT"
fi

# Restarted stage: latest non-attested tool wins (not first-seen)
RUN_LATEST="$(new_run 1790888009 cockpit-latest)"
cat >"$RUN_LATEST/history.log" <<EOF
2026-09-29T10:00:00Z stage=plan action=created tool=claude-cowork
2026-09-29T10:01:00Z stage=plan action=completed tool=claude-cowork
2026-09-29T10:02:00Z stage=implement action=started tool=cursor
2026-09-29T10:03:00Z stage=implement action=completed tool=cursor
2026-09-29T10:04:00Z stage=self-review action=started tool=claude-cowork
2026-09-29T10:05:00Z stage=self-review action=started tool=antigravity
2026-09-29T10:06:00Z stage=self-review action=completed tool=antigravity
EOF
cat >"$RUN_LATEST/plan.md" <<'EOF'
<!-- relay: stage=plan tool=claude-cowork model=plan-model base=x date=2026-09-29 -->
EOF
cat >"$RUN_LATEST/review-report.md" <<'EOF'
## Self-Review — 2026-09-29

<!-- relay: stage=self-review tool=antigravity model=latest-sr-model base=x date=2026-09-29 -->
EOF
LATEST_OUT="$(
  cd "$REPO"
  "$ATRY" status "$RUN_LATEST" 2>/dev/null
)"
if printf '%s\n' "$LATEST_OUT" | grep -q 'self-review   tool=antigravity'; then
  pass "status uses latest self-review tool after restart"
else
  fail "status should show antigravity not first-seen claude-cowork: $LATEST_OUT"
fi
if printf '%s\n' "$LATEST_OUT" | grep -q 'plan          tool=claude-cowork  model=plan-model'; then
  pass "status shows plan self-report tool and provenance model"
else
  fail "status missing plan tool/model: $LATEST_OUT"
fi
if printf '%s\n' "$LATEST_OUT" | grep -q 'model=latest-sr-model'; then
  pass "status shows latest self-review provenance model"
else
  fail "status missing latest sr model: $LATEST_OUT"
fi

# ---------- attested metrics ----------
RUN_M="$(new_run 1790888008 cockpit-metrics)"
cat >"$RUN_M/plan.md" <<EOF
base: $BASE
id: 1790888008

# Metrics stamp fixture

## Tasks

1. One (deps: )
EOF
cat >"$RUN_M/history.log" <<EOF
2026-09-29T10:00:00Z stage=plan action=created tool=cursor
2026-09-29T10:01:00Z stage=implement action=started tool=cursor
2026-09-29T10:30:00Z stage=implement action=completed tool=cursor
2026-09-29T10:31:00Z stage=implement action=attested by=human tool=human-tool model=human-model
2026-09-29T10:32:00Z stage=self-review action=started tool=cursor
2026-09-29T10:40:00Z stage=self-review action=completed tool=cursor
EOF
cat >"$RUN_M/implement-report.md" <<'EOF'
<!-- relay: stage=implement tool=cursor model=self-model base=x date=2026-09-29 -->
EOF
cat >"$RUN_M/review-report.md" <<'EOF'
## Self-Review — 2026-09-29

<!-- relay: stage=self-review tool=cursor model=sr-model base=x date=2026-09-29 -->
EOF

MET_OUT="$(
  cd "$REPO"
  "$ATRY" metrics "$RUN_M" 2>/dev/null
)"
tool_i="$(printf '%s\n' "$MET_OUT" | sed -n 's/^tool_implement:[[:space:]]*//p' | head -1)"
model_i="$(printf '%s\n' "$MET_OUT" | sed -n 's/^model_implement:[[:space:]]*//p' | head -1)"
msrc="$(printf '%s\n' "$MET_OUT" | sed -n 's/^model_source:[[:space:]]*//p' | head -1)"
if [[ "$tool_i" == "human-tool" ]]; then
  pass "metrics prefers attested tool_implement"
else
  fail "tool_implement=$tool_i want human-tool"
fi
if [[ "$model_i" == "human-model" ]]; then
  pass "metrics prefers attested model_implement"
else
  fail "model_implement=$model_i want human-model"
fi
if [[ "$msrc" == "mixed" ]]; then
  pass "metrics model_source=mixed when some stages attested"
else
  fail "model_source=$msrc want mixed"
fi

# All measured stages attested → human-attested
(
  cd "$REPO"
  "$ATRY" stamp "$RUN_M" self-review tool=human-sr model=human-sr-model
) >/dev/null
MET2="$(
  cd "$REPO"
  "$ATRY" metrics "$RUN_M" 2>/dev/null
)"
msrc2="$(printf '%s\n' "$MET2" | sed -n 's/^model_source:[[:space:]]*//p' | head -1)"
if [[ "$msrc2" == "human-attested" ]]; then
  pass "metrics model_source=human-attested when all measured attested"
else
  fail "model_source=$msrc2 want human-attested"
fi

# ---------- dispatcher ----------
HELP_OUT="$("$ATRY" -h 2>&1 || true)"
if printf '%s\n' "$HELP_OUT" | grep -q 'atry status'; then
  pass "atry usage lists status"
else
  fail "atry usage missing status"
fi
if printf '%s\n' "$HELP_OUT" | grep -q 'atry approve'; then
  pass "atry usage lists approve"
else
  fail "atry usage missing approve"
fi

if [[ "$FAIL" -ne 0 ]]; then
  echo "status suite: $FAIL failure(s)"
  exit 1
fi
echo "status suite: all passed"
