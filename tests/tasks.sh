#!/usr/bin/env bash
# tests/tasks.sh
# Tests for parallel task claiming, initialization, and migration (bash 3.2+).
# Run from repo root:
#   ./tests/tasks.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TASK_CLAIM="$ROOT/scripts/task-claim.sh"
TASK_INIT="$ROOT/scripts/task-init.sh"

FAIL=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAIL=1; }

# Never inherit steal-race hooks from the parent environment.
unset AGENT_RELAY_TEST_STEAL_BARRIER AGENT_RELAY_TEST_STEAL_PAUSE

T="$(mktemp -d "${TMPDIR:-/tmp}/ar-tasks.XXXXXX")"
cleanup() { rm -rf "$T"; }
trap cleanup EXIT

cd "$T"

# 1. Happy path: task-init -> claim -> update -> release -> list
mkdir -p .agent-relay
cat <<'EOF' > .agent-relay/plan-happy.md
base: main
id: happy

# Happy Plan

## Tasks

1. **Setup DB.** Create migrations.
2. **Add API.** Implement endpoints.
EOF

"$TASK_INIT" happy >/dev/null
[[ -d .agent-relay/implement-plan-happy ]] && pass "task-init creates directory" || fail "task-init creates directory"
[[ -f .agent-relay/implement-plan-happy/T1.status ]] && pass "task-init creates T1.status" || fail "task-init creates T1.status"
[[ -f .agent-relay/implement-plan-happy/T2.status ]] && pass "task-init creates T2.status" || fail "task-init creates T2.status"
[[ -f .agent-relay/implement-plan-happy.md ]] && pass "task-init generates rollup" || fail "task-init generates rollup"

grep -q -- "- \[pending\] T1:" .agent-relay/implement-plan-happy.md && pass "initial rollup pending" || fail "initial rollup pending"

# Claim T1
"$TASK_CLAIM" claim happy T1 agent-1 >/dev/null
[[ -d .agent-relay/implement-plan-happy/.lock-T1 ]] && pass "claim creates lock dir" || fail "claim creates lock dir"
grep -q -- "agent-1" .agent-relay/implement-plan-happy/.lock-T1/owner && pass "claim writes owner" || fail "claim writes owner"
grep -q -- "status: in-progress" .agent-relay/implement-plan-happy/T1.status && pass "claim sets in-progress" || fail "claim sets in-progress"
grep -q -- "- \[in-progress\] T1:" .agent-relay/implement-plan-happy.md && pass "claim updates rollup" || fail "claim updates rollup"

# Wrong owner update must fail loudly
if "$TASK_CLAIM" update happy T1 agent-impostor done >/dev/null 2>&1; then
  fail "update with wrong session-tag should fail"
else
  pass "update with wrong session-tag fails"
fi

# Right owner update
"$TASK_CLAIM" update happy T1 agent-1 done >/dev/null
grep -q -- "status: done" .agent-relay/implement-plan-happy/T1.status && pass "update sets done" || fail "update sets done"
grep -q -- "- \[done\] T1:" .agent-relay/implement-plan-happy.md && pass "update updates rollup" || fail "update updates rollup"

# Release lock
"$TASK_CLAIM" release happy T1 agent-1 >/dev/null
[[ ! -d .agent-relay/implement-plan-happy/.lock-T1 ]] && pass "release removes lock dir" || fail "release removes lock dir"
grep -q -- "status: done" .agent-relay/implement-plan-happy/T1.status && pass "release leaves status done" || fail "release leaves status done"

# List
LIST_OUT="$("$TASK_CLAIM" list happy)"
echo "$LIST_OUT" | grep -q -- "- \[done\] T1:" && pass "list shows done T1" || fail "list shows done T1"
echo "$LIST_OUT" | grep -q -- "- \[pending\] T2:" && pass "list shows pending T2" || fail "list shows pending T2"

# 2. Lock collision: second claim on locked task fails loudly and prints owner
"$TASK_CLAIM" claim happy T2 agent-first >/dev/null
SECOND_OUT="$("$TASK_CLAIM" claim happy T2 agent-second 2>&1 || true)"
echo "$SECOND_OUT" | grep -q "agent-first" && pass "collision prints existing owner" || fail "collision prints existing owner"
"$TASK_CLAIM" release happy T2 agent-first >/dev/null

# 3. Concurrent claim: launch two background claims, exactly one succeeds
cat <<'EOF' > .agent-relay/plan-conc.md
base: main
id: conc

# Concurrency Plan

## Tasks

1. **Race task.** Only one agent may win.
EOF

for i in {1..5}; do
  rm -rf .agent-relay/implement-plan-conc*
  "$TASK_INIT" conc >/dev/null

  code1=0
  code2=0
  "$TASK_CLAIM" claim conc T1 worker-A >/dev/null 2>&1 &
  pid1=$!
  "$TASK_CLAIM" claim conc T1 worker-B >/dev/null 2>&1 &
  pid2=$!

  wait $pid1 || code1=$?
  wait $pid2 || code2=$?

  # One must succeed (exit 0) and one must fail (exit 1)
  if [[ ($code1 -eq 0 && $code2 -ne 0) || ($code1 -ne 0 && $code2 -eq 0) ]]; then
    pass "concurrent claim iteration $i: exactly one winner"
  else
    fail "concurrent claim iteration $i failed (code1=$code1, code2=$code2)"
  fi

  # Check lock and status integrity
  owner="$(awk '{print $1}' .agent-relay/implement-plan-conc/.lock-T1/owner 2>/dev/null || true)"
  if [[ "$owner" == "worker-A" || "$owner" == "worker-B" ]]; then
    pass "concurrent claim iteration $i: uncorrupted lock owner ($owner)"
  else
    fail "concurrent claim iteration $i: corrupted lock owner ($owner)"
  fi

  grep -q "status: in-progress" .agent-relay/implement-plan-conc/T1.status && \
    pass "concurrent claim iteration $i: uncorrupted .status file" || \
    fail "concurrent claim iteration $i: corrupted .status file"
done

# 4. Stale lock (>2h): claim fails with steal hint; steal takes ownership
rm -rf .agent-relay/implement-plan-stale*
cat <<'EOF' > .agent-relay/plan-stale.md
base: main
id: stale

## Tasks

1. **Stale task.** Lock should be stolen.
EOF

"$TASK_INIT" stale >/dev/null
"$TASK_CLAIM" claim stale T1 old-agent >/dev/null

# Set lock epoch to 3 hours ago (10800 seconds)
OLD_EPOCH=$(( $(date +%s) - 10800 ))
echo "$OLD_EPOCH" > .agent-relay/implement-plan-stale/.lock-T1/created_epoch

CLAIM_STALE_OUT="$("$TASK_CLAIM" claim stale T1 new-agent 2>&1 || true)"
echo "$CLAIM_STALE_OUT" | grep -q "stale" && pass "stale lock claim fails with message" || fail "stale lock claim fails with message"
echo "$CLAIM_STALE_OUT" | grep -q "steal" && pass "stale lock claim suggests steal" || fail "stale lock claim suggests steal"
grep -q "old-agent" .agent-relay/implement-plan-stale/.lock-T1/owner && pass "stale lock not auto-stolen" || fail "stale lock not auto-stolen"

STEAL_OUT="$("$TASK_CLAIM" steal stale T1 new-agent 2>&1)"
echo "$STEAL_OUT" | grep -qi "steal" && pass "steal logs message" || fail "steal logs message"
grep -q "new-agent" .agent-relay/implement-plan-stale/.lock-T1/owner && pass "steal takes lock for new-agent" || fail "steal takes lock for new-agent"
"$TASK_CLAIM" release stale T1 new-agent >/dev/null

# 5. Migration preserves legacy files and statuses
cat <<'EOF' > .agent-relay/implement-plan-legacy.md
# implement-plan (legacy)

- [done] T1: Task completed
- [in-progress] T2: Task underway
- [skipped (dependency not met)] T3: Skipped task
- [pending] T4: Not started yet
EOF

"$TASK_INIT" legacy --migrate >/dev/null
[[ -f .agent-relay/implement-plan-legacy.md.bak ]] && pass "migration preserves .bak" || fail "migration preserves .bak"
diff -u .agent-relay/implement-plan-legacy.md.bak .agent-relay/implement-plan-legacy.md && \
  pass "migration rollup matches legacy byte-for-byte" || \
  fail "migration rollup matches legacy byte-for-byte"

grep -q "status: done" .agent-relay/implement-plan-legacy/T1.status && pass "migrated T1 done" || fail "migrated T1 done"
grep -q "status: in-progress" .agent-relay/implement-plan-legacy/T2.status && pass "migrated T2 in-progress" || fail "migrated T2 in-progress"
grep -q "status: skipped (dependency not met)" .agent-relay/implement-plan-legacy/T3.status && pass "migrated T3 skipped" || fail "migrated T3 skipped"
grep -q "status: pending" .agent-relay/implement-plan-legacy/T4.status && pass "migrated T4 pending" || fail "migrated T4 pending"

# 6. Self-review overwrite bug test: replacing only that day's section
REVIEW_FILE="$T/review-report-test.md"
TODAY="$(date +%Y-%m-%d)"
cat <<EOF > "$REVIEW_FILE"
## Self-Review — $TODAY

Initial self-review content.

## Cross-Review — $TODAY

Cross-review notes that must not be deleted.
EOF

# Simulate the updated replacement rule:
# If ## Self-Review — <today> exists, replace only that section up to next ## heading
awk -v today="$TODAY" '
  BEGIN { in_self=0 }
  /^## Self-Review — / && $0 ~ today {
    in_self=1
    print "## Self-Review — " today "\n\nUpdated self-review content fixing confirmed issue.\n"
    next
  }
  in_self && /^## / { in_self=0 }
  !in_self { print }
' "$REVIEW_FILE" > "$REVIEW_FILE.tmp"
mv "$REVIEW_FILE.tmp" "$REVIEW_FILE"

grep -q "Updated self-review content fixing confirmed issue." "$REVIEW_FILE" && pass "self-review replaced" || fail "self-review replaced"
grep -q "## Cross-Review — $TODAY" "$REVIEW_FILE" && pass "cross-review preserved" || fail "cross-review preserved"
grep -q "Cross-review notes that must not be deleted." "$REVIEW_FILE" && pass "cross-review body preserved" || fail "cross-review body preserved"

# 7. task-init ## Tasks section scoping: numbered items outside the section must not be parsed
cat <<'EOF' > .agent-relay/plan-scoped.md
base: main
id: scoped

# Plan With Sections

1. **Preamble item.** Must NOT become a task.

## Tasks

1. **Real task A.** Only this.
2. **Real task B.** And this.

## Non-tasks

1. **Not a task.** Must NOT become a task.
EOF

"$TASK_INIT" scoped > /dev/null
COUNT=$(ls .agent-relay/implement-plan-scoped/*.status 2>/dev/null | wc -l | tr -d ' ')
[[ "$COUNT" -eq 2 ]] && pass "task-init only parses ## Tasks section (count=$COUNT)" || fail "task-init only parses ## Tasks section (got $COUNT, want 2)"
[[ -f .agent-relay/implement-plan-scoped/T1.status ]] && pass "scoped: T1 exists" || fail "scoped: T1 exists"
[[ -f .agent-relay/implement-plan-scoped/T2.status ]] && pass "scoped: T2 exists" || fail "scoped: T2 exists"
ROLLUP_LINES=$(grep -c '^\- \[' .agent-relay/implement-plan-scoped.md || true)
[[ "$ROLLUP_LINES" -eq 2 ]] && pass "scoped: rollup has exactly 2 task lines" || fail "scoped: rollup has $ROLLUP_LINES task lines (want 2)"

# 8. task-init without --migrate must not clobber an existing sequential rollup
cat <<'EOF' > .agent-relay/plan-clobber.md
base: main
id: clobber

## Tasks

1. **Only task.** From plan.
EOF
cat <<'EOF' > .agent-relay/implement-plan-clobber.md
# implement-plan (clobber)

- [done] T1: Preserved sequential progress
EOF
if "$TASK_INIT" clobber >/dev/null 2>&1; then
  fail "task-init should refuse when legacy rollup exists"
else
  pass "task-init refuses when legacy rollup exists"
fi
grep -q "Preserved sequential progress" .agent-relay/implement-plan-clobber.md && \
  pass "task-init left legacy rollup untouched" || \
  fail "task-init left legacy rollup untouched"
[[ ! -d .agent-relay/implement-plan-clobber ]] && \
  pass "task-init did not create plan dir on refuse" || \
  fail "task-init did not create plan dir on refuse"

# 9. Concurrent claims on different tasks leave rollup consistent
cat <<'EOF' > .agent-relay/plan-difftask.md
base: main
id: difftask

## Tasks

1. **Task A.** first
2. **Task B.** second
EOF
diff_lost=0
for i in 1 2 3 4 5; do
  rm -rf .agent-relay/implement-plan-difftask .agent-relay/implement-plan-difftask.md
  "$TASK_INIT" difftask >/dev/null
  "$TASK_CLAIM" claim difftask T1 worker-A >/dev/null 2>&1 &
  pid_a=$!
  "$TASK_CLAIM" claim difftask T2 worker-B >/dev/null 2>&1 &
  pid_b=$!
  wait $pid_a || true
  wait $pid_b || true
  if ! grep -q -- "- \[in-progress\] T1:" .agent-relay/implement-plan-difftask.md || \
     ! grep -q -- "- \[in-progress\] T2:" .agent-relay/implement-plan-difftask.md; then
    diff_lost=$((diff_lost + 1))
  fi
done
[[ "$diff_lost" -eq 0 ]] && \
  pass "concurrent different-task claims: rollup consistent (5 iters)" || \
  fail "concurrent different-task claims: rollup lost updates ($diff_lost/5)"

# 9b. T2 harness: N=50 concurrent steals — exactly one winner per round
# Mutex on steal makes dual-winner impossible; pause widens the race window.
STALE_RACE_N=50
stale_race_fail=0
export AGENT_RELAY_TEST_STEAL_PAUSE=0.02
cat <<'EOF' > .agent-relay/plan-stalerace.md
base: main
id: stalerace

## Tasks

1. **Race steal.** Two agents contend on an expired lock.
EOF
i=1
while [[ $i -le $STALE_RACE_N ]]; do
  rm -rf .agent-relay/implement-plan-stalerace .agent-relay/implement-plan-stalerace.md
  "$TASK_INIT" stalerace >/dev/null
  "$TASK_CLAIM" claim stalerace T1 seed-owner >/dev/null
  OLD_EPOCH=$(( $(date +%s) - 10800 ))
  echo "$OLD_EPOCH" > .agent-relay/implement-plan-stalerace/.lock-T1/created_epoch

  code1=0
  code2=0
  "$TASK_CLAIM" steal stalerace T1 race-A >/dev/null 2>&1 &
  pid1=$!
  "$TASK_CLAIM" steal stalerace T1 race-B >/dev/null 2>&1 &
  pid2=$!
  wait $pid1 || code1=$?
  wait $pid2 || code2=$?

  winners=0
  [[ $code1 -eq 0 ]] && winners=$((winners + 1))
  [[ $code2 -eq 0 ]] && winners=$((winners + 1))
  if [[ $winners -ne 1 ]]; then
    stale_race_fail=$((stale_race_fail + 1))
  fi
  i=$((i + 1))
done
unset AGENT_RELAY_TEST_STEAL_PAUSE
if [[ $stale_race_fail -eq 0 ]]; then
  pass "stale-lock dual steal: exactly one winner ($STALE_RACE_N/$STALE_RACE_N)"
else
  fail "stale-lock dual steal: $stale_race_fail/$STALE_RACE_N rounds had !=1 winner"
fi
rm -rf .agent-relay/implement-plan-stalerace .agent-relay/implement-plan-stalerace.md \
  .agent-relay/plan-stalerace.md

# 9c. T2 harness: 8 claimants on 8 distinct tasks — rollup matches list
cat <<'EOF' > .agent-relay/plan-eight.md
base: main
id: eight

## Tasks

1. **T1.** one
2. **T2.** two
3. **T3.** three
4. **T4.** four
5. **T5.** five
6. **T6.** six
7. **T7.** seven
8. **T8.** eight
EOF
eight_lost=0
eight_iters=10
ei=1
while [[ $ei -le $eight_iters ]]; do
  rm -rf .agent-relay/implement-plan-eight .agent-relay/implement-plan-eight.md
  "$TASK_INIT" eight >/dev/null
  pids=""
  t=1
  while [[ $t -le 8 ]]; do
    "$TASK_CLAIM" claim eight "T$t" "worker-$t" >/dev/null 2>&1 &
    pids="$pids $!"
    t=$((t + 1))
  done
  for p in $pids; do
    wait "$p" || true
  done
  LIST_OUT="$("$TASK_CLAIM" list eight)"
  ROLLUP="$(cat .agent-relay/implement-plan-eight.md)"
  t=1
  while [[ $t -le 8 ]]; do
    if ! echo "$LIST_OUT" | grep -q -- "- \[in-progress\] T$t:" || \
       ! echo "$ROLLUP" | grep -q -- "- \[in-progress\] T$t:"; then
      eight_lost=$((eight_lost + 1))
      break
    fi
    t=$((t + 1))
  done
  # list and rollup must agree line-for-line on in-progress rows
  list_ip="$(echo "$LIST_OUT" | grep -- '- \[in-progress\]' | sort)"
  roll_ip="$(echo "$ROLLUP" | grep -- '- \[in-progress\]' | sort)"
  if [[ "$list_ip" != "$roll_ip" ]]; then
    eight_lost=$((eight_lost + 1))
  fi
  ei=$((ei + 1))
done
[[ "$eight_lost" -eq 0 ]] && \
  pass "8-way different-task claims: list matches rollup ($eight_iters iters)" || \
  fail "8-way different-task claims: inconsistency ($eight_lost events)"
rm -rf .agent-relay/implement-plan-eight .agent-relay/implement-plan-eight.md \
  .agent-relay/plan-eight.md

# 10. deps: dependency check during claim
cat <<'EOF' > .agent-relay/plan-deps.md
base: main
id: deps

## Tasks

1. **Task A.** First task
2. **Task B.** Depends on A (deps: T1)
EOF
"$TASK_INIT" deps >/dev/null
grep -q '^deps: T1$' .agent-relay/implement-plan-deps/T2.status && \
  pass "init writes deps: into .status" || \
  fail "init writes deps: into .status (got: $(tr '\n' ' ' < .agent-relay/implement-plan-deps/T2.status))"
# Claim T2 -> should fail because T1 is pending
if "$TASK_CLAIM" claim deps T2 worker >/dev/null 2>&1; then
  fail "claim T2 should fail when T1 is pending"
else
  pass "claim T2 fails when T1 is pending"
fi
# Finish T1
"$TASK_CLAIM" claim deps T1 worker >/dev/null
"$TASK_CLAIM" update deps T1 worker done >/dev/null
# Claim T2 -> should succeed
if "$TASK_CLAIM" claim deps T2 worker >/dev/null; then
  pass "claim T2 succeeds when T1 is done"
else
  fail "claim T2 should succeed when T1 is done"
fi
# deps preserved after update
grep -q '^deps: T1$' .agent-relay/implement-plan-deps/T2.status && \
  pass "claim preserves deps: line" || \
  fail "claim preserves deps: line"

# 11. report-write / report-list / report-rollup
rm -rf .agent-relay/implement-plan-r1 .agent-relay/implement-plan-r1.md \
  .agent-relay/implement-report-r1 .agent-relay/implement-report-r1.md \
  .agent-relay/plan-r1.md
cat <<'PLAN' > .agent-relay/plan-r1.md
## Tasks
- [ ] rT1: Report task 1
- [ ] rT2: Report task 2
PLAN
"$TASK_INIT" r1 >/dev/null

echo "report 1 content" | "$TASK_CLAIM" report-write r1 rT1 -
[[ -f .agent-relay/implement-report-r1/rT1.md ]] && \
  pass "report-write creates file from stdin" || \
  fail "report-write creates file from stdin"

echo "report 2 content" > "$T/rt2.txt"
"$TASK_CLAIM" report-write r1 rT2 "$T/rt2.txt"
[[ -f .agent-relay/implement-report-r1/rT2.md ]] && \
  pass "report-write creates file from path" || \
  fail "report-write creates file from path"

rlist="$("$TASK_CLAIM" report-list r1)"
echo "$rlist" | grep -q 'rT1.md' && echo "$rlist" | grep -q 'rT2.md' && \
  pass "report-list shows tasks" || \
  fail "report-list shows tasks ($rlist)"

rollup="$(cat .agent-relay/implement-report-r1.md)"
echo "$rollup" | grep -q 'report 1 content' && echo "$rollup" | grep -q 'report 2 content' && \
  pass "report-write updates rollup" || \
  fail "report-write updates rollup"

# Concurrent report-write should not lose updates
report_lost=0
for i in 1 2 3 4 5; do
  rm -f .agent-relay/implement-report-r1/rT1.md .agent-relay/implement-report-r1/rT2.md \
    .agent-relay/implement-report-r1.md
  echo "concurrent-a-$i" | "$TASK_CLAIM" report-write r1 rT1 - &
  pid_a=$!
  echo "concurrent-b-$i" | "$TASK_CLAIM" report-write r1 rT2 - &
  pid_b=$!
  wait $pid_a || true
  wait $pid_b || true
  if ! grep -q "concurrent-a-$i" .agent-relay/implement-report-r1.md || \
     ! grep -q "concurrent-b-$i" .agent-relay/implement-report-r1.md; then
    report_lost=$((report_lost + 1))
  fi
done
[[ "$report_lost" -eq 0 ]] && \
  pass "concurrent report-write: rollup consistent (5 iters)" || \
  fail "concurrent report-write: rollup lost updates ($report_lost/5)"

# 12. migrate legacy report file -> dir
rm -rf .agent-relay/implement-plan-m2 .agent-relay/implement-plan-m2.md \
  .agent-relay/implement-report-m2 .agent-relay/implement-report-m2.md \
  .agent-relay/implement-plan-m2.md.bak .agent-relay/implement-report-m2.md.bak
cat <<'LEGACY' > .agent-relay/implement-plan-m2.md
- [done] m1: Task 1
- [ ] m2: Task 2
LEGACY
cat <<'LEGACY_REPORT' > .agent-relay/implement-report-m2.md
# implement-report (m2)
Some legacy text.
LEGACY_REPORT

"$TASK_INIT" --migrate m2 >/dev/null

[[ -d .agent-relay/implement-report-m2 ]] && \
  pass "migrate creates report dir" || \
  fail "migrate creates report dir"
grep -q 'Some legacy text' .agent-relay/implement-report-m2/_meta.md && \
  pass "migrate moves legacy report into _meta.md" || \
  fail "migrate moves legacy report into _meta.md"
[[ -f .agent-relay/implement-report-m2.md.bak ]] && \
  pass "migrate backs up legacy report" || \
  fail "migrate backs up legacy report"

# --- T3: ident validation / path traversal ---
if "$TASK_CLAIM" report-write z '../../../../tmp/X' - </dev/null >/dev/null 2>&1; then
  fail "report-write rejects path-like task-id"
else
  pass "report-write rejects path-like task-id"
fi
# Must not create files outside .agent-relay
if [[ -e /tmp/X.md || -e ../../../../tmp/X.md ]]; then
  fail "report-write must not create files outside .agent-relay"
else
  pass "report-write did not escape .agent-relay"
fi
if "$TASK_CLAIM" claim '../x' T1 agent >/dev/null 2>&1; then
  fail "claim rejects path-like id"
else
  pass "claim rejects path-like id"
fi

# --- T4: global counter + require ## Tasks + nested list fails ---
cat <<'EOF' > .agent-relay/plan-t4fix.md
base: main
id: t4fix

## Goal

1. **Not a task.** From goal.

## Tasks

1. **First.** real
2. **Second.** also real

## Constraints

1. **Also not.** from constraints.
EOF
"$TASK_INIT" t4fix >/dev/null
[[ -f .agent-relay/implement-plan-t4fix/T1.status && -f .agent-relay/implement-plan-t4fix/T2.status ]] && \
  pass "T4 fixture yields T1 and T2" || fail "T4 fixture yields T1 and T2"
t4count="$(ls .agent-relay/implement-plan-t4fix/*.status | wc -l | tr -d ' ')"
[[ "$t4count" == "2" ]] && pass "T4 fixture count=2" || fail "T4 fixture count=$t4count"

cat <<'EOF' > .agent-relay/plan-nested.md
base: main
id: nested
## Tasks
1. **Outer.** ok
   1. **Nested.** bad
EOF
if "$TASK_INIT" nested >/dev/null 2>&1; then
  fail "nested numbered list must fail"
else
  pass "nested numbered list fails"
fi

cat <<'EOF' > .agent-relay/plan-nobold.md
base: main
id: nobold
## Tasks
1. plain with `backticks` and Label: value: more
2. **Bold label.** trailing
3. 
EOF
# item 3 empty desc after number — "3. " with nothing; may or may not match
# Use explicit empty-ish
rm -f .agent-relay/plan-nobold.md
cat <<'EOF' > .agent-relay/plan-desc.md
base: main
id: desc
## Tasks
1. **Bold.** after bold
2. with `ticks` here
3. Label: one: two
4. 
EOF
# Line "4. " alone — rest empty
if "$TASK_INIT" desc >/dev/null 2>&1; then
  grep -q 'after bold' .agent-relay/implement-plan-desc/T1.status && pass "desc strips bold" || fail "desc strips bold"
  grep -q 'ticks' .agent-relay/implement-plan-desc/T2.status && pass "desc keeps backtick text" || fail "desc keeps backtick text"
  pass "desc parser accepts varied markdown"
else
  fail "desc parser init"
fi

# --- T6: --session in both positions ---
rm -rf .agent-relay/implement-plan-sess .agent-relay/implement-plan-sess.md \
  .agent-relay/implement-report-sess .agent-relay/implement-report-sess.md
cat <<'EOF' > .agent-relay/plan-sess.md
base: main
id: sess
## Tasks
1. **S.** session
EOF
"$TASK_INIT" sess >/dev/null
"$TASK_CLAIM" claim sess T1 tagA >/dev/null
if "$TASK_CLAIM" update --session tagA sess T1 done >/dev/null; then
  pass "update --session after subcommand works"
else
  fail "update --session after subcommand works"
fi
"$TASK_CLAIM" release --session tagA sess T1 >/dev/null
"$TASK_CLAIM" claim sess T1 tagB >/dev/null
if "$TASK_CLAIM" --session tagB update sess T1 pending >/dev/null; then
  pass "--session before subcommand works"
else
  fail "--session before subcommand works"
fi
"$TASK_CLAIM" release --session tagB sess T1 >/dev/null

# --- T7: release ownership ---
"$TASK_CLAIM" claim sess T1 agentA >/dev/null
if SESSION=agentA "$TASK_CLAIM" release sess T1 >/dev/null 2>&1; then
  fail "release must not use ambient SESSION env"
else
  pass "release ignores ambient SESSION env"
fi
if "$TASK_CLAIM" release sess T1 agentB >/dev/null 2>&1; then
  fail "agent B cannot release agent A lock"
else
  pass "agent B cannot release agent A lock"
fi
"$TASK_CLAIM" release sess T1 agentA >/dev/null
"$TASK_CLAIM" claim sess T1 agentA >/dev/null
"$TASK_CLAIM" release --force sess T1 >/dev/null 2>&1 && \
  pass "release --force works" || fail "release --force works"

# --- T8: status whitelist ---
"$TASK_CLAIM" claim sess T1 agentA >/dev/null
before="$(cat .agent-relay/implement-plan-sess/T1.status)"
if "$TASK_CLAIM" update sess T1 agentA bogus-status >/dev/null 2>&1; then
  fail "bogus status rejected"
else
  pass "bogus status rejected"
fi
after="$(cat .agent-relay/implement-plan-sess/T1.status)"
[[ "$before" == "$after" ]] && pass "bogus status leaves file unchanged" || fail "bogus status leaves file unchanged"
if "$TASK_CLAIM" update sess T1 agentA done "extra reason" >/dev/null 2>&1; then
  fail "done rejects extra reason"
else
  pass "done rejects extra reason"
fi
if "$TASK_CLAIM" update sess T1 agentA skipped >/dev/null 2>&1; then
  fail "skipped requires reason"
else
  pass "skipped requires reason"
fi
"$TASK_CLAIM" update sess T1 agentA skipped "nope" >/dev/null
"$TASK_CLAIM" release sess T1 agentA >/dev/null

# --- T9: cycle detection + blocked list + allow-skipped-deps ---
cat <<'EOF' > .agent-relay/plan-cycle.md
base: main
id: cycle
## Tasks
1. **A.** (deps: T2)
2. **B.** (deps: T1)
EOF
if "$TASK_INIT" cycle >/dev/null 2>&1; then
  fail "cycle deps fail at task-init"
else
  pass "cycle deps fail at task-init"
fi

cat <<'EOF' > .agent-relay/plan-block.md
base: main
id: block
## Tasks
1. **A.** first
2. **B.** second (deps: T1)
EOF
"$TASK_INIT" block >/dev/null
LIST_BLOCK="$("$TASK_CLAIM" list block)"
echo "$LIST_BLOCK" | grep -q 'blocked:' && pass "list shows blocked reason" || fail "list shows blocked reason"

cat <<'EOF' > .agent-relay/plan-skipdep.md
base: main
id: skipdep
## Tasks
1. **A.** first
2. **B.** second (deps: T1)
EOF
"$TASK_INIT" skipdep >/dev/null
"$TASK_CLAIM" claim skipdep T1 a >/dev/null
"$TASK_CLAIM" update skipdep T1 a skipped "waived" >/dev/null
"$TASK_CLAIM" release skipdep T1 a >/dev/null
if "$TASK_CLAIM" claim skipdep T2 b >/dev/null 2>&1; then
  fail "skipped dep blocks by default"
else
  pass "skipped dep blocks by default"
fi
if "$TASK_CLAIM" --allow-skipped-deps claim skipdep T2 b >/dev/null; then
  pass "claim --allow-skipped-deps works"
else
  fail "claim --allow-skipped-deps works"
fi
"$TASK_CLAIM" release skipdep T2 b >/dev/null

# steal must not be a backdoor around claim/deps
if "$TASK_CLAIM" steal skipdep T2 sneaky >/dev/null 2>&1; then
  fail "steal without lock fails"
else
  pass "steal without lock fails"
fi

cat <<'EOF' > .agent-relay/plan-stealdep.md
base: main
id: stealdep
## Tasks
1. **A.** first
2. **B.** second (deps: T1)
EOF
"$TASK_INIT" stealdep >/dev/null
# Hung lock on T2 while T1 still pending — steal must refuse unmet deps
mkdir -p .agent-relay/implement-plan-stealdep/.lock-T2
printf 'holder %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" > .agent-relay/implement-plan-stealdep/.lock-T2/owner
echo "$(( $(date +%s) - 10800 ))" > .agent-relay/implement-plan-stealdep/.lock-T2/created_epoch
if "$TASK_CLAIM" steal stealdep T2 taker >/dev/null 2>&1; then
  fail "steal respects unmet deps"
else
  pass "steal respects unmet deps"
fi
"$TASK_CLAIM" claim stealdep T1 owner1 >/dev/null
"$TASK_CLAIM" update stealdep T1 owner1 done >/dev/null
if "$TASK_CLAIM" steal stealdep T2 taker >/dev/null 2>&1; then
  pass "steal ok when deps satisfied"
else
  fail "steal ok when deps satisfied"
fi
"$TASK_CLAIM" release stealdep T2 taker >/dev/null

cat <<'EOF' > .agent-relay/plan-missingdep.md
base: main
id: missingdep
## Tasks
1. **A.** (deps: T99)
EOF
if "$TASK_INIT" missingdep >/dev/null 2>&1; then
  fail "missing dep fails at init"
else
  pass "missing dep fails at init"
fi

# --- T10: portable sort without sort -V ---
cat <<'EOF' > .agent-relay/plan-sort.md
base: main
id: sort
## Tasks
1. **A.**
2. **B.**
3. **C.**
EOF
"$TASK_INIT" sort >/dev/null
# Drop .order so get_ordered_tasks falls back to sorting status filenames
rm -f .agent-relay/implement-plan-sort/.order
# Add an out-of-order id that needs numeric-aware sort
printf 'status: pending\ndesc: ten\ndeps: \n' > .agent-relay/implement-plan-sort/T10.status
FAKEBIN="$T/fakebin"
mkdir -p "$FAKEBIN"
cat > "$FAKEBIN/sort" <<'FAKE'
#!/usr/bin/env bash
for a in "$@"; do
  if [[ "$a" == "-V" ]]; then
    echo "sort: invalid option -- V" >&2
    exit 2
  fi
done
exec /usr/bin/sort "$@"
FAKE
chmod +x "$FAKEBIN/sort"
ORDER_OUT="$(PATH="$FAKEBIN:$PATH" "$TASK_CLAIM" list sort)"
# T10 must not sort before T2 (lexicographic T10 < T2); numeric pad puts T2 first
first="$(echo "$ORDER_OUT" | grep -E 'T[0-9]+:' | head -n 1)"
echo "$first" | grep -q 'T1:' && pass "portable sort lists T1 first" || fail "portable sort lists T1 first (got: $first)"
echo "$ORDER_OUT" | grep -n 'T10:' >/dev/null && pass "portable sort includes T10" || fail "portable sort includes T10"
# Confirm T2 appears before T10
t2n="$(echo "$ORDER_OUT" | grep -n 'T2:' | head -1 | cut -d: -f1)"
t10n="$(echo "$ORDER_OUT" | grep -n 'T10:' | head -1 | cut -d: -f1)"
[[ "$t2n" -lt "$t10n" ]] && pass "portable sort T2 before T10" || fail "portable sort T2 before T10 ($t2n/$t10n)"

# --- T11: base dir walk-up ---
cat <<'EOF' > .agent-relay/plan-walk.md
base: main
id: walk
## Tasks
1. **W.** walk
EOF
"$TASK_INIT" walk >/dev/null
"$TASK_CLAIM" claim walk T1 w1 >/dev/null
mkdir -p deep/nested
WALK_LIST="$(cd deep/nested && "$TASK_CLAIM" list walk)"
echo "$WALK_LIST" | grep -q 'T1:' && pass "list from nested cwd finds plan" || fail "list from nested cwd finds plan"
# Must not have created a second .agent-relay under deep/
if [[ -d deep/.agent-relay || -d deep/nested/.agent-relay ]]; then
  fail "must not create nested .agent-relay"
else
  pass "no nested .agent-relay created"
fi
"$TASK_CLAIM" release walk T1 w1 >/dev/null

# --- T17: review-section.sh upsert preserves other sections ---
REVIEW_SH="$ROOT/scripts/review-section.sh"
TODAY="$(date +%F)"
RF="$T/review-upsert.md"
cat > "$RF" <<EOF
## Self-Review — $TODAY

self body v1

## Cross-Review — $TODAY

cross body must survive
EOF
printf '%s\n' 'self body v2' > "$T/self-body.md"
"$REVIEW_SH" upsert "$RF" Self-Review "$TODAY" "$T/self-body.md"
grep -q 'self body v2' "$RF" && pass "upsert replaces Self-Review" || fail "upsert replaces Self-Review"
grep -q 'cross body must survive' "$RF" && pass "upsert keeps Cross-Review bytes" || fail "upsert keeps Cross-Review bytes"
# exact Cross-Review section still present
grep -q "## Cross-Review — $TODAY" "$RF" && pass "upsert keeps Cross-Review heading" || fail "upsert keeps Cross-Review heading"

# --- CR-1: headings inside fenced code blocks are not section boundaries ---
# Review bodies quote heading formats inside fences (the cross-review skill's
# own "Plan amendment" example does). Treating those as boundaries truncated
# the section and orphaned the rest of the body on the next upsert.
FRF="$T/review-fence.md"
cat > "$FRF" <<EOF
## Self-Review — $TODAY

old body

## Cross-Review — $TODAY

cross body must survive
EOF
cat > "$T/fence-body.md" <<'EOF'
Use this heading form:

```markdown
## Plan amendment — 2026-01-01
- note
```

TAIL_AFTER_FENCE belongs to this section.
EOF
"$REVIEW_SH" upsert "$FRF" Self-Review "$TODAY" "$T/fence-body.md"
cp "$FRF" "$T/review-fence.after1"
"$REVIEW_SH" upsert "$FRF" Self-Review "$TODAY" "$T/fence-body.md"
"$REVIEW_SH" upsert "$FRF" Self-Review "$TODAY" "$T/fence-body.md"

if cmp -s "$T/review-fence.after1" "$FRF"; then
  pass "upsert with fenced heading is idempotent"
else
  fail "upsert with fenced heading is idempotent"
fi
if [[ "$(grep -c 'TAIL_AFTER_FENCE' "$FRF")" -eq 1 ]]; then
  pass "no orphaned body after fenced heading"
else
  fail "no orphaned body after fenced heading"
fi
if [[ "$(grep -c 'cross body must survive' "$FRF")" -eq 1 ]]; then
  pass "fenced-heading upsert keeps Cross-Review"
else
  fail "fenced-heading upsert keeps Cross-Review"
fi

# Unbalanced fence: already-malformed input must warn and fall back, not
# swallow every following section.
UF="$T/review-unbalanced.md"
printf '## Self-Review — %s\n\n```\nunclosed\n\n## Cross-Review — %s\n\nkeep me\n' "$TODAY" "$TODAY" > "$UF"
"$REVIEW_SH" upsert "$UF" Self-Review "$TODAY" "$T/self-body.md" 2>/dev/null
if grep -q 'keep me' "$UF"; then
  pass "unbalanced fence falls back without dropping sections"
else
  fail "unbalanced fence falls back without dropping sections"
fi

# Idempotency when the target section is not at line 1. The earlier fixture
# started with the heading, which hid a stuck "previous line was non-empty"
# flag that appended one extra blank line on every run.
MID="$T/review-mid.md"
cat > "$MID" <<EOF
# Report title

intro paragraph

## Self-Review — $TODAY

old body

## Cross-Review — $TODAY

cross tail
EOF
"$REVIEW_SH" upsert "$MID" Cross-Review "$TODAY" "$T/fence-body.md"
cp "$MID" "$T/review-mid.after1"
"$REVIEW_SH" upsert "$MID" Cross-Review "$TODAY" "$T/fence-body.md"
"$REVIEW_SH" upsert "$MID" Cross-Review "$TODAY" "$T/fence-body.md"
if cmp -s "$T/review-mid.after1" "$MID"; then
  pass "upsert idempotent for a mid-file section"
else
  fail "upsert idempotent for a mid-file section"
fi
if [[ "$(grep -c '^$' "$MID")" -eq "$(grep -c '^$' "$T/review-mid.after1")" ]]; then
  pass "upsert does not accumulate blank lines"
else
  fail "upsert does not accumulate blank lines"
fi

# --- CR-2: skill bundle copies must not drift from their sources ---
if bash "$ROOT/scripts/sync-references.sh" --check >/dev/null 2>&1; then
  pass "skill bundles in sync with sources"
else
  fail "skill bundles in sync with sources"
fi
_drift_target="$ROOT/skills/atry-implement/scripts/task-claim.sh"
cp "$_drift_target" "$T/drift-backup.sh"
printf '# drift\n' >> "$_drift_target"
if bash "$ROOT/scripts/sync-references.sh" --check >/dev/null 2>&1; then
  fail "sync --check detects bundle script drift"
else
  pass "sync --check detects bundle script drift"
fi
cp "$T/drift-backup.sh" "$_drift_target"

if [[ "$FAIL" -eq 0 ]]; then
  echo "ALL TASK TESTS PASSED"
else
  echo "SOME TASK TESTS FAILED"
  exit 1
fi
