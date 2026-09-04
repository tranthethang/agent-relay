#!/usr/bin/env bash
# agent-relay verifier
#
# Checks that each expected skill artifact from install.sh exists under $HOME.
# Prints [OK] / [FAIL] per item. Exit 0 only when every expected item is present.
#
# Requires: bash >= 3.2 (macOS system bash is fine).
#
# Usage:
#   ./verify.sh [--only TOOL[,TOOL...]] [--skill NAME[,NAME...]]
#   curl -fsSL https://raw.githubusercontent.com/tranthethang/agent-relay/main/verify.sh | bash
#   curl -fsSL …/verify.sh | bash -s -- --only cursor

set -euo pipefail

REPO_ARCHIVE_URL="https://github.com/tranthethang/agent-relay/archive/refs/heads/main.tar.gz"
REPO_ARCHIVE_ROOT="agent-relay-main"

ONLY_TOOLS=""
ONLY_SKILLS=""
TEMP_DIR=""

usage() { sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; }

need_arg() {
  if [[ $# -lt 2 || -z "${2:-}" || "$2" == --* ]]; then
    echo "Missing value for $1" >&2
    usage
    exit 1
  fi
}

normalize_csv() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[[:space:]]*,[[:space:]]*/,/g; s/^[[:space:]]*//; s/[[:space:]]*$//'
}

cleanup_temp() {
  if [[ -n "${TEMP_DIR:-}" && -d "$TEMP_DIR" ]]; then
    rm -rf "$TEMP_DIR"
  fi
}
trap cleanup_temp EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --only)
      need_arg "$1" "${2:-}"
      ONLY_TOOLS="$(normalize_csv "$2")"
      shift 2
      ;;
    --skill)
      need_arg "$1" "${2:-}"
      ONLY_SKILLS="$(normalize_csv "$2")"
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo "")"

if [[ -n "$SCRIPT_DIR" && -d "$SCRIPT_DIR/skills" && -f "$SCRIPT_DIR/targets.conf" ]]; then
  echo "Verifier running in Local Mode..."
  SRC_DIR="$SCRIPT_DIR"
else
  echo "Verifier running in Remote Mode..."
  TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agent-relay-verify.XXXXXX")"
  archive="$TEMP_DIR/agent-relay.tar.gz"

  echo "Downloading source archive..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$archive" "$REPO_ARCHIVE_URL"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$archive" "$REPO_ARCHIVE_URL"
  else
    echo "Error: Neither curl nor wget was found. Please install one of them to proceed." >&2
    exit 1
  fi

  echo "Extracting archive..."
  tar -xzf "$archive" -C "$TEMP_DIR"
  SRC_DIR="$TEMP_DIR/$REPO_ARCHIVE_ROOT"
  if [[ ! -d "$SRC_DIR/skills" || ! -f "$SRC_DIR/targets.conf" ]]; then
    echo "Error: unexpected archive layout (missing skills/ or targets.conf under $REPO_ARCHIVE_ROOT)" >&2
    exit 1
  fi
fi

SKILLS_DIR="$SRC_DIR/skills"
CONF="$SRC_DIR/targets.conf"

# shellcheck source=targets.conf
source "$CONF"

if ! declare -p TOOLS >/dev/null 2>&1 || [[ ${#TOOLS[@]} -eq 0 ]]; then
  echo "targets.conf must define a non-empty TOOLS=(...) array" >&2
  exit 1
fi

for tool in "${TOOLS[@]}"; do
  dir_var="${tool}_DIR"
  fmt_var="${tool}_FORMAT"
  if ! declare -p "$dir_var" >/dev/null 2>&1 || ! declare -p "$fmt_var" >/dev/null 2>&1; then
    echo "targets.conf: $tool is listed in TOOLS but ${tool}_DIR / ${tool}_FORMAT are missing" >&2
    exit 1
  fi
done

shopt -s nullglob
skill_files=("$SKILLS_DIR"/*.md)
shopt -u nullglob

if [[ ${#skill_files[@]} -eq 0 ]]; then
  echo "No skills found in $SKILLS_DIR/*.md" >&2
  exit 1
fi

tool_selected() {
  local tool_lc; tool_lc="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
  [[ -z "$ONLY_TOOLS" ]] && return 0
  [[ ",$ONLY_TOOLS," == *",$tool_lc,"* ]]
}

skill_selected() {
  local name_lc; name_lc="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
  [[ -z "$ONLY_SKILLS" ]] && return 0
  [[ ",$ONLY_SKILLS," == *",$name_lc,"* ]]
}

csv_has_unknown() {
  local kind="$1" csv="$2"
  shift 2
  local -a valids=("$@")
  local -a tokens
  local unknown=0 token v ok
  [[ -z "$csv" ]] && return 1
  IFS=',' read -r -a tokens <<< "$csv"
  for token in "${tokens[@]}"; do
    [[ -z "$token" ]] && continue
    ok=0
    for v in "${valids[@]}"; do
      if [[ "$token" == "$v" ]]; then ok=1; break; fi
    done
    if [[ "$ok" -eq 0 ]]; then
      echo "Unknown $kind: $token" >&2
      unknown=1
    fi
  done
  [[ "$unknown" -eq 1 ]]
}

valid_tools=()
for tool in "${TOOLS[@]}"; do
  valid_tools+=("$(echo "$tool" | tr '[:upper:]' '[:lower:]')")
done
valid_skills=()
for skill_file in "${skill_files[@]}"; do
  valid_skills+=("$(echo "$(basename "$skill_file" .md)" | tr '[:upper:]' '[:lower:]')")
done

if [[ -n "$ONLY_TOOLS" ]] && csv_has_unknown tool "$ONLY_TOOLS" "${valid_tools[@]}"; then
  echo "Known tools: ${valid_tools[*]}" >&2
  exit 1
fi
if [[ -n "$ONLY_SKILLS" ]] && csv_has_unknown skill "$ONLY_SKILLS" "${valid_skills[@]}"; then
  echo "Known skills: ${valid_skills[*]}" >&2
  exit 1
fi

echo "Verifying agent-relay install under \$HOME ($HOME)..."

FAILED=0
checked=0

for tool in "${TOOLS[@]}"; do
  tool_selected "$tool" || continue
  dir_var="${tool}_DIR"
  fmt_var="${tool}_FORMAT"
  dest_dir="${!dir_var}"
  fmt="${!fmt_var}"

  for skill_file in "${skill_files[@]}"; do
    name="$(basename "$skill_file" .md)"
    skill_selected "$name" || continue
    checked=$((checked + 1))

    case "$fmt" in
      mdc-flat)
        dest="$dest_dir/$name.mdc"
        if [[ -f "$dest" ]]; then
          echo "[OK] $tool skill '$name' at $dest"
        else
          echo "[FAIL] $tool skill '$name' missing at $dest"
          FAILED=1
        fi
        ;;
      skill-folder)
        dest="$dest_dir/$name/SKILL.md"
        if [[ -f "$dest" ]]; then
          echo "[OK] $tool skill '$name' at $dest"
        else
          echo "[FAIL] $tool skill '$name' missing at $dest"
          FAILED=1
        fi
        ;;
      *)
        echo "Unknown format '$fmt' for $tool" >&2
        exit 1
        ;;
    esac
  done
done

if [[ "$checked" -eq 0 ]]; then
  echo "Nothing to verify (filters matched no tool/skill combinations)." >&2
  exit 1
fi

if [[ "$FAILED" -eq 0 ]]; then
  echo "Verification PASSED! Everything is set up correctly."
  exit 0
else
  echo "Verification FAILED!"
  exit 1
fi
