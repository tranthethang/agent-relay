# Temporary Git Index Isolation

`workTree` in `src/core/git.ts` hashes the working tree without changing the user's index.

## Steps

1. Resolve the git toplevel and the path of `.git/index`.
2. Copy that index into a temp directory named `atry-index-*`. If the index is missing, continue with an empty index.
3. Set `GIT_INDEX_FILE` to the temp index.
4. Run `git add -u` for tracked paths, excluding `.agent-relay`.
5. Add untracked paths from `git ls-files --others --exclude-standard`, excluding `.agent-relay`.
6. Run `git write-tree` and return the hash.
7. Delete the temp directory.

The hash is 40 hex characters on a SHA-1 repo and 64 hex characters on a SHA-256 repo. The command does not run `git add -A` or `git rm`.
