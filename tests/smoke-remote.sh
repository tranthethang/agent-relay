#!/usr/bin/env bash
# tests/smoke-remote.sh
#
# Offline smoke tests for remote mode install, uninstall, and verify:
#   - refuses floating main
#   - requires ref or fails clearly
#   - commit SHA requires explicit --sha256
#   - SHA-256 verification detects corrupted payload
#   - valid release tag install, verify, uninstall succeed
#   - commit SHA with explicit valid --sha256 succeeds
#   - AGENT_RELAY_REF and AGENT_RELAY_SHA256 env vars honored
#   - baked script with DEFAULT_REF succeeds without flags

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURES_DIR="$SCRIPT_DIR/fixtures"

PASS=0
FAIL=0

pass() { echo "PASS: $*"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $*" >&2; FAIL=$((FAIL + 1)); }

if [[ ! -f "$FIXTURES_DIR/agent-relay-v0.1.0.tar.gz" || ! -f "$FIXTURES_DIR/SHA256SUMS" ]]; then
  echo "Error: missing test fixtures in $FIXTURES_DIR" >&2
  exit 1
fi

VALID_SHA256="$(awk '{print $1; exit}' "$FIXTURES_DIR/SHA256SUMS")"

T="$(mktemp -d "${TMPDIR:-/tmp}/smoke-remote.XXXXXX")"
cleanup() {
  rm -rf "$T"
}
trap cleanup EXIT INT TERM

# Setup fake curl on PATH
MOCK_BIN="$T/mock-bin"
mkdir -p "$MOCK_BIN"

cat <<EOF > "$MOCK_BIN/curl"
#!/usr/bin/env bash
set -euo pipefail

url=""
out=""
while [[ \$# -gt 0 ]]; do
  case "\$1" in
    -o) out="\$2"; shift 2 ;;
    -fsSL|-sSL|-fSL) shift ;;
    *) url="\$1"; shift ;;
  esac
done

if [[ -z "\$url" || -z "\$out" ]]; then
  echo "mock curl: missing url or output file" >&2
  exit 1
fi

if [[ "\$url" == *"agent-relay-v0.1.0.tar.gz" ]] || [[ "\$url" == *"/archive/"*".tar.gz" ]]; then
  cp "$FIXTURES_DIR/agent-relay-v0.1.0.tar.gz" "\$out"
  exit 0
elif [[ "\$url" == *"SHA256SUMS" ]]; then
  if [[ "\${MOCK_BAD_SUM:-0}" == "1" ]]; then
    cp "$FIXTURES_DIR/SHA256SUMS.bad" "\$out"
  else
    cp "$FIXTURES_DIR/SHA256SUMS" "\$out"
  fi
  exit 0
else
  echo "mock curl: 404 Not Found for \$url" >&2
  exit 22
fi
EOF
chmod +x "$MOCK_BIN/curl"

# Ensure mock curl takes precedence over real curl and wget
export PATH="$MOCK_BIN:$PATH"

# Setup isolated environment for running remote scripts
RUN_DIR="$T/run"
mkdir -p "$RUN_DIR"
cp "$ROOT_DIR/install.sh" "$RUN_DIR/install.sh"
cp "$ROOT_DIR/uninstall.sh" "$RUN_DIR/uninstall.sh"
cp "$ROOT_DIR/verify.sh" "$RUN_DIR/verify.sh"

export HOME="$T/home"
mkdir -p "$HOME"

# 1. Refuse floating main
set +e
out="$("$RUN_DIR/install.sh" --ref main 2>&1)"
status=$?
set -e
if [[ $status -ne 0 ]] && echo "$out" | grep -qi "refused for security"; then
  pass "refuse floating main"
else
  fail "refuse floating main (status=$status, out=$out)"
fi

# 2. Require ref when DEFAULT_REF is unset
set +e
out="$("$RUN_DIR/install.sh" 2>&1)"
status=$?
set -e
if [[ $status -ne 0 ]] && echo "$out" | grep -qi "No release ref specified"; then
  pass "no ref error in remote mode"
else
  fail "no ref error in remote mode (status=$status, out=$out)"
fi

# 3. Commit SHA requires explicit --sha256
set +e
out="$("$RUN_DIR/install.sh" --ref 2b2acad9d2b53ee2bca34d64f2364fc1d809a287 2>&1)"
status=$?
set -e
if [[ $status -ne 0 ]] && echo "$out" | grep -qi "requires an explicit --sha256"; then
  pass "commit SHA requires --sha256"
else
  fail "commit SHA requires --sha256 (status=$status, out=$out)"
fi

# 4. Bad checksum fails
set +e
out="$(MOCK_BAD_SUM=1 "$RUN_DIR/install.sh" --ref v0.1.0 2>&1)"
status=$?
set -e
if [[ $status -ne 0 ]] && echo "$out" | grep -qi "checksum mismatch"; then
  pass "bad checksum detected"
else
  fail "bad checksum detected (status=$status, out=$out)"
fi

# 5. Valid release install succeeds
"$RUN_DIR/install.sh" --ref v0.1.0 >/dev/null
if [[ -f "$HOME/.cursor/skills/atry-implement/SKILL.md" ]]; then
  pass "remote release install succeeds"
else
  fail "remote release install succeeds"
fi

# 6. Remote verify succeeds
if "$RUN_DIR/verify.sh" --ref v0.1.0 >/dev/null 2>&1; then
  pass "remote verify succeeds"
else
  fail "remote verify succeeds"
fi

# 7. Remote uninstall succeeds
"$RUN_DIR/uninstall.sh" --ref v0.1.0 >/dev/null
if [[ ! -e "$HOME/.cursor/skills/atry-implement" ]]; then
  pass "remote uninstall succeeds"
else
  fail "remote uninstall succeeds"
fi

# 8. Commit SHA with explicit valid --sha256 succeeds
"$RUN_DIR/install.sh" --ref 2b2acad9d2b53ee2bca34d64f2364fc1d809a287 --sha256 "$VALID_SHA256" >/dev/null
if [[ -f "$HOME/.cursor/skills/atry-implement/SKILL.md" ]]; then
  pass "commit SHA with valid checksum succeeds"
else
  fail "commit SHA with valid checksum succeeds"
fi

# Clean up installed files for next test
rm -rf "$HOME/.cursor"

# 9. AGENT_RELAY_REF and AGENT_RELAY_SHA256 env vars honored
AGENT_RELAY_REF="2b2acad9d2b53ee2bca34d64f2364fc1d809a287" AGENT_RELAY_SHA256="$VALID_SHA256" "$RUN_DIR/install.sh" >/dev/null
if [[ -f "$HOME/.cursor/skills/atry-implement/SKILL.md" ]]; then
  pass "env vars AGENT_RELAY_REF and AGENT_RELAY_SHA256 honored"
else
  fail "env vars AGENT_RELAY_REF and AGENT_RELAY_SHA256 honored"
fi

rm -rf "$HOME/.cursor"

# 10. Release-baked script with DEFAULT_REF succeeds without flags
sed 's/^DEFAULT_REF=""/DEFAULT_REF="v0.1.0"/' "$RUN_DIR/install.sh" > "$RUN_DIR/install_baked.sh"
chmod +x "$RUN_DIR/install_baked.sh"
"$RUN_DIR/install_baked.sh" >/dev/null
if [[ -f "$HOME/.cursor/skills/atry-implement/SKILL.md" ]]; then
  pass "baked script with DEFAULT_REF succeeds"
else
  fail "baked script with DEFAULT_REF succeeds"
fi

if [[ $FAIL -gt 0 ]]; then
  echo "$FAIL REMOTE SMOKE TESTS FAILED" >&2
  exit 1
fi

echo "ALL REMOTE SMOKE TESTS PASSED"
