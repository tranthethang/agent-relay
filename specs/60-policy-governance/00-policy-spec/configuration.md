# Policy Configuration Specification

Repository governance policies are committed in `.agent-relay.json` at the root of the repository (`src/core/policy.ts`).

## Schema

```json
{
  "schema": 1,
  "requireReviews": ["self", "cross"],
  "smallChange": 20,
  "testCommand": "npm test",
  "worktree": { "enabled": false, "dir": "../wt" },
  "strict": { "scope": false, "plan": false, "reviewIntegrity": false }
}
```

## Policy Fields

| Field                    | Type       | Default                        | Description                                                                                                     |
| ------------------------ | ---------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `requireReviews`         | `string[]` | `["self", "cross"]`            | Review kinds required before a run can be closed.                                                               |
| `smallChange`            | `number`   | `20`                           | Combined line threshold (additions + deletions). Changes below this count require only `self` review.           |
| `testCommand`            | `string`   | `undefined`                    | Test command executed automatically during `atry review done`.                                                  |
| `worktree.enabled`       | `boolean`  | off when `worktree` is missing | When `true`, `run new` creates a git worktree and a branch for each run.                                        |
| `worktree.dir`           | `string`   | `<repo>_work-tree`             | Optional and non-empty. The folder for run worktrees. A relative path resolves from the git root.               |
| `strict.scope`           | `boolean`  | `false`                        | Block scope warnings when `true`; otherwise report them and continue when evidence can be preserved.            |
| `strict.plan`            | `boolean`  | `false`                        | Block plan warnings when `true`; otherwise report them and continue when evidence can be preserved.             |
| `strict.reviewIntegrity` | `boolean`  | `false`                        | Block review-integrity warnings when `true`; otherwise report them and continue when evidence can be preserved. |

The `worktree` object is strict, so an unknown key in it fails validation.
The `strict` object is strict, so an unknown key in it fails validation. Each
strict group defaults to `false` when omitted, including when the whole object
is omitted. Existing policy files remain valid.

## Worktree Settings

- Worktree isolation remains off by default.
- `run new` reads policy at `HEAD`. An uncommitted policy change has no effect. Other commands read policy at the run `base`.
- With `worktree.enabled` set to `true`, `run new` creates `<dir>/<run name>` on a new branch named after the run.
- `worktree.dir` cannot point to the repository root or any directory inside the repository. Both `atry policy check` and `atry run new` validate this restriction.
- The default `dir` is `<repo>_work-tree`, a sibling of the main repo folder.
- `run new` exclusively reserves the run directory name. A failure during setup rolls back the symlink, the worktree, and the branch.
- `stage start implement` validates that the registered worktree exists, is registered with Git, is not detached, and matches the run branch.
- With worktree off, `stage start implement` requires a clean tree outside `.agent-relay/` and moves `base` to `HEAD`.
- Ignored files remain outside this change. Merging and deleting run branches remain manual.
- See [`run-layout.md`](../../70-storage-and-git/00-directory-conventions/run-layout.md) for the `run.json` record and [`parallel.md`](../../70-storage-and-git/00-directory-conventions/parallel.md) for parallel runs.

## Policy Commands

- `atry policy init` writes `.agent-relay.json` at the git root. The content is the default policy plus `"worktree": { "enabled": false }`. The command fails with `gate` (exit `4`) when the file exists. It does not stage or commit the file.
- `atry policy check` validates `.agent-relay.json` in the working tree at the git root. It fails with `not_found` (exit `3`) when the file is missing. It fails with `validation` (exit `2`) and the same field path as run commands, such as `.agent-relay.json:worktree.enabled`.
- Both commands support `--json`. Neither command writes events.
