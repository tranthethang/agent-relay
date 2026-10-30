Run `atry preflight --requires "<requires-atry>"` before any other command in this skill.
Copy the `requires-atry` front matter value into `--requires`, for example `>=0.10.7`.
Pass a `>=X.Y.Z` range only. Do not pass a skill name or subcommand such as `brainstorm`.
Treat the preflight exit code as the only version check. Do not compare version strings in prose.
Do not run `atry --version`. Run subcommand `atry version` only when the user needs the printed version.
Stop when that command exits non-zero. A dev build needs `--allow-dev` or `ATRY_DEV=1`; do not use a dev build for a real run.
When `atry` reports an unknown command, stop and tell the user to update `atry` from the README of `github.com/tranthethang/agent-relay`.
When this skill names a run, call `atry context <run> --json` first.
Read `references/file-conventions.md` before you edit a run file.
When the context JSON has `run.worktree`, edit files and run git in `run.worktree.path`.
A claim result with `worktree.path` takes precedence over `run.worktree.path`.
