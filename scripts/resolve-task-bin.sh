#!/usr/bin/env bash
# scripts/resolve-task-bin.sh
# Print the absolute path of task-claim.sh or task-init.sh.
# Resolution order:
#   1. <cwd>/.agent-relay/scripts/<name>
#   2. $HOME/.agent-relay/scripts/<name>
# Fail with install instructions if neither exists.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  resolve-task-bin.sh claim
  resolve-task-bin.sh init
EOF
  exit 1
}

[[ $# -eq 1 ]] || usage

case "$1" in
  claim) name="task-claim.sh" ;;
  init)  name="task-init.sh" ;;
  *) usage ;;
esac

candidates=(
  "${PWD}/.agent-relay/scripts/${name}"
  "${HOME}/.agent-relay/scripts/${name}"
)

for path in "${candidates[@]}"; do
  if [[ -x "$path" ]]; then
    # Prefer realpath/readlink when available; fall back to the candidate path.
    # Do not resolve symlinks for the printed path when the candidate already
    # works as an executable — callers compare against $HOME / $PWD literals.
    echo "$path"
    exit 0
  fi
done

echo "Error: ${name} not found." >&2
echo "Looked in:" >&2
for path in "${candidates[@]}"; do
  echo "  $path" >&2
done
echo "Run bin/install.sh (or copy scripts/ into ~/.agent-relay/scripts/)." >&2
exit 1
