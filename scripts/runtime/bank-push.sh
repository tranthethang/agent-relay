#!/usr/bin/env bash
# scripts/runtime/bank-push.sh
# Push one distilled note into the knowledge bank declared in
# .agent-relay/bank.conf, if atry bank check last recorded it reachable.
# Used by the atry-distill skill. See docs/bank.md.
#
# This does not judge the note's content and does not retry or queue on
# failure — a failed or skipped push is not fatal to the caller; the local
# distillation.md in the run directory is always the source of truth.
#
# Bash 3.2+ compatible, POSIX tools only.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bank-push.sh <start-dir> <run-id-or-slug> <title> <body-file-or-->

<start-dir>        Anywhere under the target repo (same lookup as bank-check.sh).
<run-id-or-slug>   Used to build a stable, collision-resistant note filename.
<title>            Short title for the note (used in the filename and heading).
<body-file-or-->   Path to the note body, or "-" to read the body from stdin.

Exit 0: pushed.
Exit 1: bad arguments, or .agent-relay/bank-status.md is missing/unreadable.
Exit 2: bank not configured, not reachable, backend has no driver here, or no
        .agent-relay/ directory or git repository was found above <start-dir>
        (run bank-check.sh first; this is a soft "not pushed", not a bug).
EOF
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/runtime/find-agent-relay-dir.sh
source "$SCRIPT_DIR/find-agent-relay-dir.sh"

[[ $# -eq 4 ]] || usage
START_DIR="$1"
RUN_REF="$2"
TITLE="$3"
BODY_SRC="$4"

[[ -d "$START_DIR" ]] || {
  echo "Error: not a directory: $START_DIR" >&2
  exit 1
}
case "$RUN_REF" in
*[!A-Za-z0-9._-]* | "")
  echo "Error: invalid run-id-or-slug '$RUN_REF'" >&2
  exit 1
  ;;
esac

if ! AGENT_RELAY_DIR="$(find_agent_relay_dir "$START_DIR")"; then
  echo "bank-push: skipped -- no .agent-relay/ directory or git repository found above $START_DIR" >&2
  exit 2
fi
BANK_STATUS="$AGENT_RELAY_DIR/bank-status.md"

[[ -f "$BANK_STATUS" ]] || {
  echo "bank-push: no $BANK_STATUS (run bank-check.sh first)" >&2
  exit 1
}

read_field() {
  local field="$1"
  sed -n "s/^${field}: //p" "$BANK_STATUS" | head -1
}

CONFIGURED="$(read_field configured)"
BANK_TYPE="$(read_field bank_type)"
BANK_PATH="$(read_field bank_path)"
BANK_ENDPOINT="$(read_field bank_endpoint)"
REACHABLE="$(read_field reachable)"
: "$BANK_ENDPOINT"

if [[ "$CONFIGURED" != "true" || "$REACHABLE" != "true" ]]; then
  echo "bank-push: skipped — bank not configured/reachable per $BANK_STATUS" >&2
  exit 2
fi

if [[ "$BODY_SRC" == "-" ]]; then
  BODY="$(cat)"
else
  [[ -f "$BODY_SRC" ]] || {
    echo "Error: body file not found: $BODY_SRC" >&2
    exit 1
  }
  BODY="$(cat "$BODY_SRC")"
fi

TODAY="$(date +%F)"
YMD="$(date +%Y%m%d)"

# Slugify the title the same way run slugs are constrained: lowercase letters
# and single hyphens, 3-48 chars. Falls back to "note" if nothing survives.
slugify() {
  local s
  s="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '-' | sed -e 's/-\{2,\}/-/g' -e 's/^-//' -e 's/-$//')"
  s="${s:0:48}"
  [[ -n "$s" ]] || s="note"
  printf '%s' "$s"
}
TITLE_SLUG="$(slugify "$TITLE")"

case "$BANK_TYPE" in
obsidian-vault)
  [[ -n "$BANK_PATH" && -d "$BANK_PATH" ]] || {
    echo "bank-push: BANK_PATH '$BANK_PATH' is not a directory" >&2
    exit 2
  }
  DEST_DIR="$BANK_PATH/agent-relay"
  mkdir -p "$DEST_DIR"
  DEST_FILE="$DEST_DIR/${YMD}-${RUN_REF}-${TITLE_SLUG}.md"
  {
    printf -- '---\n'
    printf 'source: agent-relay\n'
    printf 'run: %s\n' "$RUN_REF"
    printf 'date: %s\n' "$TODAY"
    printf -- '---\n\n'
    printf '# %s\n\n' "$TITLE"
    printf '%s\n' "$BODY"
  } >"$DEST_FILE"
  echo "bank-push: wrote $DEST_FILE"
  exit 0
  ;;
*)
  echo "bank-push: backend '$BANK_TYPE' has no driver in this MVP" >&2
  exit 2
  ;;
esac
