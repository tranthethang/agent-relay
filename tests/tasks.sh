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
"$TASK_CLAIM" release happy T1 >/dev/null
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
"$TASK_CLAIM" release happy T2 >/dev/null

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

# 4. Stale lock (>2h) is stealable
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

STEAL_OUT="$("$TASK_CLAIM" claim stale T1 new-agent 2>&1)"
echo "$STEAL_OUT" | grep -q "WARNING: Stealing stale lock" && pass "stale lock logs warning" || fail "stale lock logs warning"
grep -q "new-agent" .agent-relay/implement-plan-stale/.lock-T1/owner && pass "stale lock stolen by new-agent" || fail "stale lock stolen by new-agent"

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

if [[ "$FAIL" -eq 0 ]]; then
  echo "ALL TASK TESTS PASSED"
else
  echo "SOME TASK TESTS FAILED"
  exit 1
fi
