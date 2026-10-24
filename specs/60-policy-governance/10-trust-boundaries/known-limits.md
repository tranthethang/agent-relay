# Known limits

What `atry` does not prove or enforce. Trust levels are in
[`trust-levels.md`](trust-levels.md).

- The tree snapshot uses a temporary copy of the Git index and excludes
  `.agent-relay/`. It does not change the real index.
- When `run.json` differs from the replay of `events.jsonl`, `atry` takes the
  run lock, rebuilds it, and appends a `run` `drifted` event. `atry status`
  shows the count and `close --preview` lists it. An edit that changes both
  files the same way is not detected.
- Each event after the first has `prev`, the sha256 of the previous line. A
  plain edit, insert, or delete in `events.jsonl` fails the next read. The chain
  is not a signature: a writer who recomputes the hashes, or removes every
  `prev`, is not detected. Runs from before the chain still load.
- `locks/run.lock` serializes CLI state changes. It holds an owner token, and
  only the owner removes it. A stale lock (30 seconds) is removed by one process
  at a time. It does not lock direct file edits made outside `atry`.
- A review waiver is recorded with its reason. It does not prove who approved
  the waiver.
- Cross-review independence is a request. `atry review done` warns when the
  cross-review tool or model vendor matches implement or self-review. A
  second warning marks a matching model line. These warnings do not refuse.
- `tool` and `model` are agent claims locked to the review start. `detected`
  reports only supported environment markers; it does not prove which model
  generated the review. Currently, Codex detection uses `CODEX_THREAD_ID`.
- `approve` and `close` record `actor` as `agent-env` when a supported marker
  is present and `unknown` otherwise. `atry` does not claim a human approved.
- `--via confirm` records the agent's report that a person confirmed. It does
  not prove a person typed the answer. Tool approval prompts and bypass modes
  are outside this repo.
- `testCommand` comes from the policy at the run's base and runs through a
  platform shell at the repository root. Review completion records its result;
  a non-zero result does not itself refuse `review done`.
- `task done` refuses a changed path outside that task's `files` unless
  `--allow-extra <reason>` is set. `stage done implement` does the same for
  paths outside the union of task `files` and recorded `extra` paths.
- `claim` checks recorded file paths before work starts. It does not stop an
  edit while the task is in progress. `atry guard` can check one path. The
  Claude Code hook checks edits only after you install it, and only in Claude
  Code. Other tools and shell commands that write files are not checked. The
  hook ignores a path outside the git root of every implementing run, so a
  worktree run does not guard edits in the main tree. `atry guard` still
  reports a path outside the repo as not allowed.
- There is no migration from the bash CLI or from v1 run files.
- CI runs `npm test` on macOS, Linux, and Windows. It does not show that an
  agent follows a skill.
