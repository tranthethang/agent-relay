#!/usr/bin/env bash
# scripts/runtime/bank-check.sh
# Probe an optional external knowledge bank declared in .agent-relay/bank.conf
# and record reachability in .agent-relay/bank-status.md. Project-level (one
# per target repo), not per-run. See docs/bank.md for the format and the
# supported backend types.
#
# This checks reachability only. It does not verify write correctness beyond
# a basic writability probe, does not verify data quality, and does not talk
# to any network endpoint unless BANK_TYPE requires it (only obsidian-vault
# is implemented in this MVP; other declared types are recorded as
# "not implemented").
#
# Bash 3.2+ compatible, POSIX tools only. bank.conf is parsed line-by-line and
# never sourced/eval'd.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bank-check.sh [<start-dir>]

Looks for .agent-relay/ starting at <start-dir> (default: cwd) and walking up
to the nearest .git, same as resolve-run.sh. Reads .agent-relay/bank.conf if
present, probes the declared backend, and writes .agent-relay/bank-status.md.

Exit 0: status written (bank.conf absent counts as "not configured", exit 0).
Exit 1: .agent-relay/bank.conf exists but is malformed, or no .agent-relay/
        directory could be found or created.
EOF
  exit 1
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/runtime/find-agent-relay-dir.sh
source "$SCRIPT_DIR/find-agent-relay-dir.sh"

START_DIR="${1:-$PWD}"
[[ -d "$START_DIR" ]] || { echo "Error: not a directory: $START_DIR" >&2; exit 1; }

AGENT_RELAY_DIR="$(find_agent_relay_dir "$START_DIR")"
mkdir -p "$AGENT_RELAY_DIR"
BANK_CONF="$AGENT_RELAY_DIR/bank.conf"
BANK_STATUS="$AGENT_RELAY_DIR/bank-status.md"

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

write_status() {
  local configured="$1" bank_type="$2" bank_path="$3" bank_endpoint="$4" reachable="$5" detail="$6"
  {
    printf 'configured: %s\n' "$configured"
    printf 'bank_type: %s\n' "$bank_type"
    printf 'bank_path: %s\n' "$bank_path"
    printf 'bank_endpoint: %s\n' "$bank_endpoint"
    printf 'reachable: %s\n' "$reachable"
    printf 'checked_at: %s\n' "$(now_iso)"
    printf 'detail: %s\n' "$detail"
  } > "$BANK_STATUS"
}

if [[ ! -f "$BANK_CONF" ]]; then
  write_status "false" "none" "" "" "false" "no bank.conf found at $BANK_CONF"
  echo "bank-check: not configured (no bank.conf) -> $BANK_STATUS"
  exit 0
fi

# --- Parse bank.conf without sourcing it ---
# Only lines of the exact form BANK_<UPPER_WITH_UNDERSCORE>=<value> are
# accepted. <value> may not contain shell metacharacters. Blank lines and
# '#' comments are skipped. Anything else is a hard refusal (exit 1),
# matching the "refuse rather than guess" posture used for targets.conf.
BANK_TYPE=""
BANK_PATH=""
BANK_ENDPOINT=""
lineno=0
malformed=0
malformed_reason=""
while IFS= read -r line || [[ -n "$line" ]]; do
  lineno=$((lineno + 1))
  # Skip blank lines and whole-line comments. Leading whitespace is stripped
  # first on purpose: the glob [[:space:]]*'#'* matches "one space, anything,
  # then a '#'", so an indented key line that merely contained a '#' later on
  # was silently swallowed as a comment and its value dropped without any
  # error -- the opposite of this parser's "refuse rather than guess" posture.
  # Keys themselves must still start at column 0; an indented key line is a
  # hard refusal below, not a silent skip.
  trimmed="$line"
  while [[ "$trimmed" == [[:space:]]* ]]; do
    trimmed="${trimmed#?}"
  done
  case "$trimmed" in
    ''|'#'*) continue ;;
  esac
  if [[ "$line" =~ ^BANK_[A-Z_]+=.*$ ]]; then
    key="${line%%=*}"
    val="${line#*=}"
    # Strip one layer of matching quotes if present.
    if [[ "$val" == \"*\" && ${#val} -ge 2 ]]; then
      val="${val#\"}"; val="${val%\"}"
    elif [[ "$val" == \'*\' && ${#val} -ge 2 ]]; then
      val="${val#\'}"; val="${val%\'}"
    fi
    case "$val" in
      *'$('*|*'`'*|*';'*|*'&&'*|*'||'*|*'|'*|*'>'*|*'<'*|*$'\n'*)
        echo "Error: bank.conf line $lineno rejected (unsafe characters in value): $line" >&2
        malformed=1
        malformed_reason="line $lineno rejected (unsafe characters in value)"
        break
        ;;
    esac
    case "$key" in
      BANK_TYPE) BANK_TYPE="$val" ;;
      BANK_PATH) BANK_PATH="$val" ;;
      BANK_ENDPOINT) BANK_ENDPOINT="$val" ;;
      *) ;;
    esac
  else
    echo "Error: bank.conf line $lineno is not BANK_KEY=value: $line" >&2
    malformed=1
    malformed_reason="line $lineno is not BANK_KEY=value"
    break
  fi
done < "$BANK_CONF"

if [[ "$malformed" -eq 1 ]]; then
  # Root-cause fix: a malformed bank.conf must not leave a stale prior status
  # in place (e.g. a leftover "reachable: true" from before the config broke).
  # Refusing to parse (exit 1, for any caller/script that checks the exit
  # code) is orthogonal to recording the truth (bank-status.md must always
  # reflect the most recent check, successful or not).
  write_status "true" "" "" "" "false" "bank.conf malformed ($malformed_reason) -- fix bank.conf and re-run bank-check.sh"
  echo "Refusing to parse bank.conf further. Fix the offending line above." >&2
  echo "bank-check: wrote $BANK_STATUS (reachable: false, malformed config)" >&2
  exit 1
fi

if [[ -z "$BANK_TYPE" ]]; then
  write_status "true" "" "$BANK_PATH" "$BANK_ENDPOINT" "false" "bank.conf has no BANK_TYPE"
  echo "bank-check: bank.conf present but BANK_TYPE is missing -> $BANK_STATUS"
  exit 0
fi

case "$BANK_TYPE" in
  obsidian-vault)
    if [[ -z "$BANK_PATH" ]]; then
      write_status "true" "$BANK_TYPE" "" "$BANK_ENDPOINT" "false" "BANK_PATH not set for obsidian-vault"
    elif [[ ! -d "$BANK_PATH" ]]; then
      write_status "true" "$BANK_TYPE" "$BANK_PATH" "$BANK_ENDPOINT" "false" "path does not exist: $BANK_PATH"
    # Caveat: [[ -w "$BANK_PATH" ]] tests writability via file permissions, but
    # when running as root (e.g., in some CI or container setups), it may report
    # true even for read-only filesystems or restricted mounts. This is a known
    # limitation of the reachability probe.
    elif [[ ! -w "$BANK_PATH" ]]; then
      write_status "true" "$BANK_TYPE" "$BANK_PATH" "$BANK_ENDPOINT" "false" "path exists but is not writable: $BANK_PATH"
    else
      write_status "true" "$BANK_TYPE" "$BANK_PATH" "$BANK_ENDPOINT" "true" "vault directory exists and is writable"
    fi
    ;;
  lightrag-http|agentmemory-cli)
    write_status "true" "$BANK_TYPE" "$BANK_PATH" "$BANK_ENDPOINT" "false" \
      "backend '$BANK_TYPE' is declared but has no driver in this MVP (only obsidian-vault is implemented); see docs/bank.md"
    ;;
  *)
    write_status "true" "$BANK_TYPE" "$BANK_PATH" "$BANK_ENDPOINT" "false" "unknown BANK_TYPE '$BANK_TYPE'"
    ;;
esac

echo "bank-check: wrote $BANK_STATUS"
cat "$BANK_STATUS"
