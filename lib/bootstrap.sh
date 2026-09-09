#!/usr/bin/env bash
# agent-relay bootstrap library
#
# Helpers for downloading, verifying, and extracting agent-relay archives
# in remote install/uninstall/verify modes.
#
# Requires: bash >= 3.2 (macOS system bash is fine).

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
