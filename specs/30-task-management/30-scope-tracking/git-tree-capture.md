# Git Tree Capture

To ensure code attribution and prevent silent out-of-scope edits, the CLI captures Git working tree hashes at key lifecycle checkpoints (`src/core/git.ts`).

## Working Tree Hash Algorithm

Computing a git tree hash from the current working tree without committing:

1. Create a temporary copy of the Git index file (`.git/index`).
2. Point environment variable `GIT_INDEX_FILE` to the temporary index.
3. Create `<git-root>/.agent-relay/objects` when it is missing.
4. For `git add` and `git write-tree`, set `GIT_OBJECT_DIRECTORY` to `.agent-relay/objects`.
5. For those writes, set `GIT_ALTERNATE_OBJECT_DIRECTORIES` to the repo object directory.
6. Update the temporary index with modified tracked files, explicitly excluding `.agent-relay/`.
7. Add untracked files that are not ignored by `.gitignore`.
8. Execute `git write-tree` to generate a verifiable Git tree object hash.
9. Delete the temporary index file. Keep `.agent-relay/objects`.

New objects go to `.agent-relay/objects`. `.git` receives no new objects. Later diffs read `.agent-relay/objects` as an alternate. The repo object directory stays the primary store for those diffs.

## Checkpoint Captures

Working tree hashes are captured and recorded in `events.jsonl` at:

- `task start` (start tree)
- `stage done implement` (implementation completion tree)
- `review new` (review start tree)
- `review done` (reviewed code tree)
- `close` (final closed tree)
