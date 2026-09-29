#!/usr/bin/env bash
# Offline checks for atry distill finalize (scripts/runtime/distill-finalize.sh).
# Run from repo root:
#   ./tests/distill-finalize.sh
#   make distill-finalize
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ATRY="$ROOT/scripts/atry"
FINALIZE_SH="$ROOT/scripts/runtime/distill-finalize.sh"

FAIL=0
pass() { echo "PASS: $1"; }
fail() {
  echo "FAIL: $1"
  FAIL=1
}

T="$(mktemp -d "${TMPDIR:-/tmp}/ar-distill-fin.XXXXXX")"
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

# Hermetic commit identity
export GIT_AUTHOR_NAME="atry-test" GIT_AUTHOR_EMAIL="atry-test@example.invalid"
export GIT_COMMITTER_NAME="atry-test" GIT_COMMITTER_EMAIL="atry-test@example.invalid"

# --- static: bash 3.2 ---
if grep -q 'declare -A' "$FINALIZE_SH"; then
  fail "distill-finalize.sh contains declare -A (bash 4+ feature)"
else
  pass "distill-finalize.sh does not use declare -A"
fi

REPO="$T/repo"
VAULT="$T/vault"
ATRY_VAULT="$T/atry-vault"
mkdir -p "$REPO" "$VAULT" "$ATRY_VAULT"
(
  cd "$REPO"
  git init -q
  echo "base" >file.txt
  git add file.txt
  git commit -qm "init"
)
BASE="$(git -C "$REPO" rev-parse HEAD)"
AR="$REPO/.agent-relay"
mkdir -p "$AR"

YMD=20260928
RID=1790607761
RUN_ID_BASE="${YMD}-${RID}-slim-distill"
RUN_NOTE="${RUN_ID_BASE}.md"
DEC_NOTE="${YMD}-${RID}-choose-finalize.md"
OLD_DEC="${YMD}-${RID}-old-decision.md"
OLD_PIT="${YMD}-${RID}-old-pitfall.md"
PROC_NOTE="${YMD}-${RID}-improve-finalize.md"

field() {
  local src="$1" key="$2"
  if [[ -f "$src" ]]; then
    sed -n "s/^${key}:[[:space:]]*//p" "$src" | head -1
  else
    printf '%s\n' "$src" | sed -n "s/^${key}:[[:space:]]*//p" | head -1
  fi
}

write_note() {
  # write_note <dest> <type> [project] [scope] [extra_frontmatter_line]
  local dest="$1" type="$2" project="${3:-}" scope="${4:-}" extra_fm="${5:-}"
  local status_line=""
  case "$type" in
  run) status_line="" ;;
  decision | convention | process) status_line="status: active" ;;
  pitfall | open-item) status_line="status: open" ;;
  esac
  if [[ -z "$scope" ]]; then
    if [[ "$type" == "process" ]]; then
      scope=atry
    else
      scope=project
    fi
  fi
  # If 4th arg looks like frontmatter (contains ':') and 5th empty, treat as extra
  if [[ "$scope" == *:* && -z "$extra_fm" ]]; then
    extra_fm="$scope"
    if [[ "$type" == "process" ]]; then
      scope=atry
    else
      scope=project
    fi
  fi
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
    printf 'run_id: %s\n' "$RUN_ID_BASE"
    printf 'date: 2026-09-28\n'
    printf 'scope: %s\n' "$scope"
    if [[ -n "$extra_fm" ]]; then
      printf '%s\n' "$extra_fm"
    fi
    printf -- '---\n\n'
    if [[ "$type" == "run" ]]; then
      printf '## Summary\n\nfinalize fixture\n\n## Bank push\n\nplaceholder\n\n## Metrics\n\nreserved\n'
    else
      printf '## Body\n\nunchanged-body-marker\n'
    fi
  } >"$dest"
}

new_run() {
  local slug="$1"
  RUN="$AR/${YMD}-${RID}-${slug}"
  mkdir -p "$RUN/distill"
  cat >"$RUN/meta.md" <<EOF
id: $RID
slug: $slug
created: 2026-09-28
title: distill finalize fixture $slug
stage: distill
status: active
base: $BASE
EOF
  cat >"$RUN/history.log" <<'EOF'
2026-09-28T10:00:00Z stage=plan action=created tool=cursor
2026-09-28T10:10:00Z stage=implement action=started tool=cursor
2026-09-28T10:40:00Z stage=implement action=completed tool=cursor
2026-09-28T11:21:00Z stage=distill action=started tool=cursor
EOF
  cat >"$RUN/plan.md" <<EOF
base: $BASE
id: $RID

# Fixture

## Tasks

1. One (deps: )
EOF
}

CURL_BIN="$T/curl-bin"
CURL_LOG="$T/curl-log"
mkdir -p "$CURL_BIN" "$CURL_LOG"
install_curl_stub() {
  local mode="$1"
  rm -f "$CURL_LOG"/*
  : >"$CURL_LOG/remember-count.txt"
  echo 0 >"$CURL_LOG/remember-count.txt"
  cat >"$CURL_BIN/curl" <<EOF
#!/usr/bin/env bash
set -euo pipefail
LOGDIR="$CURL_LOG"
MODE="$mode"
args=("\$@")
i=0
while [[ \$i -lt \${#args[@]} ]]; do
  if [[ "\${args[\$i]}" == "--data-binary" ]]; then
    f="\${args[\$((i+1))]}"
    f="\${f#@}"
    cp "\$f" "\$LOGDIR/last-body.json"
  fi
  i=\$((i+1))
done
url="\${args[\$((\${#args[@]}-1))]}"
printf '%s\n' "\$url" >>"\$LOGDIR/urls.txt"
case "\$MODE" in
health-ok)
  if [[ "\$url" == */agentmemory/health ]]; then
    echo '{"status":"healthy"}'
    exit 0
  fi
  exit 0
  ;;
remember-ok)
  if [[ "\$url" == */agentmemory/health ]]; then
    echo '{"status":"healthy"}'
    exit 0
  fi
  if [[ "\$url" == */agentmemory/remember ]]; then
    c=\$(cat "\$LOGDIR/remember-count.txt")
    echo \$((c+1)) >"\$LOGDIR/remember-count.txt"
    echo '{"ok":true}'
    exit 0
  fi
  exit 0
  ;;
*)
  exit 1
  ;;
esac
EOF
  chmod +x "$CURL_BIN/curl"
}

# ========== missing / duplicate run note ==========
new_run missing-run
set +e
"$ATRY" distill finalize "$RUN" >/dev/null 2>"$T/miss.err"
rc=$?
set -e
[[ "$rc" -eq 1 ]] && pass "missing run note exits 1" || fail "missing run note exits 1 (got $rc)"
grep -qi 'no type: run' "$T/miss.err" && pass "missing run note message" || fail "missing run note message"

new_run dup-run
write_note "$RUN/distill/$RUN_NOTE" run agent-relay
write_note "$RUN/distill/${YMD}-${RID}-other-run.md" run agent-relay
set +e
"$ATRY" distill finalize "$RUN" >/dev/null 2>"$T/dup.err"
rc=$?
set -e
[[ "$rc" -eq 1 ]] && pass "duplicate run note exits 1" || fail "duplicate run note exits 1 (got $rc)"
grep -qi 'multiple type: run' "$T/dup.err" && pass "duplicate run note message" || fail "duplicate run note message"

# ========== no bank: skip push, write skipped line, history ==========
new_run no-bank
# No bank.conf
write_note "$RUN/distill/$RUN_NOTE" run agent-relay
write_note "$RUN/distill/$DEC_NOTE" decision agent-relay
set +e
"$ATRY" distill finalize "$RUN" tool=cursor >/dev/null 2>"$T/nobank.err"
rc=$?
set -e
[[ "$rc" -eq 0 ]] && pass "no bank exits 0" || fail "no bank exits 0 (got $rc)"
grep -q '^Bank push: skipped' "$RUN/distill/$RUN_NOTE" && pass "no bank writes skipped Bank push line" || fail "no bank writes skipped Bank push line"
bp_count="$(grep -c '^Bank push:' "$RUN/distill/$RUN_NOTE" || true)"
[[ "$bp_count" -eq 1 ]] && pass "exactly one Bank push: line (no bank)" || fail "exactly one Bank push: line (no bank) got $bp_count"
grep -q 'stage=distill action=completed' "$RUN/history.log" && pass "no bank: distill completed" || fail "no bank: distill completed"
grep -q 'stage=done action=completed' "$RUN/history.log" && pass "no bank: done completed" || fail "no bank: done completed"
[[ "$(field "$RUN/meta.md" status)" == "done" ]] && pass "no bank: meta status done" || fail "no bank: meta status done"
[[ "$(field "$RUN/meta.md" stage)" == "done" ]] && pass "no bank: meta stage done" || fail "no bank: meta stage done"
# placeholder under Bank push removed
grep -q '^placeholder$' "$RUN/distill/$RUN_NOTE" && fail "Bank push placeholder removed" || pass "Bank push placeholder removed"

# ========== vault only ==========
new_run vault-only
cat >"$AR/bank.conf" <<EOF
BANK_TYPE=obsidian-vault
BANK_PATH=$VAULT
BANK_PROJECT_NAME=agent-relay
EOF
rm -f "$VAULT"/*.md
write_note "$RUN/distill/$RUN_NOTE" run agent-relay
write_note "$RUN/distill/$DEC_NOTE" decision agent-relay
set +e
"$ATRY" distill finalize "$RUN" tool=cursor >/dev/null 2>"$T/vault.err"
rc=$?
set -e
[[ "$rc" -eq 0 ]] && pass "vault-only finalize exits 0" || fail "vault-only finalize exits 0 (got $rc)"
[[ -f "$VAULT/$RUN_NOTE" ]] && pass "vault got run note" || fail "vault got run note"
[[ -f "$VAULT/$DEC_NOTE" ]] && pass "vault got decision note" || fail "vault got decision note"
grep -q "^Bank push: pushed 2 notes to $VAULT" "$RUN/distill/$RUN_NOTE" && pass "Bank push line names vault path" || fail "Bank push line names vault path (got $(grep '^Bank push:' "$RUN/distill/$RUN_NOTE"))"
# vault copy byte-identical after vault-only re-push
if cmp -s "$RUN/distill/$RUN_NOTE" "$VAULT/$RUN_NOTE"; then
  pass "vault run note byte-identical to distill/"
else
  fail "vault run note byte-identical to distill/"
fi
grep -q 'Bank push:' "$VAULT/$RUN_NOTE" && pass "vault copy carries Bank push line" || fail "vault copy carries Bank push line"
bp_count="$(grep -c '^Bank push:' "$RUN/distill/$RUN_NOTE" || true)"
[[ "$bp_count" -eq 1 ]] && pass "exactly one Bank push: line (vault)" || fail "exactly one Bank push: line (vault)"

# ========== vault + agentmemory stub ==========
new_run vault-am
install_curl_stub remember-ok
cat >"$AR/bank.conf" <<EOF
BANK_TYPE=obsidian-vault
BANK_PATH=$VAULT
BANK_PROJECT_NAME=agent-relay
BANK_AGENTMEMORY_URL=http://127.0.0.1:3111
EOF
rm -f "$VAULT"/*.md "$AR/bank-agentmemory-sent.tsv"
write_note "$RUN/distill/$RUN_NOTE" run agent-relay
write_note "$RUN/distill/$DEC_NOTE" decision agent-relay
# add tags for remember eligibility
awk '
  BEGIN { c = 0 }
  /^---[[:space:]]*$/ { c++; print; next }
  c == 1 && /^status:/ && !tags_done {
    print
    print "tags: [atry/decision, project/agent-relay]"
    tags_done = 1
    next
  }
  { print }
' "$RUN/distill/$DEC_NOTE" >"$RUN/distill/tmp.md" && mv "$RUN/distill/tmp.md" "$RUN/distill/$DEC_NOTE"
set +e
PATH="$CURL_BIN:$PATH" "$ATRY" distill finalize "$RUN" tool=cursor >/dev/null 2>"$T/am.err"
rc=$?
set -e
[[ "$rc" -eq 0 ]] && pass "vault+AM finalize exits 0" || fail "vault+AM finalize exits 0 (got $rc)"
[[ -f "$VAULT/$DEC_NOTE" ]] && pass "vault+AM wrote vault" || fail "vault+AM wrote vault"
remember_n="$(grep -c '/agentmemory/remember' "$CURL_LOG/urls.txt" 2>/dev/null || echo 0)"
# first push remembers decision; vault-only re-push skips AM — expect 1
[[ "$remember_n" -eq 1 ]] && pass "vault+AM: one remember, vault-only skips AM" || fail "vault+AM: one remember (got $remember_n)"

# ========== supersedes / resolves set-status ==========
new_run set-status
cat >"$AR/bank.conf" <<EOF
BANK_TYPE=obsidian-vault
BANK_PATH=$VAULT
BANK_PROJECT_NAME=agent-relay
EOF
rm -f "$VAULT"/*.md
# Seed prior vault notes
write_note "$VAULT/$OLD_DEC" decision agent-relay
write_note "$VAULT/$OLD_PIT" pitfall agent-relay
write_note "$RUN/distill/$RUN_NOTE" run agent-relay
write_note "$RUN/distill/$DEC_NOTE" decision agent-relay project \
  "supersedes: \"[[${OLD_DEC%.md}]]\""
write_note "$RUN/distill/${YMD}-${RID}-close-pitfall.md" decision agent-relay project \
  "resolves: \"[[${OLD_PIT%.md}]]\""
set +e
"$ATRY" distill finalize "$RUN" tool=cursor >/dev/null 2>"$T/ss.err"
rc=$?
set -e
[[ "$rc" -eq 0 ]] && pass "set-status finalize exits 0" || fail "set-status finalize exits 0 (got $rc)"
[[ "$(field "$VAULT/$OLD_DEC" status)" == "superseded" ]] && pass "supersedes -> superseded" || fail "supersedes -> superseded (got $(field "$VAULT/$OLD_DEC" status))"
[[ "$(field "$VAULT/$OLD_PIT" status)" == "resolved" ]] && pass "resolves -> resolved" || fail "resolves -> resolved (got $(field "$VAULT/$OLD_PIT" status))"

# ========== missing distill/ directory ==========
new_run no-distill-dir
rm -rf "$RUN/distill"
set +e
"$ATRY" distill finalize "$RUN" >/dev/null 2>"$T/nodir.err"
rc=$?
set -e
[[ "$rc" -eq 1 ]] && pass "missing distill/ exits 1" || fail "missing distill/ exits 1 (got $rc)"

# ========== dual vault lanes in Bank push line ==========
new_run dual-vault
cat >"$AR/bank.conf" <<EOF
BANK_TYPE=obsidian-vault
BANK_PATH=$VAULT
BANK_PROJECT_NAME=agent-relay
BANK_ATRY_PATH=$ATRY_VAULT
BANK_ATRY_NAME=atry-self
EOF
rm -f "$VAULT"/*.md "$ATRY_VAULT"/*.md
write_note "$RUN/distill/$RUN_NOTE" run agent-relay project
write_note "$RUN/distill/$DEC_NOTE" decision agent-relay project
write_note "$RUN/distill/$PROC_NOTE" process atry-self atry
set +e
"$ATRY" distill finalize "$RUN" tool=cursor >/dev/null 2>"$T/dual.err"
rc=$?
set -e
[[ "$rc" -eq 0 ]] && pass "dual-vault finalize exits 0" || fail "dual-vault finalize exits 0 (got $rc)"
grep -q "^Bank push: pushed 2 notes to $VAULT and 1 to $ATRY_VAULT" "$RUN/distill/$RUN_NOTE" &&
  pass "Bank push line mentions both lanes" ||
  fail "Bank push line mentions both lanes (got $(grep '^Bank push:' "$RUN/distill/$RUN_NOTE"))"
cmp -s "$RUN/distill/$RUN_NOTE" "$VAULT/$RUN_NOTE" && pass "dual-vault project copy identical" || fail "dual-vault project copy identical"

if [[ "$FAIL" -ne 0 ]]; then
  echo "distill-finalize tests: FAILED"
  exit 1
fi
echo "distill-finalize tests: OK"
exit 0
