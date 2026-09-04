#!/usr/bin/env bash
# agent-relay installer
#
# Adapts the neutral skills in skills/*.md into each supported tool's native
# rules/skills format, installed globally under $HOME.
#
# Requires: bash >= 3.2 (macOS system bash is fine).
#
# Usage:
#   ./install.sh [--only TOOL[,TOOL...]] [--skill NAME[,NAME...]]
#                [--dry-run] [--no-clobber]
#   curl -fsSL https://raw.githubusercontent.com/tranthethang/agent-relay/main/install.sh | bash
#   curl -fsSL …/install.sh | bash -s -- --only cursor
#
# Examples:
#   ./install.sh                                  # install all skills, all tools
#   ./install.sh --only cursor                     # install for Cursor only
#   ./install.sh --skill atry-implement,atry-self-review     # install a subset of skills
#   ./install.sh --dry-run                         # show what would happen, write nothing
#   ./install.sh --no-clobber                      # skip destinations that already exist
#
# Re-running without --no-clobber silently overwrites prior installs of the
# same skill files (custom edits to installed copies will be lost).

set -euo pipefail

REPO_ARCHIVE_URL="https://github.com/tranthethang/agent-relay/archive/refs/heads/main.tar.gz"
REPO_ARCHIVE_ROOT="agent-relay-main"

ONLY_TOOLS=""
ONLY_SKILLS=""
DRY_RUN=0
NO_CLOBBER=0
TEMP_DIR=""

usage() { sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; }

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
trap cleanup_temp EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      echo "Error: --target is no longer supported. Skills install globally under \$HOME." >&2
      echo "See README Quick Start, or run with -h." >&2
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
    --dry-run) DRY_RUN=1; shift ;;
    --no-clobber) NO_CLOBBER=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

# Detect Local vs Remote Mode (curl | bash → SCRIPT_DIR has no skills/ + targets.conf).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo "")"

if [[ -n "$SCRIPT_DIR" && -d "$SCRIPT_DIR/skills" && -f "$SCRIPT_DIR/targets.conf" ]]; then
  echo "Installer running in Local Mode..."
  SRC_DIR="$SCRIPT_DIR"
else
  echo "Installer running in Remote Mode..."
  TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agent-relay-install.XXXXXX")"
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

# Split a skill file into frontmatter (between the two --- lines) and body.
has_frontmatter() {
  awk 'BEGIN{ok=0} /^---$/ {c++; if(c==2){ok=1; exit}} END{exit !ok}' "$1"
}

frontmatter_field() {
  # frontmatter_field <file> <field>
  awk -v field="$2" '
    /^---$/ { d++; next }
    d==1 && $0 ~ "^"field":" { sub("^"field": ?", ""); print; exit }
  ' "$1"
}

body_only() {
  # Emit body after YAML frontmatter; if no frontmatter, emit the whole file.
  if has_frontmatter "$1"; then
    awk '/^---$/{d++; next} d>=2' "$1"
  else
    cat "$1"
  fi
}

yaml_quote() {
  # YAML double-quoted scalar; escape \ and "
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '"%s"' "$s"
}

write_mdc() {
  # write_mdc <skill_file> <dest>
  local skill_file="$1" dest="$2"
  local description dest_dir
  description="$(frontmatter_field "$skill_file" description)"
  dest_dir="$(dirname "$dest")"
  mkdir -p "$dest_dir"
  {
    printf -- '---\ndescription: %s\nalwaysApply: false\n---\n\n' "$(yaml_quote "$description")"
    body_only "$skill_file"
  } > "$dest"
}

write_skill_folder() {
  # write_skill_folder <skill_file> <dest>
  local skill_file="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  cp "$skill_file" "$dest"
}

# Collect skill files (nullglob so an empty dir does not yield a literal *.md).
shopt -s nullglob
skill_files=("$SKILLS_DIR"/*.md)
shopt -u nullglob

if [[ ${#skill_files[@]} -eq 0 ]]; then
  echo "No skills found in $SKILLS_DIR/*.md" >&2
  exit 1
fi

# Build lowercase catalogs for validation.
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

echo "agent-relay: installing globally under \$HOME ($HOME)"

installed=0
skipped=0

for tool in "${TOOLS[@]}"; do
  tool_selected "$tool" || continue
  dir_var="${tool}_DIR"
  fmt_var="${tool}_FORMAT"
  dest_dir="${!dir_var}"
  fmt="${!fmt_var}"

  echo "[$tool] -> $dest_dir ($fmt)"
  for skill_file in "${skill_files[@]}"; do
    name="$(basename "$skill_file" .md)"
    skill_selected "$name" || continue

    case "$fmt" in
      mdc-flat)
        dest="$dest_dir/$name.mdc"
        if act_write "$dest" "-> $dest"; then
          if [[ "$DRY_RUN" -eq 0 ]]; then
            write_mdc "$skill_file" "$dest"
          fi
          installed=$((installed + 1))
        else
          skipped=$((skipped + 1))
        fi
        ;;
      skill-folder)
        dest="$dest_dir/$name/SKILL.md"
        if act_write "$dest" "-> $dest"; then
          if [[ "$DRY_RUN" -eq 0 ]]; then
            write_skill_folder "$skill_file" "$dest"
          fi
          installed=$((installed + 1))
        else
          skipped=$((skipped + 1))
        fi
        ;;
      *)
        echo "Unknown format '$fmt' for $tool" >&2
        exit 1
        ;;
    esac
  done
done

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
  echo "Tip: run verify.sh to confirm the install."
  echo "Tip: add .agent-relay/ to each project's .gitignore if you do not want relay working files committed."
fi
