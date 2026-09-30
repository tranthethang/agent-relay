#!/usr/bin/env bash
# scripts/runtime/diff-size.sh
# Shared change-size helpers for run-history.sh (size= snapshots on
# `completed`). Sourced, not executed. Read-only git
# (GIT_OPTIONAL_LOCKS=0). Bash 3.2+ compatible, POSIX tools only.

# diff_size_git_root <dir> -> nearest directory above <dir> with .git
diff_size_git_root() {
  local d="$1"
  while [[ "$d" != "/" ]]; do
    if [[ -d "$d/.git" || -f "$d/.git" ]]; then
      printf '%s\n' "$d"
      return 0
    fi
    d="$(dirname "$d")"
  done
  return 1
}

# diff_size_base <run-dir> <git-root> -> the ref change size is measured from:
# the first `head=` on an `implement started` line in history.log, else
# `base:` from plan.md / meta.md. Must resolve to a commit.
diff_size_base() {
  local run_dir="$1" git_root="$2" ref="" line tok f
  if [[ -f "$run_dir/history.log" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      case "$line" in
      *" stage=implement action=started "*)
        for tok in $line; do
          case "$tok" in head=*) ref="${tok#head=}" ;; esac
        done
        [[ -n "$ref" ]] && break
        ;;
      esac
    done <"$run_dir/history.log"
  fi
  if [[ -n "$ref" ]] && ! GIT_OPTIONAL_LOCKS=0 git -C "$git_root" rev-parse --verify "${ref}^{commit}" >/dev/null 2>&1; then
    ref=""
  fi
  if [[ -z "$ref" ]]; then
    for f in "$run_dir/plan.md" "$run_dir/meta.md"; do
      [[ -f "$f" ]] || continue
      ref="$(sed -n 's/^base:[[:space:]]*//p' "$f" | head -n 1 | sed -e 's/[[:space:]]*$//')"
      [[ -n "$ref" ]] && break
    done
  fi
  [[ -n "$ref" ]] || return 1
  GIT_OPTIONAL_LOCKS=0 git -C "$git_root" rev-parse --verify "${ref}^{commit}" 2>/dev/null
}

# diff_size <git-root> <base> [<end>] -> "files added deleted"
# With <end>: commit range base..end. Without: base vs the working tree.
# Excludes .agent-relay/. Binary entries count as a file, not as lines.
# Untracked files are not counted (git diff does not see them).
diff_size() {
  local git_root="$1" base="$2" end="${3:-}" added deleted path
  local files=0 add=0 del=0
  local -a range=("$base")
  [[ -n "$end" ]] && range=("$base" "$end")
  while IFS=$'\t' read -r added deleted path || [[ -n "${added:-}" ]]; do
    [[ -n "${path:-}" ]] || continue
    files=$((files + 1))
    case "$added" in *[!0-9]* | "") ;; *) add=$((add + added)) ;; esac
    case "$deleted" in *[!0-9]* | "") ;; *) del=$((del + deleted)) ;; esac
  done < <(GIT_OPTIONAL_LOCKS=0 git -C "$git_root" diff --numstat "${range[@]}" -- . ':(exclude).agent-relay' ':(exclude).agent-relay/**' 2>/dev/null || true)
  printf '%s %s %s\n' "$files" "$add" "$del"
}
