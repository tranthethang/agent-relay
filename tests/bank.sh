#!/usr/bin/env bash
# Offline checks for the optional knowledge-bank helpers (bash 3.2+):
#   atry bank check|push  (scripts/runtime/bank-*.sh)
# Run from repo root:
#   ./tests/bank.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ATRY="$ROOT/scripts/atry"
bank_check() { "$ATRY" bank check "$@"; }
bank_push() { "$ATRY" bank push "$@"; }
BANK_CHECK=bank_check
BANK_PUSH=bank_push

FAIL=0
pass() { echo "PASS: $1"; }
fail() {
  echo "FAIL: $1"
  FAIL=1
}

T="$(mktemp -d "${TMPDIR:-/tmp}/ar-bank.XXXXXX")"
cleanup() { rm -rf "$T"; }
trap cleanup EXIT

REPO="$T/repo"
VAULT="$T/vault"
mkdir -p "$REPO" "$VAULT"
git -C "$REPO" init -q

field() { sed -n "s/^${2}: //p" "$1" | head -1; }

# --- static regression: no declare -A (bash 4+ feature) in bank-check.sh ---
if grep -q 'declare -A' "$BANK_CHECK"; then
  fail "bank-check.sh contains declare -A (bash 4+ feature)"
else
  pass "bank-check.sh does not use declare -A (bash 3.2 compatible)"
fi

# --- no .agent-relay/ and no git repo above start-dir: skipped, exit 2 ---
NOWHERE="$T/nowhere"
mkdir -p "$NOWHERE"
set +e
"$BANK_CHECK" "$NOWHERE" >/dev/null 2>/dev/null
rc=$?
set -e
[[ "$rc" -eq 2 ]] && pass "bank-check exits 2 with no .agent-relay/ or git repo" || fail "bank-check exits 2 with no .agent-relay/ or git repo (got $rc)"
[[ ! -e "$NOWHERE/.agent-relay" ]] && pass "bank-check does not create .agent-relay/ when not found" || fail "bank-check does not create .agent-relay/ when not found"

set +e
"$BANK_PUSH" "$NOWHERE" some-run "Some Title" - <<<"body" >/dev/null 2>/dev/null
rc=$?
set -e
[[ "$rc" -eq 2 ]] && pass "bank-push exits 2 with no .agent-relay/ or git repo" || fail "bank-push exits 2 with no .agent-relay/ or git repo (got $rc)"

# --- no bank.conf: "not configured" is a normal outcome, exit 0 ---
if "$BANK_CHECK" "$REPO" >/dev/null; then
  pass "bank-check exits 0 with no bank.conf"
else
  fail "bank-check exits 0 with no bank.conf"
fi
STATUS="$REPO/.agent-relay/bank-status.md"
[[ "$(field "$STATUS" configured)" == "false" ]] && pass "configured: false with no bank.conf" || fail "configured: false with no bank.conf"

# --- valid obsidian-vault, reachable ---
mkdir -p "$REPO/.agent-relay"
cat >"$REPO/.agent-relay/bank.conf" <<EOF
BANK_TYPE=obsidian-vault
BANK_PATH=$VAULT
EOF
"$BANK_CHECK" "$REPO" >/dev/null
[[ "$(field "$STATUS" reachable)" == "true" ]] && pass "reachable: true for existing writable vault path" || fail "reachable: true for existing writable vault path"
[[ "$(field "$STATUS" bank_type)" == "obsidian-vault" ]] && pass "bank_type recorded" || fail "bank_type recorded"

# --- obsidian-vault, path does not exist ---
cat >"$REPO/.agent-relay/bank.conf" <<EOF
BANK_TYPE=obsidian-vault
BANK_PATH=$T/does-not-exist
EOF
"$BANK_CHECK" "$REPO" >/dev/null
[[ "$(field "$STATUS" reachable)" == "false" ]] && pass "reachable: false for missing vault path" || fail "reachable: false for missing vault path"

# --- reserved backend types: recorded, not implemented, never "reachable" ---
cat >"$REPO/.agent-relay/bank.conf" <<EOF
BANK_TYPE=lightrag-http
BANK_ENDPOINT=http://127.0.0.1:9999
EOF
"$BANK_CHECK" "$REPO" >/dev/null
[[ "$(field "$STATUS" reachable)" == "false" ]] && pass "lightrag-http recorded as not reachable (no driver)" || fail "lightrag-http recorded as not reachable (no driver)"
[[ "$(field "$STATUS" configured)" == "true" ]] && pass "lightrag-http still counts as configured" || fail "lightrag-http still counts as configured"
[[ "$(field "$STATUS" bank_endpoint)" == "http://127.0.0.1:9999" ]] && pass "lightrag-http bank_endpoint recorded" || fail "lightrag-http bank_endpoint recorded"
[[ -z "$(field "$STATUS" bank_path)" ]] && pass "lightrag-http bank_path is empty" || fail "lightrag-http bank_path is empty"

# --- malformed bank.conf: refuse, do not guess ---
cat >"$REPO/.agent-relay/bank.conf" <<'EOF'
BANK_TYPE=obsidian-vault
BANK_PATH=$(rm -rf /)
EOF
if "$BANK_CHECK" "$REPO" >/dev/null 2>&1; then
  fail "bank-check rejects command substitution in bank.conf"
else
  pass "bank-check rejects command substitution in bank.conf"
fi

# --- root-cause regression: a malformed bank.conf must not leave a stale
# "reachable: true" from a prior good check. Go from a genuinely reachable
# config straight to a malformed one and confirm the status flips to false
# rather than being left untouched. ---
cat >"$REPO/.agent-relay/bank.conf" <<EOF
BANK_TYPE=obsidian-vault
BANK_PATH=$VAULT
EOF
"$BANK_CHECK" "$REPO" >/dev/null
[[ "$(field "$STATUS" reachable)" == "true" ]] && pass "precondition: reachable true before breaking bank.conf" || fail "precondition: reachable true before breaking bank.conf"
cat >"$REPO/.agent-relay/bank.conf" <<'EOF'
BANK_TYPE=obsidian-vault
BANK_PATH=$(rm -rf /)
EOF
set +e
"$BANK_CHECK" "$REPO" >/dev/null 2>&1
MALFORMED_RC=$?
set -e
[[ "$MALFORMED_RC" -eq 1 ]] && pass "bank-check still exits 1 on malformed bank.conf" || fail "bank-check still exits 1 on malformed bank.conf (got $MALFORMED_RC)"
[[ "$(field "$STATUS" reachable)" == "false" ]] && pass "malformed bank.conf flips stale reachable:true to false" || fail "malformed bank.conf flips stale reachable:true to false"
[[ "$(field "$STATUS" configured)" == "true" ]] && pass "malformed bank.conf still records configured:true" || fail "malformed bank.conf still records configured:true"
echo "$(field "$STATUS" detail)" | grep -q "malformed" && pass "malformed bank.conf detail explains why" || fail "malformed bank.conf detail explains why"

cat >"$REPO/.agent-relay/bank.conf" <<'EOF'
this is not a key=value line
EOF
if "$BANK_CHECK" "$REPO" >/dev/null 2>&1; then
  fail "bank-check rejects a non BANK_KEY=value line"
else
  pass "bank-check rejects a non BANK_KEY=value line"
fi

# --- comment / blank-line handling: a key line must never be silently
# swallowed as a comment just because it contains a '#'. Indented keys are a
# hard refusal; only blank lines and whole-line comments are skipped. ---
cat >"$REPO/.agent-relay/bank.conf" <<EOF
# leading comment
   # indented comment

BANK_TYPE=obsidian-vault
BANK_PATH=$VAULT
EOF
"$BANK_CHECK" "$REPO" >/dev/null
[[ "$(field "$STATUS" reachable)" == "true" ]] && pass "blank lines and whole-line comments are skipped" || fail "blank lines and whole-line comments are skipped"
[[ "$(field "$STATUS" bank_path)" == "$VAULT" ]] && pass "bank_path survives comment/blank lines" || fail "bank_path survives comment/blank lines"

cat >"$REPO/.agent-relay/bank.conf" <<EOF
BANK_TYPE=obsidian-vault
  BANK_PATH=$VAULT  # inline note
EOF
set +e
"$BANK_CHECK" "$REPO" >/dev/null 2>&1
INDENT_RC=$?
set -e
[[ "$INDENT_RC" -eq 1 ]] && pass "indented key line containing '#' is refused, not silently dropped" || fail "indented key line containing '#' is refused, not silently dropped (got $INDENT_RC)"
[[ "$(field "$STATUS" reachable)" == "false" ]] && pass "refused indented key line records reachable: false" || fail "refused indented key line records reachable: false"

# --- bank-push.sh: pushes when reachable ---
cat >"$REPO/.agent-relay/bank.conf" <<EOF
BANK_TYPE=obsidian-vault
BANK_PATH=$VAULT
EOF
"$BANK_CHECK" "$REPO" >/dev/null
if echo "a distilled lesson" | "$BANK_PUSH" "$REPO" "1758096000-demo" "Test lesson" - >/dev/null; then
  pass "bank-push exits 0 when reachable"
else
  fail "bank-push exits 0 when reachable"
fi
PUSHED_FILE="$VAULT/agent-relay/$(date +%Y%m%d)-1758096000-demo-test-lesson.md"
[[ -f "$PUSHED_FILE" ]] && pass "bank-push writes the expected note path" || fail "bank-push writes the expected note path"
grep -q "a distilled lesson" "$PUSHED_FILE" 2>/dev/null && pass "bank-push note contains the body" || fail "bank-push note contains the body"

# --- bank-push.sh: refuses (exit 2) when not reachable ---
cat >"$REPO/.agent-relay/bank.conf" <<EOF
BANK_TYPE=obsidian-vault
BANK_PATH=$T/does-not-exist
EOF
"$BANK_CHECK" "$REPO" >/dev/null
set +e
echo "x" | "$BANK_PUSH" "$REPO" "1758096000-demo2" "Should not push" - >/dev/null 2>&1
PUSH_RC=$?
set -e
[[ "$PUSH_RC" -eq 2 ]] && pass "bank-push exits 2 when not reachable" || fail "bank-push exits 2 when not reachable (got $PUSH_RC)"

# --- bank.conf: BANK_TYPE present but empty value ---
cat >"$REPO/.agent-relay/bank.conf" <<EOF
BANK_TYPE=
BANK_PATH=$VAULT
EOF
"$BANK_CHECK" "$REPO" >/dev/null
[[ "$(field "$STATUS" configured)" == "true" ]] && pass "configured: true for empty BANK_TYPE" || fail "configured: true for empty BANK_TYPE"
[[ "$(field "$STATUS" reachable)" == "false" ]] && pass "reachable: false for empty BANK_TYPE" || fail "reachable: false for empty BANK_TYPE"
[[ -z "$(field "$STATUS" bank_type)" ]] && pass "bank_type is empty for empty BANK_TYPE" || fail "bank_type is empty for empty BANK_TYPE"

# --- bank.conf: only BANK_PATH and no BANK_TYPE ---
cat >"$REPO/.agent-relay/bank.conf" <<EOF
BANK_PATH=$VAULT
EOF
"$BANK_CHECK" "$REPO" >/dev/null
[[ "$(field "$STATUS" configured)" == "true" ]] && pass "configured: true when BANK_TYPE missing" || fail "configured: true when BANK_TYPE missing"
[[ "$(field "$STATUS" reachable)" == "false" ]] && pass "reachable: false when BANK_TYPE missing" || fail "reachable: false when BANK_TYPE missing"
echo "$(field "$STATUS" detail)" | grep -q "no BANK_TYPE" && pass "detail mentions no BANK_TYPE" || fail "detail mentions no BANK_TYPE"

# --- bank-push.sh: re-pushing overwrites existing note for same run/title ---
cat >"$REPO/.agent-relay/bank.conf" <<EOF
BANK_TYPE=obsidian-vault
BANK_PATH=$VAULT
EOF
"$BANK_CHECK" "$REPO" >/dev/null
echo "original content" | "$BANK_PUSH" "$REPO" "1758096000-overwrite" "Overwrite Test" - >/dev/null
echo "updated content" | "$BANK_PUSH" "$REPO" "1758096000-overwrite" "Overwrite Test" - >/dev/null
OVERWRITE_FILE="$VAULT/agent-relay/$(date +%Y%m%d)-1758096000-overwrite-overwrite-test.md"
[[ -f "$OVERWRITE_FILE" ]] && pass "re-push writes note" || fail "re-push writes note"
grep -q "updated content" "$OVERWRITE_FILE" && pass "re-push overwrote content" || fail "re-push overwrote content"
! grep -q "original content" "$OVERWRITE_FILE" && pass "original content not retained in re-push" || fail "original content not retained in re-push"

# --- bank-push.sh: refuses (exit 1) with no bank-status.md at all ---
REPO2="$T/repo2"
mkdir -p "$REPO2"
git -C "$REPO2" init -q
set +e
echo "x" | "$BANK_PUSH" "$REPO2" "1758096000-demo3" "No status file" - >/dev/null 2>&1
PUSH_RC2=$?
set -e
[[ "$PUSH_RC2" -eq 1 ]] && pass "bank-push exits 1 with no bank-status.md" || fail "bank-push exits 1 with no bank-status.md (got $PUSH_RC2)"

if [[ "$FAIL" -eq 0 ]]; then
  echo "ALL BANK TESTS PASSED"
else
  echo "SOME FAILURES"
  exit 1
fi
