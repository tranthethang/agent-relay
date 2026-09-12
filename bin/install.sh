#!/usr/bin/env bash
# agent-relay installer
#
# Adapts the skill bundles in skills/<name>/ into each supported tool's native
# rules/skills format, installed globally under $HOME.
#
# Requires: bash >= 3.2 (macOS system bash is fine).
#
# Usage (clone). A release download is the same script, saved as ./install.sh.
#   ./bin/install.sh [--only TOOL[,TOOL...]] [--skill NAME[,NAME...]]
#                    [--ref REF] [--sha256 HEX]
#                    [--dry-run] [--no-clobber]
#
# Examples:
#   ./bin/install.sh                                  # install all skills, all tools (local)
#   ./bin/install.sh --ref <tag>                      # download & install a release tag
#   ./bin/install.sh --ref <sha> --sha256 <hex>       # download & install pinned commit SHA
#   ./bin/install.sh --only cursor                    # install for Cursor only
#   ./bin/install.sh --skill atry-implement           # install a subset of skills
#   ./bin/install.sh --dry-run                        # show what would happen, write nothing
#   ./bin/install.sh --no-clobber                     # skip destinations that already exist
#
# Re-running without --no-clobber silently overwrites prior installs of the
# same skill files (custom edits to installed copies will be lost).

set -euo pipefail

DEFAULT_REF=""

CLI_REF=""
CLI_SHA256=""
ONLY_TOOLS=""
ONLY_SKILLS=""
DRY_RUN=0
NO_CLOBBER=0
TEMP_DIR=""
# Parse loop shifts "$@" away. Remote mode re-execs the extracted script,
# which must still see --only / --skill / --dry-run / --no-clobber.
ORIG_ARGS=("$@")

usage() {
  cat <<'EOF'
agent-relay installer

Adapts the skill bundles in skills/<name>/ into each supported tool's native
rules/skills format, installed globally under $HOME.

Requires: bash >= 3.2 (macOS system bash is fine).

Usage (clone). A release download is the same script, saved as ./install.sh.
  ./bin/install.sh [--only TOOL[,TOOL...]] [--skill NAME[,NAME...]]
                   [--ref REF] [--sha256 HEX]
                   [--dry-run] [--no-clobber]

Examples:
  ./bin/install.sh                                  # install all skills, all tools (local)
  ./bin/install.sh --ref <tag>                      # download & install a release tag
  ./bin/install.sh --ref <sha> --sha256 <hex>       # download & install pinned commit SHA
  ./bin/install.sh --only cursor                    # install for Cursor only
  ./bin/install.sh --skill atry-implement           # install a subset of skills
  ./bin/install.sh --dry-run                        # show what would happen, write nothing
  ./bin/install.sh --no-clobber                     # skip destinations that already exist

Re-running without --no-clobber silently overwrites prior installs of the
same skill files (custom edits to installed copies will be lost).
EOF
}

need_arg() {
  # need_arg <option> <value?>
  if [[ $# -lt 2 || -z "${2:-}" || "$2" == --* ]]; then
    echo "Missing value for $1" >&2
    usage
    exit 1
  fi
}

# Normalize a comma-separated list: lowercase, strip spaces around commas/tokens.
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
    --target)
      echo "Error: --target is no longer supported. Skills install globally under \$HOME." >&2
      echo "See README Install, or run with -h." >&2
      exit 1
      ;;
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
    --dry-run) DRY_RUN=1; shift ;;
    --no-clobber) NO_CLOBBER=1; shift ;;
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

# Standalone release download has neither layout, so it fetches the archive.
# --ref / AGENT_RELAY_REF also fetch, even from a clone. Otherwise a checkout
# would ignore the pin and install the working tree. DEFAULT_REF alone does
# not override a checkout (clone scripts leave it empty).
if [[ -z "${AGENT_RELAY_BOOTSTRAPPED:-}" && ( -z "$REPO_ROOT" || -n "${CLI_REF:-}" || -n "${AGENT_RELAY_REF:-}" ) ]]; then
  echo "Installer running in Remote Mode..."
  TARGET_REF="$(resolve_ref "${CLI_REF:-}" "${AGENT_RELAY_REF:-}" "${DEFAULT_REF:-}")"
  TARGET_SHA256="${CLI_SHA256:-${AGENT_RELAY_SHA256:-}}"

  TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agent-relay-install.XXXXXX")"
  download_and_extract_repo "$TARGET_REF" "$TARGET_SHA256" "$TEMP_DIR" >/dev/null

  if [[ -f "$SRC_DIR/bin/install.sh" ]]; then
    RELAY_NEXT="$SRC_DIR/bin/install.sh"
  elif [[ -f "$SRC_DIR/install.sh" ]]; then
    RELAY_NEXT="$SRC_DIR/install.sh"
  else
    echo "Error: install.sh not found in extracted archive" >&2
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

echo "Installer running in Local Mode..."
SRC_DIR="$REPO_ROOT"

SKILLS_DIR="$SRC_DIR/skills"
CONF="$SRC_DIR/targets.conf"

# shellcheck source=targets.conf
source "$CONF"

# bash 3.2-compatible check for TOOLS (no [[ -v ... ]])
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

if [[ ! -d "$SKILLS_DIR" ]]; then
  echo "Missing skills directory: $SKILLS_DIR" >&2
  exit 1
fi

log() { echo "  $*"; }

act_write() {
  # act_write <dest> <description> — returns 1 if skipped (no-clobber)
  local dest="$1" desc="$2"
  if [[ "$NO_CLOBBER" -eq 1 && -e "$dest" ]]; then
    log "skip (exists): $dest"
    return 1
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "[dry-run] $desc"
    return 0
  fi
  log "$desc"
  return 0
}

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
  # csv_has_unknown <kind> <csv> <valid1> [valid2...]
  # Prints unknown tokens to stderr; returns 0 (true) if any unknown.
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

write_skill_folder() {
  # write_skill_folder <skill_src_dir> <dest_skill_md>
  # Copies the whole bundle (SKILL.md, references/, scripts/) into the parent
  # of dest_skill_md. Per-file --no-clobber is handled by the caller on SKILL.md;
  # sibling files are refreshed when SKILL.md is written.
  local skill_src="$1" dest="$2"
  local dest_root
  dest_root="$(dirname "$dest")"
  mkdir -p "$dest_root"
  # Refresh bundle contents
  rm -rf "$dest_root/references" "$dest_root/scripts"
  cp "$skill_src/SKILL.md" "$dest"
  if [[ -d "$skill_src/references" ]]; then
    mkdir -p "$dest_root/references"
    cp -R "$skill_src/references/." "$dest_root/references/"
  fi
  if [[ -d "$skill_src/scripts" ]]; then
    mkdir -p "$dest_root/scripts"
    cp -R "$skill_src/scripts/." "$dest_root/scripts/"
    # Intentional: chmod may no-op on empty; ignore if no matches.
    chmod +x "$dest_root/scripts"/* 2>/dev/null || true
  fi
}

# Remove prior-format installs from LEGACY_DIRS (both .mdc and skill-folder).
# Does not fail if absent. Uses the caller's legacy_dirs + dest_dir.
cleanup_legacy_artifacts() {
  # cleanup_legacy_artifacts <skill_name>
  local name="$1" legacy_dir
  for legacy_dir in "${legacy_dirs[@]+"${legacy_dirs[@]}"}"; do
    [[ -z "$legacy_dir" || "$legacy_dir" == "$dest_dir" ]] && continue
    if [[ -f "$legacy_dir/$name.mdc" ]]; then
      if [[ "$DRY_RUN" -eq 1 ]]; then
        log "[dry-run] rm legacy $legacy_dir/$name.mdc"
      else
        log "rm legacy $legacy_dir/$name.mdc"
        rm -f "$legacy_dir/$name.mdc"
      fi
    fi
    if [[ -e "$legacy_dir/$name" ]]; then
      if [[ "$DRY_RUN" -eq 1 ]]; then
        log "[dry-run] rm -rf legacy $legacy_dir/$name"
      else
        log "rm -rf legacy $legacy_dir/$name"
        rm -rf "$legacy_dir/$name"
      fi
    fi
  done
}

# Collect skill bundles (skills/<name>/SKILL.md).
shopt -s nullglob
skill_dirs=()
for _d in "$SKILLS_DIR"/*/ ; do
  [[ -f "${_d}SKILL.md" ]] || continue
  skill_dirs+=("$_d")
done
shopt -u nullglob

if [[ ${#skill_dirs[@]} -eq 0 ]]; then
  echo "No skill bundles found in $SKILLS_DIR/*/SKILL.md" >&2
  exit 1
fi

# Build lowercase catalogs for validation.
valid_tools=()
for tool in "${TOOLS[@]}"; do
  valid_tools+=("$(echo "$tool" | tr '[:upper:]' '[:lower:]')")
done
valid_skills=()
for skill_dir in "${skill_dirs[@]}"; do
  valid_skills+=("$(echo "$(basename "${skill_dir%/}")" | tr '[:upper:]' '[:lower:]')")
done

if [[ -n "$ONLY_TOOLS" ]] && csv_has_unknown tool "$ONLY_TOOLS" "${valid_tools[@]}"; then
  echo "Known tools: ${valid_tools[*]}" >&2
  exit 1
fi
if [[ -n "$ONLY_SKILLS" ]] && csv_has_unknown skill "$ONLY_SKILLS" "${valid_skills[@]}"; then
  echo "Known skills: ${valid_skills[*]}" >&2
  exit 1
fi

echo "agent-relay: installing globally under \$HOME ($HOME)"

installed=0
skipped=0

for tool in "${TOOLS[@]}"; do
  tool_selected "$tool" || continue
  dir_var="${tool}_DIR"
  fmt_var="${tool}_FORMAT"
  dest_dir="${!dir_var}"
  fmt="${!fmt_var}"

  legacy_dirs=()
  legacy_var="${tool}_LEGACY_DIRS"
  if declare -p "$legacy_var" >/dev/null 2>&1; then
    # shellcheck disable=SC1087
    eval "legacy_dirs=(\"\${${legacy_var}[@]}\")"
  fi

  echo "[$tool] -> $dest_dir ($fmt)"
  for skill_dir in "${skill_dirs[@]}"; do
    name="$(basename "${skill_dir%/}")"
    skill_selected "$name" || continue

    case "$fmt" in
      skill-folder)
        dest="$dest_dir/$name/SKILL.md"
        if act_write "$dest" "-> $dest_dir/$name/ (bundle)"; then
          if [[ "$DRY_RUN" -eq 0 ]]; then
            write_skill_folder "$skill_dir" "$dest"
          fi
          installed=$((installed + 1))
        else
          skipped=$((skipped + 1))
        fi
        cleanup_legacy_artifacts "$name"
        ;;
      *)
        echo "Unknown format '$fmt' for $tool (only skill-folder is supported)" >&2
        exit 1
        ;;
    esac
  done
done

# Clean leftover v0.4 global script installs (scripts now live in skill bundles).
LEGACY_SCRIPTS="$HOME/.agent-relay/scripts"
if [[ "$DRY_RUN" -eq 0 && -d "$LEGACY_SCRIPTS" ]]; then
  echo "  Cleaning legacy $LEGACY_SCRIPTS (scripts now ship inside skill bundles)"
  rm -f "$LEGACY_SCRIPTS/task-claim.sh" \
    "$LEGACY_SCRIPTS/task-init.sh" \
    "$LEGACY_SCRIPTS/resolve-task-bin.sh" \
    "$LEGACY_SCRIPTS/review-section.sh"
  rmdir "$LEGACY_SCRIPTS" 2>/dev/null || true
  rmdir "$HOME/.agent-relay" 2>/dev/null || true
fi

if [[ "$installed" -eq 0 && "$skipped" -eq 0 ]]; then
  echo "Nothing to install (filters matched no tool/skill combinations)." >&2
  exit 1
fi

echo "Done. ($installed written, $skipped skipped)"
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "(dry run — nothing was written)"
else
  echo "Installed under:"
  for tool in "${TOOLS[@]}"; do
    tool_selected "$tool" || continue
    dir_var="${tool}_DIR"
    echo "  ${!dir_var}"
  done
  echo "Tip: run bin/verify.sh (clone) or ./verify.sh (release download) to confirm the install."
  echo "Tip: each skill bundle includes references/ and scripts/ next to SKILL.md."
  echo "Tip: add .agent-relay/ to each project's .gitignore if you do not want relay working files committed."
fi
