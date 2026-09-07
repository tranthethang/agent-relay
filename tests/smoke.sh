#!/usr/bin/env bash
# Smoke checks for install / uninstall / verify (bash 3.2+). Run from repo root:
#   ./tests/smoke.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
INSTALL="$ROOT/install.sh"
UNINSTALL="$ROOT/uninstall.sh"
VERIFY="$ROOT/verify.sh"

FAIL=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAIL=1; }

T="$(mktemp -d "${TMPDIR:-/tmp}/ar-smoke.XXXXXX")"
cleanup() { rm -rf "$T"; }
trap cleanup EXIT

# Isolate installs under a fake HOME so we never touch the real machine.
export HOME="$T"

"$INSTALL" --only cursor >/dev/null
[[ $? -eq 0 ]] && pass "exit 0 on success" || fail "exit 0 on success"
[[ -f "$HOME/.cursor/skills/atry-implement/SKILL.md" ]] && pass "cursor skill-folder" || fail "cursor skill-folder"

"$INSTALL" --only antigravity >/dev/null
[[ -f "$HOME/.gemini/config/skills/atry-implement/SKILL.md" ]] && pass ".gemini/config/skills" || fail ".gemini/config/skills"

"$INSTALL" --only claude >/dev/null
[[ -f "$HOME/.claude/skills/atry-implement/SKILL.md" ]] && pass "claude skill-folder" || fail "claude skill-folder"

"$INSTALL" --only codex >/dev/null
[[ -f "$HOME/.codex/skills/atry-implement/SKILL.md" ]] && pass "codex skill-folder" || fail "codex skill-folder"

# Legacy Cursor rules (.mdc) and Antigravity paths should be cleaned by uninstall
# (and by install migration) even after path/format change.
mkdir -p "$HOME/.cursor/rules" "$HOME/.agents/skills/atry-implement" "$HOME/.agent/skills/atry-implement"
echo legacy > "$HOME/.cursor/rules/atry-implement.mdc"
echo legacy > "$HOME/.agents/skills/atry-implement/SKILL.md"
echo legacy > "$HOME/.agent/skills/atry-implement/SKILL.md"

# Re-install cursor should migrate away the legacy .mdc
"$INSTALL" --only cursor --skill atry-implement >/dev/null
[[ ! -f "$HOME/.cursor/rules/atry-implement.mdc" ]] && pass "install cleans legacy mdc" || fail "install cleans legacy mdc"
# Recreate for uninstall coverage below
echo legacy > "$HOME/.cursor/rules/atry-implement.mdc"

if "$VERIFY" >/dev/null 2>&1; then pass "verify after install"; else fail "verify after install"; fi

"$INSTALL" --dry-run --only CURSOR >/dev/null
pass "--only CURSOR"

if "$INSTALL" --dry-run --only nosuch >/dev/null 2>&1; then fail "unknown tool"; else pass "unknown tool"; fi
if "$INSTALL" --dry-run --skill nosuch >/dev/null 2>&1; then fail "unknown skill"; else pass "unknown skill"; fi

out="$("$INSTALL" --dry-run --only "cursor, antigravity" 2>/dev/null)" \
  || true
echo "$out" | grep -q ANTIGRAVITY && pass "comma+space" || fail "comma+space"

# Description with apostrophe must survive skill-folder copy.
DESC="$T/apos-src"
mkdir -p "$DESC/skills"
cp "$INSTALL" "$ROOT/targets.conf" "$DESC/"
printf '%s\n' '---' 'name: apos-test' "description: Review the user's implementation." '---' '' '# Body' > "$DESC/skills/apos-test.md"
(
  export HOME="$DESC/out"
  mkdir -p "$HOME"
  cd "$DESC"
  ./install.sh --only cursor --skill apos-test
) >/dev/null
grep -q "user's implementation" "$DESC/out/.cursor/skills/apos-test/SKILL.md" && pass "apostrophe" || fail "apostrophe"

echo MARKER >> "$HOME/.cursor/skills/atry-implement/SKILL.md"
"$INSTALL" --only cursor --skill atry-implement --no-clobber >/dev/null
grep -q MARKER "$HOME/.cursor/skills/atry-implement/SKILL.md" && pass "no-clobber" || fail "no-clobber"

if "$INSTALL" --only cursor --dry-run 2>&1 | grep -q -- '--target'; then
  fail "--target rejected"
else
  # Explicit rejection when --target is passed
  if "$INSTALL" --target /tmp/x >/dev/null 2>&1; then fail "--target rejected"; else pass "--target rejected"; fi
fi

"$UNINSTALL" --only cursor --skill atry-implement >/dev/null
[[ ! -e "$HOME/.cursor/skills/atry-implement" ]] && pass "uninstall cursor skill" || fail "uninstall cursor skill"
[[ ! -f "$HOME/.cursor/rules/atry-implement.mdc" ]] && pass "uninstall legacy mdc" || fail "uninstall legacy mdc"
# Other cursor skills should remain
[[ -f "$HOME/.cursor/skills/atry-self-review/SKILL.md" ]] && pass "uninstall scoped" || fail "uninstall scoped"

if "$VERIFY" --only cursor --skill atry-implement >/dev/null 2>&1; then
  fail "verify fail after partial uninstall"
else
  pass "verify fail after partial uninstall"
fi

"$UNINSTALL" >/dev/null
[[ ! -f "$HOME/.gemini/config/skills/atry-implement/SKILL.md" ]] && pass "uninstall all" || fail "uninstall all"
[[ ! -e "$HOME/.claude/skills/atry-implement" ]] && pass "uninstall claude skill" || fail "uninstall claude skill"
[[ ! -e "$HOME/.codex/skills/atry-implement" ]] && pass "uninstall codex skill" || fail "uninstall codex skill"
[[ ! -e "$HOME/.agents/skills/atry-implement" ]] && pass "uninstall legacy .agents" || fail "uninstall legacy .agents"
[[ ! -e "$HOME/.agent/skills/atry-implement" ]] && pass "uninstall legacy .agent" || fail "uninstall legacy .agent"

if [[ "$FAIL" -eq 0 ]]; then
  echo "ALL SMOKE TESTS PASSED"
else
  echo "SOME FAILURES"
  exit 1
fi
