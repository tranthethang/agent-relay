#!/usr/bin/env bash
# agent-relay verifier
#
# Checks that each expected skill artifact from install.sh exists under $HOME.
# Prints [OK] / [FAIL] per item. Exit 0 only when every expected item is present.
#
# Requires: bash >= 3.2 (macOS system bash is fine).
#
# Usage (clone). A release download is the same script, saved as ./verify.sh.
#   ./bin/verify.sh [--only TOOL[,TOOL...]] [--skill NAME[,NAME...]]
#                   [--ref REF] [--sha256 HEX]

set -euo pipefail

DEFAULT_REF=""

CLI_REF=""
CLI_SHA256=""
ONLY_TOOLS=""
ONLY_SKILLS=""
TEMP_DIR=""
# Parse loop shifts "$@" away. Remote mode re-execs the extracted script,
# which must still see --only / --skill.
ORIG_ARGS=("$@")

usage() {
  cat <<'EOF'
agent-relay verifier

Checks that each expected skill artifact from install.sh exists under $HOME.
Prints [OK] / [FAIL] per item. Exit 0 only when every expected item is present.

Requires: bash >= 3.2 (macOS system bash is fine).

Usage (clone). A release download is the same script, saved as ./verify.sh.
  ./bin/verify.sh [--only TOOL[,TOOL...]] [--skill NAME[,NAME...]]
                  [--ref REF] [--sha256 HEX]
EOF
}

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
trap cleanup_temp EXIT INT TERM

# BEGIN BOOTSTRAP

# Download a file from URL to destination path
http_get() {
  local url="$1"
  local out="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$out" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$out" "$url"
  else
    echo "Error: Neither curl nor wget was found. Please install one of them to proceed." >&2
    return 1
  fi
}

# Calculate SHA-256 hex digest of a file
sha256_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo "Error: File not found for sha256 calculation: $file" >&2
    return 1
  fi
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    echo "Error: Neither shasum nor sha256sum was found." >&2
    return 1
  fi
}

# Verify a file matches the expected SHA-256 hex digest
verify_sha256() {
  local file="$1"
  local expected="$2"
  local actual
  actual="$(sha256_file "$file")" || return 1
  actual="$(echo "$actual" | tr '[:upper:]' '[:lower:]')"
  expected="$(echo "$expected" | tr '[:upper:]' '[:lower:]')"

  if [[ "$actual" != "$expected" ]]; then
    echo "Error: SHA-256 checksum mismatch for $(basename "$file")" >&2
    echo "  Expected: $expected" >&2
    echo "  Actual:   $actual" >&2
    return 1
  fi
}

# Verify a file against an entry matching its basename in a SHA256SUMS file
verify_sha256sums_entry() {
  local file="$1"
  local sums_file="$2"
  if [[ ! -f "$sums_file" ]]; then
    echo "Error: Checksum file not found: $sums_file" >&2
    return 1
  fi
  local base
  base="$(basename "$file")"
  local expected
  expected="$(awk -v b="$base" '$2 == b || $2 == "*"b || $NF == b {print $1; exit}' "$sums_file")"

  if [[ -z "$expected" ]]; then
    echo "Error: Checksum for $base not found in $sums_file" >&2
    return 1
  fi

  verify_sha256 "$file" "$expected"
}

# Resolve target ref with priority: CLI arg > ENV > DEFAULT_REF
resolve_ref() {
  local cli_ref="${1:-}"
  local env_ref="${2:-${AGENT_RELAY_REF:-}}"
  local default_ref="${3:-${DEFAULT_REF:-}}"

  if [[ -n "$cli_ref" ]]; then
    echo "$cli_ref"
  elif [[ -n "$env_ref" ]]; then
    echo "$env_ref"
  elif [[ -n "$default_ref" ]]; then
    echo "$default_ref"
  else
    echo ""
  fi
}

# Download, verify, and extract repo archive to temp_dir. Sets and prints SRC_DIR.
download_and_extract_repo() {
  local ref="$1"
  local sha256_optional="${2:-}"
  local temp_dir="$3"

  if [[ -z "$ref" ]]; then
    echo "Error: No release ref specified. Provide --ref <tag> (a release tag) or clone locally." >&2
    return 1
  fi

  if [[ "$ref" == "main" || "$ref" == "master" || "$ref" == "refs/heads/"* ]]; then
    echo "Error: Remote install from floating ref '$ref' is refused for security." >&2
    echo "Please specify a tagged release (--ref <tag>) or clone locally." >&2
    return 1
  fi

  local archive="$temp_dir/agent-relay-${ref}.tar.gz"

  if [[ "$ref" =~ ^[0-9a-fA-F]{40}$ ]]; then
    if [[ -z "$sha256_optional" ]]; then
      echo "Error: Remote install with commit SHA requires an explicit --sha256 checksum." >&2
      return 1
    fi
    local archive_url="https://github.com/tranthethang/agent-relay/archive/${ref}.tar.gz"
    echo "Downloading archive for commit ${ref}..." >&2
    http_get "$archive_url" "$archive" || return 1
    verify_sha256 "$archive" "$sha256_optional" || return 1
  else
    local archive_url="https://github.com/tranthethang/agent-relay/releases/download/${ref}/agent-relay-${ref}.tar.gz"
    echo "Downloading release archive for ${ref}..." >&2
    http_get "$archive_url" "$archive" || return 1

    if [[ -n "$sha256_optional" ]]; then
      verify_sha256 "$archive" "$sha256_optional" || return 1
    else
      local sums_url="https://github.com/tranthethang/agent-relay/releases/download/${ref}/SHA256SUMS"
      local sums_file="$temp_dir/SHA256SUMS"
      echo "Downloading SHA256SUMS for ${ref}..." >&2
      http_get "$sums_url" "$sums_file" || return 1
      verify_sha256sums_entry "$archive" "$sums_file" || return 1
    fi
  fi

  echo "Extracting archive..." >&2
  tar -xzf "$archive" -C "$temp_dir" || return 1

  local found_dir=""
  for d in "$temp_dir"/*; do
    if [[ -d "$d" && -d "$d/skills" && -f "$d/targets.conf" ]]; then
      found_dir="$d"
      break
    fi
  done

  if [[ -z "$found_dir" ]]; then
    echo "Error: unexpected archive layout (missing skills/ or targets.conf in extracted archive)" >&2
    return 1
  fi

  SRC_DIR="$found_dir"
  echo "$found_dir"
}
# END BOOTSTRAP

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
    --ref)
      need_arg "$1" "${2:-}"
      CLI_REF="$2"
      shift 2
      ;;
    --sha256)
      need_arg "$1" "${2:-}"
      CLI_SHA256="$2"
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo "")"

# Checkout: this script lives in bin/, repo root is the parent.
# Copied beside skills/ (tests, older archives): use SCRIPT_DIR.
REPO_ROOT=""
if [[ -n "$SCRIPT_DIR" && -d "$SCRIPT_DIR/skills" && -f "$SCRIPT_DIR/targets.conf" ]]; then
  REPO_ROOT="$SCRIPT_DIR"
elif [[ -n "$SCRIPT_DIR" && -d "$SCRIPT_DIR/../skills" && -f "$SCRIPT_DIR/../targets.conf" ]]; then
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

if [[ -n "$REPO_ROOT" && -f "$REPO_ROOT/lib/bootstrap.sh" ]]; then
  # shellcheck source=../lib/bootstrap.sh
  source "$REPO_ROOT/lib/bootstrap.sh"
elif [[ -f "$SCRIPT_DIR/lib/bootstrap.sh" ]]; then
  # shellcheck source=lib/bootstrap.sh
  source "$SCRIPT_DIR/lib/bootstrap.sh"
fi

# Standalone download, or an explicit --ref / AGENT_RELAY_REF (even from a clone).
if [[ -z "${AGENT_RELAY_BOOTSTRAPPED:-}" && ( -z "$REPO_ROOT" || -n "${CLI_REF:-}" || -n "${AGENT_RELAY_REF:-}" ) ]]; then
  echo "Verifier running in Remote Mode..."
  TARGET_REF="$(resolve_ref "${CLI_REF:-}" "${AGENT_RELAY_REF:-}" "${DEFAULT_REF:-}")"
  TARGET_SHA256="${CLI_SHA256:-${AGENT_RELAY_SHA256:-}}"

  TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agent-relay-verify.XXXXXX")"
  download_and_extract_repo "$TARGET_REF" "$TARGET_SHA256" "$TEMP_DIR" >/dev/null

  if [[ -f "$SRC_DIR/bin/verify.sh" ]]; then
    RELAY_NEXT="$SRC_DIR/bin/verify.sh"
  elif [[ -f "$SRC_DIR/verify.sh" ]]; then
    RELAY_NEXT="$SRC_DIR/verify.sh"
  else
    echo "Error: verify.sh not found in extracted archive" >&2
    exit 1
  fi

  export AGENT_RELAY_BOOTSTRAPPED=1
  # bash 3.2 + set -u errors on an empty "${arr[@]}"
  if [[ ${#ORIG_ARGS[@]} -gt 0 ]]; then
    "$RELAY_NEXT" "${ORIG_ARGS[@]}"
  else
    "$RELAY_NEXT"
  fi
  exit $?
fi

echo "Verifier running in Local Mode..."
SRC_DIR="$REPO_ROOT"

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

# Always verify global scripts regardless of --only / --skill filters.
for _script in task-claim.sh task-init.sh resolve-task-bin.sh; do
  _sdest="$HOME/.agent-relay/scripts/$_script"
  if [[ -x "$_sdest" ]]; then
    echo "[OK] script '$_script' at $_sdest"
  else
    echo "[FAIL] script '$_script' missing or not executable at $_sdest"
    FAILED=1
  fi
  checked=$((checked + 1))
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
