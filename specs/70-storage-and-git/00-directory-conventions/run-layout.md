# Run Directory Layout

A run directory encapsulates all metadata, scaffolds, task reports, and reviews for a specific workflow instance.

## Path Structure

`.agent-relay/{YMD}-{id}-{slug}/`

```text
.agent-relay/20261019-1792385260-specs-refactor-structure/
├── events.jsonl                 # Immutable source-of-truth event ledger
├── run.json                     # Rebuilt state snapshot cache
├── locks/                       # Mutex and claim locks
│   ├── run.lock                 # Mutex lock while mutating run state
│   └── T1.lock                  # Task claim lock held by an agent session
├── 10-plan/                     # Planning stage artifacts
│   ├── overview.md              # Goals, decisions, constraints
│   ├── tasks.input.json         # Draft tasks input
│   ├── index.json               # Final validated task DAG
│   └── T1.md ...                # Task descriptions
├── 20-implement/                # Implementation reports
│   └── T1.md ...                # Task implementation files, assumptions, risks
├── 30-self-review/              # Self-review reports and test logs
│   ├── 01.md                    # Review findings and question cards
│   ├── 01.json                  # Review metadata and open items
│   └── 01.test.log              # Captured test command output
├── 40-cross-review/             # Independent cross-review artifacts
│   ├── 01.md
│   └── 01.json
└── 90-distill/                  # Run export artifacts
    └── manifest.json            # SHA-256 integrity manifest
```

## Worktree Record

When policy at `HEAD` has `worktree.enabled` set to `true`, `run new` adds a `worktree` object to `run.json`:

```json
{ "worktree": { "path": "/abs/repo_work-tree/20261019-1792432125-worktree-isolation", "branch": "main" } }
```

- `path` is the absolute worktree path. Every git command for the run runs there.
- `branch` is the branch at `HEAD` before `run new`. `close` checks the merge against it.
- The object is strict. A run without it runs git from the run folder in the main repo.

`run new` reserves the run folder using exclusive directory creation. If run initialization fails, agent-relay rolls back the symlink, the worktree, and the branch.

The real `.agent-relay/` stays at the main repo root. Each worktree has `.agent-relay` as a link to it: a symlink on macOS and Linux, and a directory junction on Windows. The pattern `.agent-relay/` does not match a link, so the CLI appends the line `.agent-relay` to the shared `info/exclude` (under `git rev-parse --git-common-dir`) once.

`stage start implement` checks the worktree. It verifies that the directory exists, is registered with Git, is not detached, and matches the run branch.

`close` removes the worktree only after the run branch is merged into `branch` and the worktree has no uncommitted changes. It unlinks `.agent-relay` before removing the worktree. If removal fails, `close` preserves the closed run and reports `worktree: kept (<reason>)`. Successful removal appends a `cleaned` run event.

`atry worktree cleanup <run>` retries removal on a closed run. It applies the same safety checks and records the `cleaned` event.
