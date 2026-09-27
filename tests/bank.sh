#!/usr/bin/env bash
# Offline checks for the optional knowledge-bank helpers (bash 3.2+):
#   atry bank check|push|set-status  (scripts/runtime/bank-*.sh)
# Run from repo root:
#   ./tests/bank.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ATRY="$ROOT/scripts/atry"
BANK_CHECK_SH="$ROOT/scripts/runtime/bank-check.sh"
BANK_PUSH_SH="$ROOT/scripts/runtime/bank-push.sh"
BANK_SET_STATUS_SH="$ROOT/scripts/runtime/bank-set-status.sh"
bank_check() { "$ATRY" bank check "$@"; }
bank_push() { "$ATRY" bank push "$@"; }
bank_set_status() { "$ATRY" bank set-status "$@"; }

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

# --- static regression: no declare -A (bash 4+ feature) in bank scripts ---
for sh in "$BANK_CHECK_SH" "$BANK_PUSH_SH" "$BANK_SET_STATUS_SH"; do
  if grep -q 'declare -A' "$sh"; then
    fail "$(basename "$sh") contains declare -A (bash 4+ feature)"
  else
    pass "$(basename "$sh") does not use declare -A (bash 3.2 compatible)"
  fi
done

# --- no .agent-relay/ and no git repo above start-dir: skipped, exit 2 ---
NOWHERE="$T/nowhere"
mkdir -p "$NOWHERE"
set +e
bank_check "$NOWHERE" >/dev/null 2>/dev/null
rc=$?
set -e
[[ "$rc" -eq 2 ]] && pass "bank-check exits 2 with no .agent-relay/ or git repo" || fail "bank-check exits 2 with no .agent-relay/ or git repo (got $rc)"
[[ ! -e "$NOWHERE/.agent-relay" ]] && pass "bank-check does not create .agent-relay/ when not found" || fail "bank-check does not create .agent-relay/ when not found"

mkdir -p "$T/empty-notes"
set +e
bank_push "$NOWHERE" "$T/empty-notes" >/dev/null 2>/dev/null
rc=$?
set -e
[[ "$rc" -eq 2 ]] && pass "bank-push exits 2 with no .agent-relay/ or git repo" || fail "bank-push exits 2 with no .agent-relay/ or git repo (got $rc)"

# --- no bank.conf: "not configured" is a normal outcome, exit 0 ---
if bank_check "$REPO" >/dev/null; then
  pass "bank-check exits 0 with no bank.conf"
else
  fail "bank-check exits 0 with no bank.conf"
fi
STATUS="$REPO/.agent-relay/bank-status.md"
[[ "$(field "$STATUS" configured)" == "false" ]] && pass "configured: false with no bank.conf" || fail "configured: false with no bank.conf"
[[ "$(field "$STATUS" project_source)" == "none" ]] && pass "project_source: none with no bank.conf" || fail "project_source: none with no bank.conf"

# --- valid obsidian-vault, reachable; project name unset ---
mkdir -p "$REPO/.agent-relay"
cat >"$REPO/.agent-relay/bank.conf" <<EOF
BANK_TYPE=obsidian-vault
BANK_PATH=$VAULT
EOF
bank_check "$REPO" >/dev/null
[[ "$(field "$STATUS" reachable)" == "true" ]] && pass "reachable: true for existing writable vault path" || fail "reachable: true for existing writable vault path"
[[ "$(field "$STATUS" bank_type)" == "obsidian-vault" ]] && pass "bank_type recorded" || fail "bank_type recorded"
[[ "$(field "$STATUS" project_source)" == "none" ]] && pass "project_source: none when BANK_PROJECT_NAME unset" || fail "project_source: none when BANK_PROJECT_NAME unset"
[[ -z "$(field "$STATUS" project_name)" ]] && pass "project_name empty when unset" || fail "project_name empty when unset"

# --- BANK_PROJECT_NAME valid ---
cat >"$REPO/.agent-relay/bank.conf" <<EOF
BANK_TYPE=obsidian-vault
BANK_PATH=$VAULT
BANK_PROJECT_NAME=agent-relay
EOF
bank_check "$REPO" >/dev/null
[[ "$(field "$STATUS" project_name)" == "agent-relay" ]] && pass "project_name from BANK_PROJECT_NAME" || fail "project_name from BANK_PROJECT_NAME"
[[ "$(field "$STATUS" project_source)" == "config" ]] && pass "project_source: config when set" || fail "project_source: config when set"
[[ "$(field "$STATUS" reachable)" == "true" ]] && pass "reachable with valid BANK_PROJECT_NAME" || fail "reachable with valid BANK_PROJECT_NAME"

# --- BANK_PROJECT_NAME invalid: malformed exit 1 ---
cat >"$REPO/.agent-relay/bank.conf" <<EOF
BANK_TYPE=obsidian-vault
BANK_PATH=$VAULT
BANK_PROJECT_NAME=Bad_Name
EOF
set +e
bank_check "$REPO" >/dev/null 2>&1
INV_RC=$?
set -e
[[ "$INV_RC" -eq 1 ]] && pass "invalid BANK_PROJECT_NAME exits 1" || fail "invalid BANK_PROJECT_NAME exits 1 (got $INV_RC)"
[[ "$(field "$STATUS" reachable)" == "false" ]] && pass "invalid BANK_PROJECT_NAME records reachable: false" || fail "invalid BANK_PROJECT_NAME records reachable: false"

# --- path normalization: strip trailing slash ---
cat >"$REPO/.agent-relay/bank.conf" <<EOF
BANK_TYPE=obsidian-vault
BANK_PATH=$VAULT/
BANK_PROJECT_NAME=agent-relay
EOF
bank_check "$REPO" >/dev/null
[[ "$(field "$STATUS" bank_path)" == "$VAULT" ]] && pass "BANK_PATH trailing slash stripped" || fail "BANK_PATH trailing slash stripped (got '$(field "$STATUS" bank_path)')"

# --- no-create: bank-check does not create BANK_PATH ---
MISSING="$T/missing-vault"
cat >"$REPO/.agent-relay/bank.conf" <<EOF
BANK_TYPE=obsidian-vault
BANK_PATH=$MISSING
EOF
bank_check "$REPO" >/dev/null
[[ ! -e "$MISSING" ]] && pass "bank-check does not create missing BANK_PATH" || fail "bank-check does not create missing BANK_PATH"
[[ "$(field "$STATUS" reachable)" == "false" ]] && pass "reachable: false for missing vault path" || fail "reachable: false for missing vault path"

# --- reserved backend: lightrag-http only (agentmemory-cli dropped) ---
cat >"$REPO/.agent-relay/bank.conf" <<EOF
BANK_TYPE=lightrag-http
BANK_ENDPOINT=http://127.0.0.1:9999
EOF
bank_check "$REPO" >/dev/null
[[ "$(field "$STATUS" reachable)" == "false" ]] && pass "lightrag-http recorded as not reachable (no driver)" || fail "lightrag-http recorded as not reachable (no driver)"
[[ "$(field "$STATUS" configured)" == "true" ]] && pass "lightrag-http still counts as configured" || fail "lightrag-http still counts as configured"
[[ "$(field "$STATUS" bank_endpoint)" == "http://127.0.0.1:9999" ]] && pass "lightrag-http bank_endpoint recorded" || fail "lightrag-http bank_endpoint recorded"

cat >"$REPO/.agent-relay/bank.conf" <<EOF
BANK_TYPE=agentmemory-cli
EOF
bank_check "$REPO" >/dev/null
echo "$(field "$STATUS" detail)" | grep -q "unknown BANK_TYPE" && pass "agentmemory-cli treated as unknown BANK_TYPE" || fail "agentmemory-cli treated as unknown BANK_TYPE"

# --- malformed bank.conf: refuse, do not guess ---
cat >"$REPO/.agent-relay/bank.conf" <<'EOF'
BANK_TYPE=obsidian-vault
BANK_PATH=$(rm -rf /)
EOF
if bank_check "$REPO" >/dev/null 2>&1; then
  fail "bank-check rejects command substitution in bank.conf"
else
  pass "bank-check rejects command substitution in bank.conf"
fi

# --- root-cause regression: malformed must flip stale reachable:true ---
cat >"$REPO/.agent-relay/bank.conf" <<EOF
BANK_TYPE=obsidian-vault
BANK_PATH=$VAULT
BANK_PROJECT_NAME=agent-relay
EOF
bank_check "$REPO" >/dev/null
[[ "$(field "$STATUS" reachable)" == "true" ]] && pass "precondition: reachable true before breaking bank.conf" || fail "precondition: reachable true before breaking bank.conf"
cat >"$REPO/.agent-relay/bank.conf" <<'EOF'
BANK_TYPE=obsidian-vault
BANK_PATH=$(rm -rf /)
EOF
set +e
bank_check "$REPO" >/dev/null 2>&1
MALFORMED_RC=$?
set -e
[[ "$MALFORMED_RC" -eq 1 ]] && pass "bank-check still exits 1 on malformed bank.conf" || fail "bank-check still exits 1 on malformed bank.conf (got $MALFORMED_RC)"
[[ "$(field "$STATUS" reachable)" == "false" ]] && pass "malformed bank.conf flips stale reachable:true to false" || fail "malformed bank.conf flips stale reachable:true to false"
[[ "$(field "$STATUS" configured)" == "true" ]] && pass "malformed bank.conf still records configured:true" || fail "malformed bank.conf still records configured:true"
echo "$(field "$STATUS" detail)" | grep -q "malformed" && pass "malformed bank.conf detail explains why" || fail "malformed bank.conf detail explains why"

cat >"$REPO/.agent-relay/bank.conf" <<'EOF'
this is not a key=value line
EOF
if bank_check "$REPO" >/dev/null 2>&1; then
  fail "bank-check rejects a non BANK_KEY=value line"
else
  pass "bank-check rejects a non BANK_KEY=value line"
fi

# --- comment / blank-line handling ---
cat >"$REPO/.agent-relay/bank.conf" <<EOF
# leading comment
   # indented comment

BANK_TYPE=obsidian-vault
BANK_PATH=$VAULT
BANK_PROJECT_NAME=agent-relay
EOF
bank_check "$REPO" >/dev/null
[[ "$(field "$STATUS" reachable)" == "true" ]] && pass "blank lines and whole-line comments are skipped" || fail "blank lines and whole-line comments are skipped"
[[ "$(field "$STATUS" bank_path)" == "$VAULT" ]] && pass "bank_path survives comment/blank lines" || fail "bank_path survives comment/blank lines"

cat >"$REPO/.agent-relay/bank.conf" <<EOF
BANK_TYPE=obsidian-vault
  BANK_PATH=$VAULT  # inline note
EOF
set +e
bank_check "$REPO" >/dev/null 2>&1
INDENT_RC=$?
set -e
[[ "$INDENT_RC" -eq 1 ]] && pass "indented key line containing '#' is refused, not silently dropped" || fail "indented key line containing '#' is refused, not silently dropped (got $INDENT_RC)"
[[ "$(field "$STATUS" reachable)" == "false" ]] && pass "refused indented key line records reachable: false" || fail "refused indented key line records reachable: false"

# --- helper: write a minimal valid note ---
write_note() {
  local dest="$1" type="$2" project="${3:-}"
  local status_line=""
  case "$type" in
  run) status_line="" ;;
  decision | convention | process) status_line="status: active" ;;
  pitfall | open-item) status_line="status: open" ;;
  esac
  {
    printf -- '---\n'
    printf 'type: %s\n' "$type"
    if [[ -n "$project" ]]; then
      printf 'project: %s\n' "$project"
    fi
    if [[ "$type" != "run" ]]; then
      printf 'key: sample-key\n'
      printf '%s\n' "$status_line"
    fi
    printf 'date: 2026-09-27\n'
    printf -- '---\n\n'
    printf '## Body\n\nunchanged-body-marker\n'
  } >"$dest"
}

NOTES="$T/notes"
mkdir -p "$NOTES"
YMD=20260927
RID=1790505168
RUN_NOTE="${YMD}-${RID}-bank-flat-push.md"
DEC_NOTE="${YMD}-${RID}-choose-flat-layout.md"

# --- bank-push: flat layout when reachable ---
cat >"$REPO/.agent-relay/bank.conf" <<EOF
BANK_TYPE=obsidian-vault
BANK_PATH=$VAULT
BANK_PROJECT_NAME=agent-relay
EOF
bank_check "$REPO" >/dev/null
rm -f "$VAULT"/*.md
write_note "$NOTES/$RUN_NOTE" run agent-relay
write_note "$NOTES/$DEC_NOTE" decision agent-relay
if bank_push "$REPO" "$NOTES" >/dev/null; then
  pass "bank-push exits 0 when reachable"
else
  fail "bank-push exits 0 when reachable"
fi
[[ -f "$VAULT/$RUN_NOTE" ]] && pass "bank-push writes flat run note" || fail "bank-push writes flat run note"
[[ -f "$VAULT/$DEC_NOTE" ]] && pass "bank-push writes flat decision note" || fail "bank-push writes flat decision note"
[[ ! -d "$VAULT/agent-relay" ]] && pass "bank-push does not create agent-relay/ subfolder" || fail "bank-push does not create agent-relay/ subfolder"
grep -q "unchanged-body-marker" "$VAULT/$DEC_NOTE" && pass "bank-push preserves note body" || fail "bank-push preserves note body"
! grep -q '^# ' "$VAULT/$DEC_NOTE" && pass "bank-push does not inject H1 title" || fail "bank-push does not inject H1 title"

# --- bank-push: no-create under BANK_PATH (missing path → exit 2, no mkdir) ---
cat >"$REPO/.agent-relay/bank.conf" <<EOF
BANK_TYPE=obsidian-vault
BANK_PATH=$T/does-not-exist
EOF
bank_check "$REPO" >/dev/null
set +e
bank_push "$REPO" "$NOTES" >/dev/null 2>&1
PUSH_RC=$?
set -e
[[ "$PUSH_RC" -eq 2 ]] && pass "bank-push exits 2 when not reachable" || fail "bank-push exits 2 when not reachable (got $PUSH_RC)"
[[ ! -e "$T/does-not-exist" ]] && pass "bank-push does not create BANK_PATH" || fail "bank-push does not create BANK_PATH"

# --- bank-push: refuse bad filename / bad type (nothing written) ---
cat >"$REPO/.agent-relay/bank.conf" <<EOF
BANK_TYPE=obsidian-vault
BANK_PATH=$VAULT
BANK_PROJECT_NAME=agent-relay
EOF
bank_check "$REPO" >/dev/null
BAD_NOTES="$T/bad-notes"
mkdir -p "$BAD_NOTES"
write_note "$BAD_NOTES/$RUN_NOTE" run agent-relay
{
  echo '---'
  echo 'type: run'
  echo '---'
  echo body
} >"$BAD_NOTES/not-a-valid-name.md"
BEFORE_COUNT="$(find "$VAULT" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')"
set +e
bank_push "$REPO" "$BAD_NOTES" >/dev/null 2>&1
BAD_RC=$?
set -e
[[ "$BAD_RC" -eq 1 ]] && pass "bank-push refuses invalid filename" || fail "bank-push refuses invalid filename (got $BAD_RC)"
AFTER_COUNT="$(find "$VAULT" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')"
[[ "$BEFORE_COUNT" == "$AFTER_COUNT" ]] && pass "refused push writes nothing" || fail "refused push writes nothing"

# short slug (2 chars) matches the loose pattern but violates length 3–48
SHORT_NOTES="$T/short-slug"
mkdir -p "$SHORT_NOTES"
{
  echo '---'
  echo 'type: run'
  echo 'date: 2026-09-27'
  echo '---'
  echo body
} >"$SHORT_NOTES/${YMD}-${RID}-ab.md"
BEFORE_COUNT="$(find "$VAULT" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')"
set +e
bank_push "$REPO" "$SHORT_NOTES" >/dev/null 2>&1
SHORT_RC=$?
set -e
[[ "$SHORT_RC" -eq 1 ]] && pass "bank-push refuses slug shorter than 3" || fail "bank-push refuses slug shorter than 3 (got $SHORT_RC)"
AFTER_COUNT="$(find "$VAULT" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')"
[[ "$BEFORE_COUNT" == "$AFTER_COUNT" ]] && pass "short-slug refuse writes nothing" || fail "short-slug refuse writes nothing"

BAD_TYPE="$T/bad-type"
mkdir -p "$BAD_TYPE"
write_note "$BAD_TYPE/$RUN_NOTE" run agent-relay
# overwrite type to illegal value
awk 'BEGIN{c=0} /^---/{c++} c==1 && /^type:/{print "type: agentmemory-cli"; next} {print}' "$BAD_TYPE/$RUN_NOTE" >"$BAD_TYPE/tmp" && mv "$BAD_TYPE/tmp" "$BAD_TYPE/$RUN_NOTE"
set +e
bank_push "$REPO" "$BAD_TYPE" >/dev/null 2>&1
BTYPE_RC=$?
set -e
[[ "$BTYPE_RC" -eq 1 ]] && pass "bank-push refuses unknown type" || fail "bank-push refuses unknown type (got $BTYPE_RC)"

# frontmatter must open on line 1 (Obsidian ignores it otherwise)
LATE_FM="$T/late-fm"
mkdir -p "$LATE_FM"
write_note "$LATE_FM/$RUN_NOTE" run agent-relay
{
  printf '<!-- relay: stage=distill -->\n'
  cat "$LATE_FM/$RUN_NOTE"
} >"$LATE_FM/tmp" && mv "$LATE_FM/tmp" "$LATE_FM/$RUN_NOTE"
BEFORE_COUNT="$(find "$VAULT" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')"
set +e
bank_push "$REPO" "$LATE_FM" >/dev/null 2>&1
LATE_RC=$?
set -e
[[ "$LATE_RC" -eq 1 ]] && pass "bank-push refuses frontmatter not on line 1" || fail "bank-push refuses frontmatter not on line 1 (got $LATE_RC)"
AFTER_COUNT="$(find "$VAULT" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')"
[[ "$BEFORE_COUNT" == "$AFTER_COUNT" ]] && pass "late-frontmatter refuse writes nothing" || fail "late-frontmatter refuse writes nothing"

# --- orphan warning ---
rm -f "$VAULT"/*.md
write_note "$VAULT/${YMD}-${RID}-old-orphan.md" decision agent-relay
ORPHAN_NOTES="$T/orphan-notes"
mkdir -p "$ORPHAN_NOTES"
write_note "$ORPHAN_NOTES/$RUN_NOTE" run agent-relay
write_note "$ORPHAN_NOTES/$DEC_NOTE" decision agent-relay
set +e
ORPHAN_ERR="$(bank_push "$REPO" "$ORPHAN_NOTES" 2>&1 >/dev/null)"
ORPHAN_RC=$?
set -e
[[ "$ORPHAN_RC" -eq 0 ]] && pass "orphan warning still exits 0" || fail "orphan warning still exits 0 (got $ORPHAN_RC)"
echo "$ORPHAN_ERR" | grep -q "orphan" && pass "orphan warning on stderr" || fail "orphan warning on stderr"
echo "$(field "$STATUS" push_warnings)" | grep -q "orphan:" && pass "orphan listed in bank-status push_warnings" || fail "orphan listed in bank-status push_warnings"

# --- foreign-project warning on check and push ---
rm -f "$VAULT"/*.md
write_note "$VAULT/${YMD}-1790999999-other-proj.md" decision other-project
bank_check "$REPO" >/dev/null 2>"$T/check-warn.txt"
echo "$(field "$STATUS" check_warnings)" | grep -q "foreign-project:" && pass "foreign-project warning in bank-status check_warnings" || fail "foreign-project warning in bank-status check_warnings"
echo "$(field "$STATUS" push_warnings)" | grep -q "orphan:" && pass "bank check keeps push_warnings from last push" || fail "bank check keeps push_warnings from last push"
KEEP_NOTES="$T/keep-notes"
mkdir -p "$KEEP_NOTES"
write_note "$KEEP_NOTES/$RUN_NOTE" run agent-relay
bank_push "$REPO" "$KEEP_NOTES" >/dev/null 2>&1
echo "$(field "$STATUS" check_warnings)" | grep -q "foreign-project:" && pass "bank push keeps check_warnings from last check" || fail "bank push keeps check_warnings from last check"
[[ -z "$(field "$STATUS" push_warnings)" ]] && pass "clean push empties push_warnings" || fail "clean push empties push_warnings (got $(field "$STATUS" push_warnings))"
grep -q "^warnings:" "$STATUS" && fail "legacy warnings: line absent" || pass "legacy warnings: line absent"
grep -q "foreign project" "$T/check-warn.txt" && pass "foreign-project warning on check stderr" || fail "foreign-project warning on check stderr"

rm -f "$VAULT"/*.md
FOREIGN_NOTES="$T/foreign-notes"
mkdir -p "$FOREIGN_NOTES"
write_note "$FOREIGN_NOTES/$RUN_NOTE" run other-project
write_note "$FOREIGN_NOTES/$DEC_NOTE" decision other-project
set +e
FOR_ERR="$(bank_push "$REPO" "$FOREIGN_NOTES" 2>&1 >/dev/null)"
FOR_RC=$?
set -e
[[ "$FOR_RC" -eq 0 ]] && pass "foreign-project on push still exits 0" || fail "foreign-project on push still exits 0 (got $FOR_RC)"
echo "$FOR_ERR" | grep -q "foreign project" && pass "foreign-project warning on push stderr" || fail "foreign-project warning on push stderr"

# --- re-push overwrites same filenames ---
write_note "$FOREIGN_NOTES/$DEC_NOTE" decision agent-relay
# ensure project matches to reduce noise; body unique
printf '\nsecond-push-body\n' >>"$FOREIGN_NOTES/$DEC_NOTE"
bank_push "$REPO" "$FOREIGN_NOTES" >/dev/null
grep -q "second-push-body" "$VAULT/$DEC_NOTE" && pass "re-push overwrites same filename" || fail "re-push overwrites same filename"

# --- bank.conf: BANK_TYPE present but empty value ---
cat >"$REPO/.agent-relay/bank.conf" <<EOF
BANK_TYPE=
BANK_PATH=$VAULT
EOF
bank_check "$REPO" >/dev/null
[[ "$(field "$STATUS" configured)" == "true" ]] && pass "configured: true for empty BANK_TYPE" || fail "configured: true for empty BANK_TYPE"
[[ "$(field "$STATUS" reachable)" == "false" ]] && pass "reachable: false for empty BANK_TYPE" || fail "reachable: false for empty BANK_TYPE"
[[ -z "$(field "$STATUS" bank_type)" ]] && pass "bank_type is empty for empty BANK_TYPE" || fail "bank_type is empty for empty BANK_TYPE"

# --- bank.conf: only BANK_PATH and no BANK_TYPE ---
cat >"$REPO/.agent-relay/bank.conf" <<EOF
BANK_PATH=$VAULT
EOF
bank_check "$REPO" >/dev/null
[[ "$(field "$STATUS" configured)" == "true" ]] && pass "configured: true when BANK_TYPE missing" || fail "configured: true when BANK_TYPE missing"
[[ "$(field "$STATUS" reachable)" == "false" ]] && pass "reachable: false when BANK_TYPE missing" || fail "reachable: false when BANK_TYPE missing"
echo "$(field "$STATUS" detail)" | grep -q "no BANK_TYPE" && pass "detail mentions no BANK_TYPE" || fail "detail mentions no BANK_TYPE"

# --- bank-push exits 1 with no bank-status.md ---
REPO2="$T/repo2"
mkdir -p "$REPO2"
git -C "$REPO2" init -q
set +e
bank_push "$REPO2" "$NOTES" >/dev/null 2>&1
PUSH_RC2=$?
set -e
[[ "$PUSH_RC2" -eq 1 ]] && pass "bank-push exits 1 with no bank-status.md" || fail "bank-push exits 1 with no bank-status.md (got $PUSH_RC2)"

# --- set-status: edits status, body byte-identical ---
cat >"$REPO/.agent-relay/bank.conf" <<EOF
BANK_TYPE=obsidian-vault
BANK_PATH=$VAULT
BANK_PROJECT_NAME=agent-relay
EOF
bank_check "$REPO" >/dev/null
rm -f "$VAULT"/*.md
write_note "$VAULT/$DEC_NOTE" decision agent-relay
BODY_BEFORE="$(awk 'BEGIN{c=0} /^---[[:space:]]*$/{c++; if(c==2){s=1; next}} s{print}' "$VAULT/$DEC_NOTE")"
BY_NOTE="${YMD}-${RID}-later-decision.md"
write_note "$VAULT/$BY_NOTE" decision agent-relay
if bank_set_status "$REPO" "$DEC_NOTE" superseded --by "$BY_NOTE" >/dev/null; then
  pass "bank-set-status exits 0"
else
  fail "bank-set-status exits 0"
fi
STATUS_VAL="$(sed -n 's/^status: //p' "$VAULT/$DEC_NOTE" | head -1)"
BY_VAL="$(sed -n 's/^superseded_by: //p' "$VAULT/$DEC_NOTE" | head -1)"
[[ "$STATUS_VAL" == "superseded" ]] && pass "status field is superseded" || fail "status field is superseded (got $STATUS_VAL)"
[[ "$BY_VAL" == "\"[[${BY_NOTE%.md}]]\"" ]] && pass "superseded_by set from --by as quoted wikilink" || fail "superseded_by set from --by as quoted wikilink (got $BY_VAL)"
chmod 644 "$VAULT/$BY_NOTE"
bank_set_status "$REPO" "$BY_NOTE" deprecated >/dev/null
MODE="$(ls -l "$VAULT/$BY_NOTE" | cut -c1-10)"
[[ "$MODE" == "-rw-r--r--" ]] && pass "set-status keeps note permissions" || fail "set-status keeps note permissions (got $MODE)"
BODY_AFTER="$(awk 'BEGIN{c=0} /^---[[:space:]]*$/{c++; if(c==2){s=1; next}} s{print}' "$VAULT/$DEC_NOTE")"
[[ "$BODY_BEFORE" == "$BODY_AFTER" ]] && pass "set-status leaves body byte-identical" || fail "set-status leaves body byte-identical"

# refuse invalid status for type
set +e
bank_set_status "$REPO" "$DEC_NOTE" open >/dev/null 2>&1
SS_RC=$?
set -e
[[ "$SS_RC" -eq 1 ]] && pass "set-status refuses status invalid for type" || fail "set-status refuses status invalid for type (got $SS_RC)"

# refuse status on run notes
write_note "$VAULT/$RUN_NOTE" run agent-relay
set +e
bank_set_status "$REPO" "$RUN_NOTE" active >/dev/null 2>&1
RUN_RC=$?
set -e
[[ "$RUN_RC" -eq 1 ]] && pass "set-status refuses run notes" || fail "set-status refuses run notes (got $RUN_RC)"

if [[ "$FAIL" -eq 0 ]]; then
  echo "ALL BANK TESTS PASSED"
else
  echo "SOME FAILURES"
  exit 1
fi
