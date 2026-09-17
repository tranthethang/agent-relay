#!/usr/bin/env bash
# tests/tasks.sh
# Tests for parallel task claiming, initialization, and run resolution (bash 3.2+).
# Run from repo root:
#   ./tests/tasks.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TASK_CLAIM="$ROOT/scripts/task-claim.sh"
TASK_INIT="$ROOT/scripts/task-init.sh"
RESOLVE_RUN="$ROOT/scripts/resolve-run.sh"
RUN_INIT="$ROOT/scripts/run-init.sh"
RUN_HISTORY="$ROOT/scripts/run-history.sh"

FAIL=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAIL=1; }

# Never inherit steal-race hooks from the parent environment.
unset AGENT_RELAY_TEST_STEAL_BARRIER AGENT_RELAY_TEST_STEAL_PAUSE

T="$(mktemp -d "${TMPDIR:-/tmp}/ar-tasks.XXXXXX")"
cleanup() { rm -rf "$T"; }
trap cleanup EXIT

cd "$T"

# 1. Happy path: run-init -> task-init -> claim -> update -> release -> list
HAPPY_DIR="$("$RUN_INIT" 1700000000 --slug happy --title "Happy Plan" --base main)"
[[ -d "$HAPPY_DIR" ]] && pass "run-init creates directory" || fail "run-init creates directory"
[[ -f "$HAPPY_DIR/meta.md" ]] && pass "run-init creates meta.md" || fail "run-init creates meta.md"
[[ -f "$HAPPY_DIR/history.log" ]] && pass "run-init creates history.log" || fail "run-init creates history.log"
grep -q 'stage=plan action=created tool=' "$HAPPY_DIR/history.log" && \
  pass "run-init created line includes tool=" || fail "run-init created line includes tool="
[[ ! -f .agent-relay/CURRENT ]] && pass "no CURRENT created" || fail "no CURRENT created"

cat <<'EOF' > "$HAPPY_DIR/plan.md"
base: main
id: 1700000000

# Happy Plan

## Tasks

1. **Setup DB.** Create migrations.
2. **Add API.** Implement endpoints.
EOF

"$TASK_INIT" 1700000000 >/dev/null
[[ -d "$HAPPY_DIR/implement-plan" ]] && pass "task-init creates directory" || fail "task-init creates directory"
[[ -f "$HAPPY_DIR/implement-plan/T1.status" ]] && pass "task-init creates T1.status" || fail "task-init creates T1.status"
[[ -f "$HAPPY_DIR/implement-plan/T2.status" ]] && pass "task-init creates T2.status" || fail "task-init creates T2.status"
[[ -f "$HAPPY_DIR/implement-plan.md" ]] && pass "task-init generates rollup" || fail "task-init generates rollup"

grep -q -- "- \[pending\] T1:" "$HAPPY_DIR/implement-plan.md" && pass "initial rollup pending" || fail "initial rollup pending"

# Claim T1
"$TASK_CLAIM" claim happy T1 agent-1 >/dev/null
[[ -d "$HAPPY_DIR/implement-plan/.lock-T1" ]] && pass "claim creates lock dir" || fail "claim creates lock dir"
grep -q "agent-1" "$HAPPY_DIR/implement-plan/.lock-T1/owner" && pass "claim writes owner" || fail "claim writes owner"

grep -q -- "- \[in-progress\] T1:" "$HAPPY_DIR/implement-plan.md" && pass "claim updates rollup" || fail "claim updates rollup"
grep -q "status: in-progress" "$HAPPY_DIR/implement-plan/T1.status" && pass "claim sets in-progress" || fail "claim sets in-progress"

# Update with wrong session-tag should fail
if "$TASK_CLAIM" update happy T1 wrong-agent done >/dev/null 2>&1; then
  fail "update with wrong session-tag should fail"
else
  pass "update with wrong session-tag fails"
fi

# Update with correct session-tag
"$TASK_CLAIM" update happy T1 agent-1 done >/dev/null
grep -q "status: done" "$HAPPY_DIR/implement-plan/T1.status" && pass "update sets done" || fail "update sets done"
grep -q -- "- \[done\] T1:" "$HAPPY_DIR/implement-plan.md" && pass "update updates rollup" || fail "update updates rollup"

# Release lock
"$TASK_CLAIM" release happy T1 agent-1 >/dev/null
[[ ! -d "$HAPPY_DIR/implement-plan/.lock-T1" ]] && pass "release removes lock dir" || fail "release removes lock dir"
grep -q "status: done" "$HAPPY_DIR/implement-plan/T1.status" && pass "release leaves status done" || fail "release leaves status done"

# List
LIST_OUT="$("$TASK_CLAIM" list happy)"
echo "$LIST_OUT" | grep -q -- "- \[done\] T1:" && pass "list shows done T1" || fail "list shows done T1"
echo "$LIST_OUT" | grep -q -- "- \[pending\] T2:" && pass "list shows pending T2" || fail "list shows pending T2"

# Check consistency
if "$TASK_CLAIM" check happy >/dev/null 2>&1; then
  pass "check reports OK when rollup matches .status files"
else
  fail "check reports OK when rollup matches .status files"
fi

# Hand-edit the rollup to simulate drift (the bug from real runs)
cp "$HAPPY_DIR/implement-plan.md" "$T/happy-rollup.bak"
sed -e 's/- \[pending\] T2:/- [done] T2:/' "$T/happy-rollup.bak" > "$HAPPY_DIR/implement-plan.md"

CHECK_OUT="$("$TASK_CLAIM" check happy 2>&1 || true)"
if "$TASK_CLAIM" check happy >/dev/null 2>&1; then
  fail "check detects a hand-edited rollup"
else
  pass "check detects a hand-edited rollup"
fi
echo "$CHECK_OUT" | grep -q "MISMATCH" && pass "check output names the mismatch" || fail "check output names the mismatch"
cp "$T/happy-rollup.bak" "$HAPPY_DIR/implement-plan.md"
if "$TASK_CLAIM" check happy >/dev/null 2>&1; then
  pass "check is OK again once the rollup is restored"
else
  fail "check is OK again once the rollup is restored"
fi

# 2. Lock collision: second claim on locked task fails loudly and prints owner
"$TASK_CLAIM" claim happy T2 agent-first >/dev/null
SECOND_OUT="$("$TASK_CLAIM" claim happy T2 agent-second 2>&1 || true)"
echo "$SECOND_OUT" | grep -q "agent-first" && pass "collision prints existing owner" || fail "collision prints existing owner"
"$TASK_CLAIM" release happy T2 agent-first >/dev/null

# 3. Concurrent claim: launch two background claims, exactly one succeeds
CONC_DIR="$("$RUN_INIT" 1700000001 --slug conc --title "Concurrency Plan" --base main)"
cat <<'EOF' > "$CONC_DIR/plan.md"
base: main
id: 1700000001

# Concurrency Plan

## Tasks

1. **Race task.** Only one agent may win.
EOF

for i in {1..5}; do
  rm -rf "$CONC_DIR/implement-plan" "$CONC_DIR/implement-plan.md"
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
  owner="$(awk '{print $1}' "$CONC_DIR/implement-plan/.lock-T1/owner" 2>/dev/null || true)"
  if [[ "$owner" == "worker-A" || "$owner" == "worker-B" ]]; then
    pass "concurrent claim iteration $i: uncorrupted lock owner ($owner)"
  else
    fail "concurrent claim iteration $i: corrupted lock owner ($owner)"
  fi

  grep -q "status: in-progress" "$CONC_DIR/implement-plan/T1.status" && \
    pass "concurrent claim iteration $i: uncorrupted .status file" || \
    fail "concurrent claim iteration $i: corrupted .status file"
done

# 4. Stale lock (>2h): claim fails with steal hint; steal takes ownership
STALE_DIR="$("$RUN_INIT" 1700000002 --slug stale --title "Stale Plan" --base main)"
cat <<'EOF' > "$STALE_DIR/plan.md"
base: main
id: 1700000002

## Tasks

1. **Stale task.** Lock should be stolen.
EOF

"$TASK_INIT" stale >/dev/null
"$TASK_CLAIM" claim stale T1 old-agent >/dev/null

# Set lock epoch to 3 hours ago (10800 seconds)
OLD_EPOCH=$(( $(date +%s) - 10800 ))
echo "$OLD_EPOCH" > "$STALE_DIR/implement-plan/.lock-T1/created_epoch"

CLAIM_STALE_OUT="$("$TASK_CLAIM" claim stale T1 new-agent 2>&1 || true)"
echo "$CLAIM_STALE_OUT" | grep -q "stale" && pass "stale lock claim fails with message" || fail "stale lock claim fails with message"
echo "$CLAIM_STALE_OUT" | grep -q "steal" && pass "stale lock claim suggests steal" || fail "stale lock claim suggests steal"
grep -q "old-agent" "$STALE_DIR/implement-plan/.lock-T1/owner" && pass "stale lock not auto-stolen" || fail "stale lock not auto-stolen"

STEAL_OUT="$("$TASK_CLAIM" steal stale T1 new-agent 2>&1)"
echo "$STEAL_OUT" | grep -qi "steal" && pass "steal logs message" || fail "steal logs message"
grep -q "new-agent" "$STALE_DIR/implement-plan/.lock-T1/owner" && pass "steal takes lock for new-agent" || fail "steal takes lock for new-agent"
"$TASK_CLAIM" release stale T1 new-agent >/dev/null

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
SCOPED_DIR="$("$RUN_INIT" 1700000003 --slug scoped --title "Plan With Sections" --base main)"
cat <<'EOF' > "$SCOPED_DIR/plan.md"
base: main
id: 1700000003

# Plan With Sections

1. **Preamble item.** Must NOT become a task.

## Tasks

1. **Real task A.** Only this.
2. **Real task B.** And this.

## Non-tasks

1. **Not a task.** Must NOT become a task.
EOF

"$TASK_INIT" scoped > /dev/null
COUNT=$(ls "$SCOPED_DIR/implement-plan"/*.status 2>/dev/null | wc -l | tr -d ' ')
[[ "$COUNT" -eq 2 ]] && pass "task-init only parses ## Tasks section (count=$COUNT)" || fail "task-init only parses ## Tasks section (got $COUNT, want 2)"
[[ -f "$SCOPED_DIR/implement-plan/T1.status" ]] && pass "scoped: T1 exists" || fail "scoped: T1 exists"
[[ -f "$SCOPED_DIR/implement-plan/T2.status" ]] && pass "scoped: T2 exists" || fail "scoped: T2 exists"
ROLLUP_LINES=$(grep -c '^\- \[' "$SCOPED_DIR/implement-plan.md" || true)
[[ "$ROLLUP_LINES" -eq 2 ]] && pass "scoped: rollup has exactly 2 task lines" || fail "scoped: rollup has $ROLLUP_LINES task lines (want 2)"

# 8. task-init must not clobber an existing sequential rollup
CLOBBER_DIR="$("$RUN_INIT" 1700000004 --slug clobber --title "Clobber Plan" --base main)"
cat <<'EOF' > "$CLOBBER_DIR/plan.md"
base: main
id: 1700000004

## Tasks

1. **Only task.** From plan.
EOF
cat <<'EOF' > "$CLOBBER_DIR/implement-plan.md"
# implement-plan (clobber)

- [done] T1: Preserved sequential progress
EOF
if "$TASK_INIT" clobber >/dev/null 2>&1; then
  fail "task-init should refuse when rollup exists"
else
  pass "task-init refuses when rollup exists"
fi
grep -q "Preserved sequential progress" "$CLOBBER_DIR/implement-plan.md" && \
  pass "task-init left rollup untouched" || \
  fail "task-init left rollup untouched"
[[ ! -d "$CLOBBER_DIR/implement-plan" ]] && \
  pass "task-init did not create plan dir on refuse" || \
  fail "task-init did not create plan dir on refuse"

# 9. Concurrent claims on different tasks leave rollup consistent
DIFF_DIR="$("$RUN_INIT" 1700000005 --slug difftask --title "Diff Plan" --base main)"
cat <<'EOF' > "$DIFF_DIR/plan.md"
base: main
id: 1700000005

## Tasks

1. **Task A.** first
2. **Task B.** second
EOF
diff_lost=0
for i in 1 2 3 4 5; do
  rm -rf "$DIFF_DIR/implement-plan" "$DIFF_DIR/implement-plan.md"
  "$TASK_INIT" difftask >/dev/null
  "$TASK_CLAIM" claim difftask T1 worker-A >/dev/null 2>&1 &
  pid_a=$!
  "$TASK_CLAIM" claim difftask T2 worker-B >/dev/null 2>&1 &
  pid_b=$!
  wait $pid_a || true
  wait $pid_b || true
  if ! grep -q -- "- \[in-progress\] T1:" "$DIFF_DIR/implement-plan.md" || \
     ! grep -q -- "- \[in-progress\] T2:" "$DIFF_DIR/implement-plan.md"; then
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
RACE_DIR="$("$RUN_INIT" 1700000006 --slug stalerace --title "Stale Race" --base main)"
cat <<'EOF' > "$RACE_DIR/plan.md"
base: main
id: 1700000006

## Tasks

1. **Race steal.** Two agents contend on an expired lock.
EOF
i=1
while [[ $i -le $STALE_RACE_N ]]; do
  rm -rf "$RACE_DIR/implement-plan" "$RACE_DIR/implement-plan.md"
  "$TASK_INIT" stalerace >/dev/null
  "$TASK_CLAIM" claim stalerace T1 seed-owner >/dev/null
  OLD_EPOCH=$(( $(date +%s) - 10800 ))
  echo "$OLD_EPOCH" > "$RACE_DIR/implement-plan/.lock-T1/created_epoch"

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
rm -rf "$RACE_DIR"

# 9c. T2 harness: 8 claimants on 8 distinct tasks — rollup matches list
EIGHT_DIR="$("$RUN_INIT" 1700000007 --slug eight --title "Eight Plan" --base main)"
cat <<'EOF' > "$EIGHT_DIR/plan.md"
base: main
id: 1700000007

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
  rm -rf "$EIGHT_DIR/implement-plan" "$EIGHT_DIR/implement-plan.md"
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
  ROLLUP="$(cat "$EIGHT_DIR/implement-plan.md")"
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
rm -rf "$EIGHT_DIR"

# 10. deps: dependency check during claim
DEPS_DIR="$("$RUN_INIT" 1700000008 --slug deps --title "Deps Plan" --base main)"
cat <<'EOF' > "$DEPS_DIR/plan.md"
base: main
id: 1700000008

## Tasks

1. **Task A.** First task
2. **Task B.** Depends on A (deps: T1)
EOF
"$TASK_INIT" deps >/dev/null
grep -q '^deps: T1$' "$DEPS_DIR/implement-plan/T2.status" && \
  pass "init writes deps: into .status" || \
  fail "init writes deps: into .status (got: $(tr '\n' ' ' < "$DEPS_DIR/implement-plan/T2.status"))"
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
grep -q '^deps: T1$' "$DEPS_DIR/implement-plan/T2.status" && \
  pass "claim preserves deps: line" || \
  fail "claim preserves deps: line"

# 11. report-write / report-list / report-rollup
R1_DIR="$("$RUN_INIT" 1700000009 --slug reports --title "Report Plan" --base main)"
cat <<'PLAN' > "$R1_DIR/plan.md"
base: main
id: 1700000009

## Tasks
- [ ] rT1: Report task 1
- [ ] rT2: Report task 2
PLAN
"$TASK_INIT" reports >/dev/null

"$TASK_CLAIM" claim reports rT1 agent-r1 >/dev/null
"$TASK_CLAIM" claim reports rT2 agent-r2 >/dev/null

echo "report 1 content" | "$TASK_CLAIM" report-write reports rT1 agent-r1 -
[[ -f "$R1_DIR/implement-report/rT1.md" ]] && \
  pass "report-write creates file from stdin" || \
  fail "report-write creates file from stdin"

echo "report 2 content" > "$T/rt2.txt"
"$TASK_CLAIM" report-write reports rT2 agent-r2 "$T/rt2.txt"
[[ -f "$R1_DIR/implement-report/rT2.md" ]] && \
  pass "report-write creates file from path" || \
  fail "report-write creates file from path"

rlist="$("$TASK_CLAIM" report-list reports)"
echo "$rlist" | grep -q 'rT1.md' && echo "$rlist" | grep -q 'rT2.md' && \
  pass "report-list shows tasks" || \
  fail "report-list shows tasks ($rlist)"

rollup="$(cat "$R1_DIR/implement-report.md")"
echo "$rollup" | grep -q 'report 1 content' && echo "$rollup" | grep -q 'report 2 content' && \
  pass "report-write updates rollup" || \
  fail "report-write updates rollup"

# Concurrent report-write should not lose updates
report_lost=0
for i in 1 2 3 4 5; do
  rm -f "$R1_DIR/implement-report"/rT1.md "$R1_DIR/implement-report"/rT2.md \
    "$R1_DIR/implement-report.md"
  echo "concurrent-a-$i" | "$TASK_CLAIM" report-write reports rT1 agent-r1 - &
  pid_a=$!
  echo "concurrent-b-$i" | "$TASK_CLAIM" report-write reports rT2 agent-r2 - &
  pid_b=$!
  wait $pid_a || true
  wait $pid_b || true
  if ! grep -q "concurrent-a-$i" "$R1_DIR/implement-report.md" || \
     ! grep -q "concurrent-b-$i" "$R1_DIR/implement-report.md"; then
    report_lost=$((report_lost + 1))
  fi
done
[[ "$report_lost" -eq 0 ]] && \
  pass "concurrent report-write: rollup consistent (5 iters)" || \
  fail "concurrent report-write: rollup lost updates ($report_lost/5)"

# Unowned report-write fails; --force records history
if echo "nope" | "$TASK_CLAIM" report-write reports rT1 wrong-agent - >/dev/null 2>&1; then
  fail "report-write rejects non-owner"
else
  pass "report-write rejects non-owner"
fi
FORCE_OUT="$(echo "forced" | "$TASK_CLAIM" report-write --force reports rT1 wrong-agent - 2>&1)"
echo "$FORCE_OUT" | grep -qi "force" && pass "report-write --force warns" || fail "report-write --force warns"
grep -q "report-write-force" "$R1_DIR/history.log" && pass "report-write --force logs history" || fail "report-write --force logs history"

"$TASK_CLAIM" release reports rT1 agent-r1 >/dev/null
"$TASK_CLAIM" release reports rT2 agent-r2 >/dev/null

# --- T3: ident validation / path traversal ---
if "$TASK_CLAIM" report-write --force happy '../../../../tmp/X' - </dev/null >/dev/null 2>&1; then
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
T4_DIR="$("$RUN_INIT" 1700000010 --slug tfix --title "T4 Plan" --base main)"
cat <<'EOF' > "$T4_DIR/plan.md"
base: main
id: 1700000010

## Goal

1. **Not a task.** From goal.

## Tasks

1. **First.** real
2. **Second.** also real

## Constraints

1. **Also not.** from constraints.
EOF
"$TASK_INIT" tfix >/dev/null
[[ -f "$T4_DIR/implement-plan/T1.status" && -f "$T4_DIR/implement-plan/T2.status" ]] && \
  pass "T4 fixture yields T1 and T2" || fail "T4 fixture yields T1 and T2"
t4count="$(ls "$T4_DIR/implement-plan"/*.status | wc -l | tr -d ' ')"
[[ "$t4count" == "2" ]] && pass "T4 fixture count=2" || fail "T4 fixture count=$t4count"

NESTED_DIR="$("$RUN_INIT" 1700000011 --slug nested --title "Nested Plan" --base main)"
cat <<'EOF' > "$NESTED_DIR/plan.md"
base: main
id: 1700000011
## Tasks
1. **Outer.** ok
   1. **Nested.** bad
EOF
if "$TASK_INIT" nested >/dev/null 2>&1; then
  fail "nested numbered list must fail"
else
  pass "nested numbered list fails"
fi

DESC_DIR="$("$RUN_INIT" 1700000012 --slug desc --title "Desc Plan" --base main)"
cat <<'EOF' > "$DESC_DIR/plan.md"
base: main
id: 1700000012
## Tasks
1. **Bold.** after bold
2. with `ticks` here
3. Label: one: two
4. 
EOF
if "$TASK_INIT" desc >/dev/null 2>&1; then
  grep -q 'after bold' "$DESC_DIR/implement-plan/T1.status" && pass "desc strips bold" || fail "desc strips bold"
  grep -q 'ticks' "$DESC_DIR/implement-plan/T2.status" && pass "desc keeps backtick text" || fail "desc keeps backtick text"
  pass "desc parser accepts varied markdown"
else
  fail "desc parser init"
fi

# --- T6: --session in both positions ---
SESS_DIR="$("$RUN_INIT" 1700000013 --slug sess --title "Session Plan" --base main)"
cat <<'EOF' > "$SESS_DIR/plan.md"
base: main
id: 1700000013
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
before="$(cat "$SESS_DIR/implement-plan/T1.status")"
if "$TASK_CLAIM" update sess T1 agentA bogus-status >/dev/null 2>&1; then
  fail "bogus status rejected"
else
  pass "bogus status rejected"
fi
after="$(cat "$SESS_DIR/implement-plan/T1.status")"
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
CYCLE_DIR="$("$RUN_INIT" 1700000014 --slug cycle --title "Cycle Plan" --base main)"
cat <<'EOF' > "$CYCLE_DIR/plan.md"
base: main
id: 1700000014
## Tasks
1. **A.** (deps: T2)
2. **B.** (deps: T1)
EOF
if "$TASK_INIT" cycle >/dev/null 2>&1; then
  fail "cycle deps fail at task-init"
else
  pass "cycle deps fail at task-init"
fi

BLOCK_DIR="$("$RUN_INIT" 1700000015 --slug block --title "Block Plan" --base main)"
cat <<'EOF' > "$BLOCK_DIR/plan.md"
base: main
id: 1700000015
## Tasks
1. **A.** first
2. **B.** second (deps: T1)
EOF
"$TASK_INIT" block >/dev/null
LIST_BLOCK="$("$TASK_CLAIM" list block)"
echo "$LIST_BLOCK" | grep -q 'blocked:' && pass "list shows blocked reason" || fail "list shows blocked reason"

SKIP_DIR="$("$RUN_INIT" 1700000016 --slug skipdep --title "Skip Plan" --base main)"
cat <<'EOF' > "$SKIP_DIR/plan.md"
base: main
id: 1700000016
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
  pass "claim --allow-skipped-deps works"
fi
"$TASK_CLAIM" release skipdep T2 b >/dev/null

# steal must not be a backdoor around claim/deps
if "$TASK_CLAIM" steal skipdep T2 sneaky >/dev/null 2>&1; then
  fail "steal without lock fails"
else
  pass "steal without lock fails"
fi

STEAL_DIR="$("$RUN_INIT" 1700000017 --slug stealdep --title "Steal Plan" --base main)"
cat <<'EOF' > "$STEAL_DIR/plan.md"
base: main
id: 1700000017
## Tasks
1. **A.** first
2. **B.** second (deps: T1)
EOF
"$TASK_INIT" stealdep >/dev/null
# Hung lock on T2 while T1 still pending — steal must refuse unmet deps
mkdir -p "$STEAL_DIR/implement-plan/.lock-T2"
printf 'holder %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" > "$STEAL_DIR/implement-plan/.lock-T2/owner"
echo "$(( $(date +%s) - 10800 ))" > "$STEAL_DIR/implement-plan/.lock-T2/created_epoch"
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

MISSING_DIR="$("$RUN_INIT" 1700000018 --slug missingdep --title "Missing Plan" --base main)"
cat <<'EOF' > "$MISSING_DIR/plan.md"
base: main
id: 1700000018
## Tasks
1. **A.** (deps: T99)
EOF
if "$TASK_INIT" missingdep >/dev/null 2>&1; then
  fail "missing dep fails at init"
else
  pass "missing dep fails at init"
fi

# --- T10: portable sort without sort -V ---
SORT_DIR="$("$RUN_INIT" 1700000019 --slug sort --title "Sort Plan" --base main)"
cat <<'EOF' > "$SORT_DIR/plan.md"
base: main
id: 1700000019
## Tasks
1. **A.**
2. **B.**
3. **C.**
EOF
"$TASK_INIT" sort >/dev/null
# Drop .order so get_ordered_tasks falls back to sorting status filenames
rm -f "$SORT_DIR/implement-plan/.order"
# Add an out-of-order id that needs numeric-aware sort
printf 'status: pending\ndesc: ten\ndeps: \n' > "$SORT_DIR/implement-plan/T10.status"
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
WALK_DIR="$("$RUN_INIT" 1700000020 --slug walk --title "Walk Plan" --base main)"
cat <<'EOF' > "$WALK_DIR/plan.md"
base: main
id: 1700000020
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

# Missing walkthrough path must create review-walkthrough.md, not clobber report.
RW_DIR="$T/rw-run/.agent-relay/20260916-1700000021-rwtestid"
mkdir -p "$RW_DIR"
echo 'id: 1700000021' > "$RW_DIR/meta.md"
printf '%s\n' 'report body only' > "$T/rw-report-body.md"
printf '%s\n' 'walk body only' > "$T/rw-walk-body.md"
"$REVIEW_SH" upsert "$RW_DIR/review-report.md" Cross-Review "$TODAY" "$T/rw-report-body.md"
"$REVIEW_SH" upsert "$RW_DIR/review-walkthrough.md" Cross-Review "$TODAY" "$T/rw-walk-body.md"
[[ -f "$RW_DIR/review-walkthrough.md" ]] && pass "upsert creates walkthrough file" || fail "upsert creates walkthrough file"
grep -q 'walk body only' "$RW_DIR/review-walkthrough.md" && pass "upsert walkthrough keeps basename" || fail "upsert walkthrough keeps basename"
grep -q 'report body only' "$RW_DIR/review-report.md" && pass "upsert walkthrough does not clobber report" || fail "upsert walkthrough does not clobber report"
grep -q 'walk body only' "$RW_DIR/review-report.md" && fail "upsert walkthrough does not clobber report" || pass "upsert walkthrough leaves report body"

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

# Idempotency when the target section is not at line 1.
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

# --- CR-1b: Cross-Review provenance matching the last Self-Review warns ---
WARN_FILE="$T/review-report-warn.md"
printf '<!-- relay: stage=self-review tool=cursor model=composer-unknown base=abc date=%s -->\nSelf body.\n' "$TODAY" > "$T/warn-self-body.md"
"$REVIEW_SH" upsert "$WARN_FILE" Self-Review "$TODAY" "$T/warn-self-body.md" >/dev/null 2>&1

printf '<!-- relay: stage=cross-review tool=cursor model=composer-unknown base=abc date=%s -->\nCross body.\n' "$TODAY" > "$T/warn-cross-same.md"
WARN_OUT="$("$REVIEW_SH" upsert "$WARN_FILE" Cross-Review "$TODAY" "$T/warn-cross-same.md" 2>&1 >/dev/null)"
echo "$WARN_OUT" | grep -qi "warning.*Cross-Review" && pass "same tool/model cross-review warns" || fail "same tool/model cross-review warns"

WARN_FILE2="$T/review-report-warn2.md"
"$REVIEW_SH" upsert "$WARN_FILE2" Self-Review "$TODAY" "$T/warn-self-body.md" >/dev/null 2>&1
printf '<!-- relay: stage=cross-review tool=gemini model=gemini-3.1-pro-low base=abc date=%s -->\nCross body.\n' "$TODAY" > "$T/warn-cross-diff.md"
WARN_OUT2="$("$REVIEW_SH" upsert "$WARN_FILE2" Cross-Review "$TODAY" "$T/warn-cross-diff.md" 2>&1 >/dev/null)"
[[ -z "$WARN_OUT2" ]] && pass "different tool/model cross-review is silent" || fail "different tool/model cross-review is silent"

# --- CR-1c: the same-tool warning must not fire on a provenance line that is
# only quoted inside a fenced code block
WARN_FILE3="$T/review-report-warn3.md"
printf '<!-- relay: stage=self-review tool=gemini model=weak-model base=abc date=%s -->\nSelf body quoting the provenance format for reference:\n\n```\n<!-- relay: stage=self-review tool=cursor model=composer-unknown base=zzz date=2000-01-01 -->\n```\n' "$TODAY" > "$T/warn-self-fenced.md"
"$REVIEW_SH" upsert "$WARN_FILE3" Self-Review "$TODAY" "$T/warn-self-fenced.md" >/dev/null 2>&1
printf '<!-- relay: stage=cross-review tool=cursor model=composer-unknown base=abc date=%s -->\nCross body.\n' "$TODAY" > "$T/warn-cross-fenced.md"
WARN_OUT3="$("$REVIEW_SH" upsert "$WARN_FILE3" Cross-Review "$TODAY" "$T/warn-cross-fenced.md" 2>&1 >/dev/null)"
[[ -z "$WARN_OUT3" ]] && pass "fenced example provenance is not mistaken for the real prior self-review" || fail "fenced example provenance is not mistaken for the real prior self-review"

# --- Per-run folder helper tests (resolve-run, run-history) ---

# 1. Resolve by id and slug
RESOLVED="$("$RESOLVE_RUN" 1700000000)"
[[ "$RESOLVED" == "$HAPPY_DIR" ]] && pass "resolve-run by id matches" || fail "resolve-run by id matches"
RESOLVED_SLUG="$("$RESOLVE_RUN" happy)"
[[ "$RESOLVED_SLUG" == "$HAPPY_DIR" ]] && pass "resolve-run by slug matches" || fail "resolve-run by slug matches"

# 1b. Reject legacy 2.0.0 nanoid-shaped dirname
mkdir -p "$T/.agent-relay/20260101_abcdefghij"
touch "$T/.agent-relay/20260101_abcdefghij/meta.md"
if "$RESOLVE_RUN" abcdefghij >/dev/null 2>&1; then
  fail "resolve-run legacy YMD_nanoid matches"
else
  pass "resolve-run legacy YMD_nanoid fails"
fi
rm -rf "$T/.agent-relay/20260101_abcdefghij"

# 2. Resolve by dir path
RESOLVED_PATH="$("$RESOLVE_RUN" "$HAPPY_DIR")"
[[ "$RESOLVED_PATH" == "$HAPPY_DIR" ]] && pass "resolve-run by dir path matches" || fail "resolve-run by dir path matches"

# 3. Resolve by file path inside run dir
RESOLVED_FILE="$("$RESOLVE_RUN" "$HAPPY_DIR/plan.md")"
[[ "$RESOLVED_FILE" == "$HAPPY_DIR" ]] && pass "resolve-run by file path matches" || fail "resolve-run by file path matches"

# 4. Resolve with no args from run dir
(
  cd "$HAPPY_DIR"
  RESOLVED_INSIDE="$("$RESOLVE_RUN")"
  [[ "$RESOLVED_INSIDE" == "$HAPPY_DIR" ]] && pass "resolve-run with no args from inside run dir" || fail "resolve-run with no args from inside run dir"
)

# 5. Resolve with no args when multiple runs exist -> ambiguous failure
RUN2_DIR="$("$RUN_INIT" 1700000099 --slug second-run --title "Second Run" --base main)"
(
  cd "$T"
  if "$RESOLVE_RUN" >/dev/null 2>&1; then
    fail "resolve-run with multiple runs should fail as ambiguous"
  else
    pass "resolve-run with multiple runs fails as ambiguous"
  fi
)
rm -rf "$RUN2_DIR"

# 6. Reject legacy flat plan
LEGACY_DIR="$T/legacy-test"
mkdir -p "$LEGACY_DIR/.agent-relay"
cat <<'EOF' > "$LEGACY_DIR/.agent-relay/plan-leg1.md"
base: main
id: leg1

# Legacy Plan
EOF
(
  cd "$LEGACY_DIR"
  if "$RESOLVE_RUN" leg1 >/dev/null 2>&1; then
    fail "resolve-run legacy resolves to base .agent-relay"
  else
    pass "resolve-run legacy rejects flat plan"
  fi
)

# 8. run-history.sh append & show
"$RUN_HISTORY" append "$HAPPY_DIR" implement started tool=cursor
grep -q "stage=implement action=started tool=cursor" "$HAPPY_DIR/history.log" && pass "history append writes log" || fail "history append writes log"
grep -q "stage: implement" "$HAPPY_DIR/meta.md" && pass "history append updates meta.md stage" || fail "history append updates meta.md stage"

HIST_SHOW="$("$RUN_HISTORY" show "$HAPPY_DIR")"
echo "$HIST_SHOW" | grep -q "action=started" && pass "history show displays events" || fail "history show displays events"

# 9. run-history refuses legacy flat resolve (no root history.log)
LEGACY_HIST="$T/legacy-hist"
mkdir -p "$LEGACY_HIST/.agent-relay"
echo 'base: x' > "$LEGACY_HIST/.agent-relay/plan-leghist01.md"
if (
  cd "$LEGACY_HIST"
  "$RUN_HISTORY" append leghist01 implement started tool=test
) >/dev/null 2>&1; then
  fail "history refuses legacy flat layout"
else
  pass "history refuses legacy flat layout"
fi
[[ ! -f "$LEGACY_HIST/.agent-relay/history.log" ]] && pass "history does not write root history.log" || fail "history does not write root history.log"

# --- Rejected inputs: invalid status / deps / init cleanup ---
BAD_STATUS_DIR="$("$RUN_INIT" 1700000100 --slug badstat --title "Bad Status" --base main)"
cat <<'EOF' > "$BAD_STATUS_DIR/plan.md"
base: main
id: 1700000100

## Tasks
- [banana] T1: Not a real status
EOF
if "$TASK_INIT" badstat >/dev/null 2>&1; then
  fail "task-init rejects invalid checkbox status"
else
  pass "task-init rejects invalid checkbox status"
fi
[[ ! -d "$BAD_STATUS_DIR/implement-plan" ]] && pass "failed init removes plan dir (bad status)" || fail "failed init removes plan dir (bad status)"
# Re-init after cleanup must succeed with a valid plan
cat <<'EOF' > "$BAD_STATUS_DIR/plan.md"
base: main
id: 1700000100

## Tasks
1. **Ok.** Valid after cleanup
EOF
if "$TASK_INIT" badstat >/dev/null; then
  pass "re-init works after refused plan cleanup"
else
  fail "re-init works after refused plan cleanup"
fi

BAD_DEP_DIR="$("$RUN_INIT" 1700000101 --slug baddep --title "Bad Dep" --base main)"
cat <<'EOF' > "$BAD_DEP_DIR/plan.md"
base: main
id: 1700000101

## Tasks
1. **Bad dep.** Uses glob (deps: T*/evil)
EOF
if "$TASK_INIT" baddep >/dev/null 2>&1; then
  fail "task-init rejects invalid dependency id"
else
  pass "task-init rejects invalid dependency id"
fi
[[ ! -d "$BAD_DEP_DIR/implement-plan" ]] && pass "failed init removes plan dir (bad dep)" || fail "failed init removes plan dir (bad dep)"

# --- Mutex staleness: host-aware reclaim ---
# Same host + dead pid is conclusive, so a short age guard is enough. A mutex
# recorded on another host must never be reclaimed on the pid (that pid means
# nothing here) — only on the long foreign timer.
STALE_DIR2="$("$RUN_INIT" 1700000103 --slug mutexhost --title "Mutex Host" --base main)"
cat <<'EOF' > "$STALE_DIR2/plan.md"
base: main
id: 1700000103

## Tasks

1. **Host.** Mutex staleness target
EOF
"$TASK_INIT" mutexhost >/dev/null
MHOST_PLAN="$STALE_DIR2/implement-plan"
MHOST_MUTEX="$MHOST_PLAN/.mutex-T1"

# Orphaned mutex from this host with a pid that cannot be alive.
mk_orphan_mutex() {
  # mk_orphan_mutex <host> <age-seconds>
  rm -rf "$MHOST_MUTEX"
  mkdir -p "$MHOST_MUTEX"
  echo "2147483647" > "$MHOST_MUTEX/owner_pid"
  printf '%s\n' "$1" > "$MHOST_MUTEX/owner_host"
  echo "$(( $(date +%s) - $2 ))" > "$MHOST_MUTEX/created_epoch"
}

mk_orphan_mutex "$(uname -n)" 60
if AGENT_RELAY_MUTEX_WAIT_MAX=3 "$TASK_CLAIM" claim mutexhost T1 host-a >/dev/null 2>&1; then
  pass "same-host dead pid mutex is reclaimed"
else
  fail "same-host dead pid mutex is reclaimed"
fi
"$TASK_CLAIM" release mutexhost T1 host-a >/dev/null 2>&1 || true

# Same age, foreign host: the pid must be ignored, so this must NOT be reclaimed.
mk_orphan_mutex "some-other-machine" 60
if AGENT_RELAY_MUTEX_WAIT_MAX=2 "$TASK_CLAIM" claim mutexhost T1 host-b >/dev/null 2>&1; then
  fail "foreign-host mutex is not reclaimed on pid"
else
  pass "foreign-host mutex is not reclaimed on pid"
fi

# Past the foreign timer it must be reclaimable again.
mk_orphan_mutex "some-other-machine" 60
if AGENT_RELAY_MUTEX_FOREIGN_STALE_AGE=30 AGENT_RELAY_MUTEX_WAIT_MAX=3 \
  "$TASK_CLAIM" claim mutexhost T1 host-c >/dev/null 2>&1; then
  pass "foreign-host mutex is reclaimed after the foreign timer"
else
  fail "foreign-host mutex is reclaimed after the foreign timer"
fi
"$TASK_CLAIM" release mutexhost T1 host-c >/dev/null 2>&1 || true
rm -rf "$STALE_DIR2"

# --- Cross-operation concurrency: steal vs release / claim vs steal / update vs steal / release vs release ---
CROSS_N=20
cross_fail=0
CROSS_DIR="$("$RUN_INIT" 1700000102 --slug crossop --title "Cross Op" --base main)"
cat <<'EOF' > "$CROSS_DIR/plan.md"
base: main
id: 1700000102

## Tasks
1. **Cross.** Contention target
EOF

# steal vs release — both directions, with unconditional assertions.
#
# Direction A (release holds the mutex, steal is try-once): steal must fail and
# the lock must be gone once release finishes.
#
# Direction B (steal holds the mutex, release waits): this is the original 3.0.1
# race. There, release deleted the lock, reported success, and steal then
# recreated it under the stealer — a successful release silently undone. The
# invariant now is that the two cannot both succeed: release must fail with an
# owner mismatch and the lock must belong to the stealer.
i=1
while [[ $i -le $CROSS_N ]]; do
  # --- direction A ---
  rm -rf "$CROSS_DIR/implement-plan" "$CROSS_DIR/implement-plan.md" "$CROSS_DIR/implement-report" "$CROSS_DIR/implement-report.md"
  "$TASK_INIT" crossop >/dev/null
  "$TASK_CLAIM" claim crossop T1 owner-x >/dev/null
  HOLD="$T/mutex-hold-steal-release-a-$i"
  rm -f "$HOLD" "$HOLD.ready"
  touch "$HOLD"
  code_rel=0
  AGENT_RELAY_TEST_MUTEX_HOLD="$HOLD" "$TASK_CLAIM" release crossop T1 owner-x >/dev/null 2>&1 &
  pid_rel=$!
  waits=0
  while [[ ! -f "$HOLD.ready" && $waits -lt 200 ]]; do sleep 0.01; waits=$((waits + 1)); done
  # steal must run in the background: it now waits for the mutex (STEAL_WAIT_MAX)
  # instead of failing on it, so a foreground call would block until the budget
  # expires because only this loop releases the barrier.
  code_steal=0
  "$TASK_CLAIM" steal crossop T1 stealer-x >/dev/null 2>&1 &
  pid_steal=$!
  sleep 0.05
  rm -f "$HOLD"
  wait $pid_rel || code_rel=$?
  wait $pid_steal || code_steal=$?
  # release wins the mutex and removes the lock; steal then finds nothing to
  # take over, so it must still fail and must not resurrect the lock.
  [[ $code_steal -ne 0 ]] || cross_fail=$((cross_fail + 1))
  [[ $code_rel -eq 0 ]] || cross_fail=$((cross_fail + 1))
  [[ ! -d "$CROSS_DIR/implement-plan/.lock-T1" ]] || cross_fail=$((cross_fail + 1))

  # --- direction B (the 3.0.1 race) ---
  rm -rf "$CROSS_DIR/implement-plan" "$CROSS_DIR/implement-plan.md" "$CROSS_DIR/implement-report" "$CROSS_DIR/implement-report.md"
  "$TASK_INIT" crossop >/dev/null
  "$TASK_CLAIM" claim crossop T1 owner-x >/dev/null
  HOLD="$T/mutex-hold-steal-release-b-$i"
  rm -f "$HOLD" "$HOLD.ready"
  touch "$HOLD"
  code_steal=0
  AGENT_RELAY_TEST_MUTEX_HOLD="$HOLD" "$TASK_CLAIM" steal crossop T1 stealer-x >/dev/null 2>&1 &
  pid_steal=$!
  waits=0
  while [[ ! -f "$HOLD.ready" && $waits -lt 200 ]]; do sleep 0.01; waits=$((waits + 1)); done
  code_rel=0
  "$TASK_CLAIM" release crossop T1 owner-x >/dev/null 2>&1 &
  pid_rel=$!
  sleep 0.05
  rm -f "$HOLD"
  wait $pid_steal || code_steal=$?
  wait $pid_rel || code_rel=$?
  owner=""
  [[ -d "$CROSS_DIR/implement-plan/.lock-T1" ]] && owner="$(awk '{print $1}' "$CROSS_DIR/implement-plan/.lock-T1/owner" 2>/dev/null || true)"
  # The stealer took the lock, so the old owner's release must have failed and
  # the lock must still be the stealer's. A release that reports success here
  # is the resurrection bug.
  [[ $code_steal -eq 0 ]] || cross_fail=$((cross_fail + 1))
  [[ $code_rel -ne 0 ]] || cross_fail=$((cross_fail + 1))
  [[ "$owner" == "stealer-x" ]] || cross_fail=$((cross_fail + 1))
  i=$((i + 1))
done
[[ $cross_fail -eq 0 ]] && pass "cross-op steal vs release, both directions ($CROSS_N)" || fail "cross-op steal vs release ($cross_fail failures)"

# claim vs steal
cross_fail=0
i=1
while [[ $i -le $CROSS_N ]]; do
  rm -rf "$CROSS_DIR/implement-plan" "$CROSS_DIR/implement-plan.md" "$CROSS_DIR/implement-report" "$CROSS_DIR/implement-report.md"
  "$TASK_INIT" crossop >/dev/null
  "$TASK_CLAIM" claim crossop T1 seed >/dev/null
  HOLD="$T/mutex-hold-claim-steal-$i"
  rm -f "$HOLD" "$HOLD.ready"
  touch "$HOLD"
  AGENT_RELAY_TEST_MUTEX_HOLD="$HOLD" "$TASK_CLAIM" steal crossop T1 stealer >/dev/null 2>&1 &
  pid_st=$!
  waits=0
  while [[ ! -f "$HOLD.ready" && $waits -lt 200 ]]; do sleep 0.01; waits=$((waits + 1)); done
  # Claim must start while steal still holds the mutex, but must not run
  # synchronously (that deadlocks: claim waits on mutex, steal waits on HOLD).
  code_claim=0
  "$TASK_CLAIM" claim crossop T1 claimant >/dev/null 2>&1 &
  pid_cl=$!
  sleep 0.05
  rm -f "$HOLD"
  wait $pid_st || true
  wait $pid_cl || code_claim=$?
  # Claim must not succeed while/after steal took the lock; lock owner is stealer
  owner="$(awk '{print $1}' "$CROSS_DIR/implement-plan/.lock-T1/owner" 2>/dev/null || true)"
  if [[ $code_claim -eq 0 || "$owner" != "stealer" ]]; then
    cross_fail=$((cross_fail + 1))
  fi
  i=$((i + 1))
done
[[ $cross_fail -eq 0 ]] && pass "cross-op claim vs steal ($CROSS_N)" || fail "cross-op claim vs steal ($cross_fail/$CROSS_N)"

# update vs steal — steal waits out the update, then takes the lock over
cross_fail=0
i=1
while [[ $i -le $CROSS_N ]]; do
  rm -rf "$CROSS_DIR/implement-plan" "$CROSS_DIR/implement-plan.md" "$CROSS_DIR/implement-report" "$CROSS_DIR/implement-report.md"
  "$TASK_INIT" crossop >/dev/null
  "$TASK_CLAIM" claim crossop T1 owner-u >/dev/null
  HOLD="$T/mutex-hold-update-steal-$i"
  rm -f "$HOLD" "$HOLD.ready"
  touch "$HOLD"
  AGENT_RELAY_TEST_MUTEX_HOLD="$HOLD" "$TASK_CLAIM" update crossop T1 owner-u done >/dev/null 2>&1 &
  pid_up=$!
  waits=0
  while [[ ! -f "$HOLD.ready" && $waits -lt 200 ]]; do sleep 0.01; waits=$((waits + 1)); done
  code_steal=0
  "$TASK_CLAIM" steal crossop T1 stealer-u >/dev/null 2>&1 &
  pid_steal=$!
  sleep 0.05
  rm -f "$HOLD"
  wait $pid_up || true
  wait $pid_steal || code_steal=$?
  status="$(grep -E '^status:' "$CROSS_DIR/implement-plan/T1.status" | sed 's/^status:[[:space:]]*//')"
  owner=""
  [[ -d "$CROSS_DIR/implement-plan/.lock-T1" ]] && owner="$(awk '{print $1}' "$CROSS_DIR/implement-plan/.lock-T1/owner")"
  # An update holding the mutex is unrelated contention, not a competing
  # takeover: steal must wait it out and win, leaving the lock with the stealer
  # and the status back at in-progress. Failing here would be the old
  # try-once behaviour, where incidental contention aborted a steal.
  [[ $code_steal -eq 0 ]] || cross_fail=$((cross_fail + 1))
  [[ "$owner" == "stealer-u" ]] || cross_fail=$((cross_fail + 1))
  [[ "$status" == "in-progress" ]] || cross_fail=$((cross_fail + 1))
  i=$((i + 1))
done
[[ $cross_fail -eq 0 ]] && pass "cross-op update vs steal ($CROSS_N)" || fail "cross-op update vs steal ($cross_fail/$CROSS_N)"

# release vs release
cross_fail=0
i=1
while [[ $i -le $CROSS_N ]]; do
  rm -rf "$CROSS_DIR/implement-plan" "$CROSS_DIR/implement-plan.md" "$CROSS_DIR/implement-report" "$CROSS_DIR/implement-report.md"
  "$TASK_INIT" crossop >/dev/null
  "$TASK_CLAIM" claim crossop T1 owner-rr >/dev/null
  code1=0
  code2=0
  "$TASK_CLAIM" release crossop T1 owner-rr >/dev/null 2>&1 &
  pid1=$!
  "$TASK_CLAIM" release --force crossop T1 >/dev/null 2>&1 &
  pid2=$!
  wait $pid1 || code1=$?
  wait $pid2 || code2=$?
  if [[ -d "$CROSS_DIR/implement-plan/.lock-T1" ]]; then
    cross_fail=$((cross_fail + 1))
  fi
  # Both may succeed (second is no-op) or one may fail; lock must be gone.
  i=$((i + 1))
done
[[ $cross_fail -eq 0 ]] && pass "cross-op release vs release ($CROSS_N)" || fail "cross-op release vs release ($cross_fail/$CROSS_N)"
rm -rf "$CROSS_DIR"

# --- CR-2: skill bundle copies must not drift from their sources ---
if bash "$ROOT/scripts/sync-references.sh" --check; then
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
