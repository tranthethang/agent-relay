# Git Tree Capture

To ensure code attribution and prevent silent out-of-scope edits, the CLI captures Git working tree hashes at key lifecycle checkpoints (`src/core/git.ts`).

## Working Tree Hash Algorithm

Computing a git tree hash from the current working tree without committing:

1. Create a temporary copy of the Git index file (`.git/index`).
2. Point environment variable `GIT_INDEX_FILE` to the temporary index.
3. Update the temporary index with modified tracked files, explicitly excluding `.agent-relay/`.
4. Add untracked files that are not ignored by `.gitignore`.
5. Execute `git write-tree` to generate a verifiable Git tree object hash.
6. Delete the temporary index file.

## Checkpoint Captures

Working tree hashes are captured and recorded in `events.jsonl` at:

- `task start` (start tree)
- `stage done implement` (implementation completion tree)
- `review new` (review start tree)
- `review done` (reviewed code tree)
- `close` (final closed tree)
