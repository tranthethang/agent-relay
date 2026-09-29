#!/usr/bin/env bash
# scripts/maint/sync-references.sh
# Keep shared files inside skills/*/ bundles identical to their sources:
#   - docs/conventions/*.md  -> generated docs/file-conventions.md (all parts)
#                            -> skills/<name>/references/file-conventions.md
#                              (per-skill subset from the manifest below)
#   - review-*-template.md / reviewer-conduct.md
#     -> atry-self-review (canonical) <-> atry-cross-review
# Runtime helpers live under scripts/runtime/ and are installed via `atry`
# (~/.agent-relay); skill bundles must not carry scripts/.
# Usage:
#   bash scripts/maint/sync-references.sh              # update copies
#   bash scripts/maint/sync-references.sh --check       # fail if any copy drifts
#   bash scripts/maint/sync-references.sh --root DIR …  # operate on DIR (tests)
# Env: AGENT_RELAY_SYNC_ROOT — default root when --root is not passed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
if [[ -n "${AGENT_RELAY_SYNC_ROOT:-}" ]]; then
  ROOT_DIR="$(cd "$AGENT_RELAY_SYNC_ROOT" && pwd -P)"
fi

CHECK_ONLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
  --check)
    CHECK_ONLY=1
    shift
    ;;
  --root)
    if [[ $# -lt 2 || -z "${2:-}" || "$2" == --* ]]; then
      echo "Error: --root requires a directory argument" >&2
      exit 1
    fi
    ROOT_DIR="$(cd "$2" && pwd -P)"
    shift 2
    ;;
  *)
    echo "Error: unknown argument: $1" >&2
    echo "Usage: bash scripts/maint/sync-references.sh [--check] [--root DIR]" >&2
    exit 1
    ;;
  esac
done

CONV_DIR="$ROOT_DIR/docs/conventions"
FULL_DEST="$ROOT_DIR/docs/file-conventions.md"
SELF_REVIEW_REF="$ROOT_DIR/skills/atry-self-review/references"
CROSS_REVIEW_REF="$ROOT_DIR/skills/atry-cross-review/references"
REVIEW_TEMPLATES=(
  "review-report-template.md"
  "review-walkthrough-template.md"
  "reviewer-conduct.md"
)

# Manifest: skill directory basename -> space-separated convention parts
# (files under docs/conventions/<part>.md), in output order. Every skill
# ends with notes. Edit parts under docs/conventions/; do not hand-edit
# generated file-conventions.md copies.
skill_parts() {
  case "$1" in
  atry-brainstorm) echo "core notes" ;;
  atry-plan) echo "core notes" ;;
  atry-implement) echo "core notes" ;;
  atry-self-review) echo "core review-headings parallel notes" ;;
  atry-cross-review) echo "core review-headings parallel notes" ;;
  atry-distill) echo "core bank notes" ;;
  *)
    echo "Error: no conventions manifest entry for skill '$1'" >&2
    return 1
    ;;
  esac
}

# All parts, in the order used for docs/file-conventions.md.
ALL_PARTS="core review-headings parallel bank notes"

[[ -d "$CONV_DIR" ]] || {
  echo "Error: $CONV_DIR not found" >&2
  exit 1
}

for part in $ALL_PARTS; do
  [[ -f "$CONV_DIR/$part.md" ]] || {
    echo "Error: missing convention part $CONV_DIR/$part.md" >&2
    exit 1
  }
done

concat_parts() {
  # concat_parts <part> [<part> ...]  — prints concatenated markdown to stdout
  local part first=1
  for part in "$@"; do
    [[ -f "$CONV_DIR/$part.md" ]] || {
      echo "Error: missing convention part $CONV_DIR/$part.md" >&2
      return 1
    }
    if [[ "$first" -eq 1 ]]; then
      first=0
    else
      # Parts end with a single trailing newline; emit one more so adjacent
      # ## headings are separated by a blank line (dprint / CommonMark).
      printf '\n'
    fi
    cat "$CONV_DIR/$part.md"
  done
}

write_or_check() {
  # write_or_check <dest> <stdin from concat via temp>
  local dest="$1" tmp="$2"
  if [[ "$CHECK_ONLY" -eq 1 ]]; then
    if [[ ! -f "$dest" ]]; then
      echo "Missing: $dest" >&2
      return 1
    fi
    if ! cmp -s "$tmp" "$dest"; then
      echo "Drift: $dest differs from generated conventions" >&2
      return 1
    fi
    return 0
  fi
  mkdir -p "$(dirname "$dest")"
  cp "$tmp" "$dest"
  echo "synced $dest"
}

drift=0

# --- full docs/file-conventions.md ---
tmp_full="$(mktemp "${TMPDIR:-/tmp}/ar-conv-full.XXXXXX")"
# shellcheck disable=SC2086
concat_parts $ALL_PARTS >"$tmp_full"
if ! write_or_check "$FULL_DEST" "$tmp_full"; then
  drift=1
fi
rm -f "$tmp_full"

# --- per-skill generated file-conventions.md ---
shopt -s nullglob
skill_dirs=("$ROOT_DIR"/skills/*/)
shopt -u nullglob

[[ ${#skill_dirs[@]} -gt 0 ]] || {
  echo "Error: no skills/*/ directories" >&2
  exit 1
}

for d in "${skill_dirs[@]}"; do
  skill="$(basename "$d")"
  parts="$(skill_parts "$skill")" || {
    drift=1
    continue
  }
  tmp_skill="$(mktemp "${TMPDIR:-/tmp}/ar-conv-skill.XXXXXX")"
  # shellcheck disable=SC2086
  concat_parts $parts >"$tmp_skill"
  dest="$d/references/file-conventions.md"
  if ! write_or_check "$dest" "$tmp_skill"; then
    drift=1
  fi
  rm -f "$tmp_skill"

  # Skill bundles must not ship scripts/ (runtime is `atry` under ~/.agent-relay).
  if [[ -d "${d}scripts" ]]; then
    if [[ "$CHECK_ONLY" -eq 1 ]]; then
      echo "Orphan: ${d}scripts/ must not exist (use atry CLI)" >&2
      drift=1
    else
      rm -rf "${d}scripts"
      echo "removed ${d}scripts/"
    fi
  fi
done

# Review templates must stay byte-identical across self-review and cross-review.
# Canonical copy lives under atry-self-review; sync copies it to atry-cross-review.
for name in "${REVIEW_TEMPLATES[@]}"; do
  src="$SELF_REVIEW_REF/$name"
  dest="$CROSS_REVIEW_REF/$name"
  if [[ "$CHECK_ONLY" -eq 1 ]]; then
    if [[ ! -f "$src" ]]; then
      echo "Missing: $src" >&2
      drift=1
      continue
    fi
    if [[ ! -f "$dest" ]]; then
      echo "Missing: $dest" >&2
      drift=1
      continue
    fi
    if ! cmp -s "$src" "$dest"; then
      echo "Drift: $dest differs from $src" >&2
      drift=1
    fi
  else
    if [[ ! -f "$src" ]]; then
      echo "Error: canonical review template missing: $src" >&2
      exit 1
    fi
    mkdir -p "$CROSS_REVIEW_REF"
    cp "$src" "$dest"
    echo "synced $dest"
  fi
done

# --- Preflight partial: docs/partials/preflight.md between markers in each SKILL.md ---
PREFLIGHT_PARTIAL="$ROOT_DIR/docs/partials/preflight.md"
[[ -f "$PREFLIGHT_PARTIAL" ]] || {
  echo "Error: $PREFLIGHT_PARTIAL not found" >&2
  exit 1
}
tmp_preflight="$(mktemp "${TMPDIR:-/tmp}/ar-preflight.XXXXXX")"
# Canonical body: trim leading/trailing blank lines; end with exactly one newline.
awk 'NF{p=1} p' "$PREFLIGHT_PARTIAL" | awk '
  BEGIN { n = 0 }
  { lines[++n] = $0 }
  END {
    while (n > 0 && lines[n] == "") n--
    for (i = 1; i <= n; i++) print lines[i]
  }
' >"$tmp_preflight"
new_pf_hash="$(shasum -a 256 "$tmp_preflight" | awk '{print $1}')"

for d in "${skill_dirs[@]}"; do
  skill_md="${d}SKILL.md"
  if [[ ! -f "$skill_md" ]]; then
    echo "Missing: $skill_md" >&2
    drift=1
    continue
  fi
  if ! grep -q '<!-- BEGIN PREFLIGHT -->' "$skill_md" || ! grep -q '<!-- END PREFLIGHT -->' "$skill_md"; then
    echo "Error: Missing <!-- BEGIN PREFLIGHT --> / <!-- END PREFLIGHT --> markers in $skill_md" >&2
    drift=1
    continue
  fi
  tmp_existing="$(mktemp "${TMPDIR:-/tmp}/ar-pf-exist.XXXXXX")"
  awk '
    /<!-- BEGIN PREFLIGHT -->/ { in_block=1; next }
    /<!-- END PREFLIGHT -->/ { in_block=0; next }
    in_block { print }
  ' "$skill_md" | awk 'NF{p=1} p' | awk '
    BEGIN { n = 0 }
    { lines[++n] = $0 }
    END {
      while (n > 0 && lines[n] == "") n--
      for (i = 1; i <= n; i++) print lines[i]
    }
  ' >"$tmp_existing"
  existing_hash="$(shasum -a 256 "$tmp_existing" | awk '{print $1}')"
  rm -f "$tmp_existing"
  if [[ "$existing_hash" != "$new_pf_hash" ]]; then
    if [[ "$CHECK_ONLY" -eq 1 ]]; then
      echo "Out of sync: $skill_md preflight block differs from docs/partials/preflight.md" >&2
      drift=1
    else
      tmp_out="$(mktemp "${TMPDIR:-/tmp}/ar-pf-out.XXXXXX")"
      in_block=0
      while IFS= read -r line || [[ -n "$line" ]]; do
        if [[ "$line" == *"<!-- BEGIN PREFLIGHT -->"* ]]; then
          echo "$line"
          cat "$tmp_preflight"
          in_block=1
        elif [[ "$line" == *"<!-- END PREFLIGHT -->"* ]]; then
          in_block=0
          echo "$line"
        elif [[ $in_block -eq 0 ]]; then
          echo "$line"
        fi
      done <"$skill_md" >"$tmp_out"
      mv "$tmp_out" "$skill_md"
      echo "synced preflight into $skill_md"
    fi
  fi
done
rm -f "$tmp_preflight"

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  if [[ "$drift" -ne 0 ]]; then
    echo "sync-references --check failed" >&2
    exit 1
  fi
  echo "sync-references: all bundle references match their sources (no skill scripts/)"
fi
