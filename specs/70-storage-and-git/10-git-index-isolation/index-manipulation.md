# Temporary Git Index Isolation

`workTree` in `src/core/git.ts` hashes the working tree without changing the user's index.

## Steps

1. Resolve the git toplevel and the path of `.git/index`.
2. Resolve the repo object directory with `git rev-parse --git-path objects`.
3. Copy that index into a temp directory named `atry-index-*`. If the index is missing, continue with an empty index.
4. Create `<git-root>/.agent-relay/objects` when it is missing.
5. Set `GIT_INDEX_FILE` to the temp index.
6. For `git add` and `git write-tree`, set `GIT_OBJECT_DIRECTORY` to `.agent-relay/objects`.
7. For those writes, set `GIT_ALTERNATE_OBJECT_DIRECTORIES` to the repo object directory.
8. Run `git add -u` for tracked paths, excluding `.agent-relay`.
9. Add untracked paths from `git ls-files --others --exclude-standard`, excluding `.agent-relay`.
10. Run `git write-tree` and return the hash.
11. Delete the temp directory. The temp index is removed with it. Keep `.agent-relay/objects`.

New objects go to `.agent-relay/objects`. `.git` receives no new objects. Later diffs read `.agent-relay/objects` as an alternate. The repo object directory stays the primary store for those diffs.

The hash is 40 hex characters on a SHA-1 repo and 64 hex characters on a SHA-256 repo. The command does not run `git add -A` or `git rm`.
