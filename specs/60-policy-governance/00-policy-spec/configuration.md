# Policy Configuration Specification

Repository governance policies are committed in `.agent-relay.json` at the root of the repository (`src/core/policy.ts`).

## Schema

```json
{
  "schema": 1,
  "requireReviews": ["self", "cross"],
  "smallChange": 20,
  "testCommand": "npm test",
  "worktree": { "enabled": false, "dir": "../wt" }
}
```

## Policy Fields

| Field              | Type       | Default                        | Description                                                                                           |
| ------------------ | ---------- | ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `requireReviews`   | `string[]` | `["self", "cross"]`            | Review kinds required before a run can be closed.                                                     |
| `smallChange`      | `number`   | `20`                           | Combined line threshold (additions + deletions). Changes below this count require only `self` review. |
| `testCommand`      | `string`   | `undefined`                    | Test command executed automatically during `atry review done`.                                        |
| `worktree.enabled` | `boolean`  | off when `worktree` is missing | When `true`, `run new` creates a git worktree and a branch for each run.                              |
| `worktree.dir`     | `string`   | `<repo>_work-tree`             | Optional and non-empty. The folder for run worktrees. A relative path resolves from the git root.     |

The `worktree` object is strict, so an unknown key in it fails validation.

## Worktree Settings

- `run new` reads policy at `HEAD`. An uncommitted policy change has no effect. Other commands read policy at the run `base`.
- With `worktree.enabled` set to `true`, `run new` creates `<dir>/<run name>` on a new branch named after the run. It fails with `gate` (exit `4`) on a detached `HEAD`, or when the branch or the path exists.
- The default `dir` is `<repo>_work-tree`, a sibling of the main repo folder.
- With worktree off, `stage start implement` requires a clean tree outside `.agent-relay/` and moves `base` to `HEAD`.
- See [`run-layout.md`](../../70-storage-and-git/00-directory-conventions/run-layout.md) for the `run.json` record and [`parallel.md`](../../70-storage-and-git/00-directory-conventions/parallel.md) for parallel runs.

## Policy Commands

- `atry policy init` writes `.agent-relay.json` at the git root. The content is the default policy plus `"worktree": { "enabled": false }`. The command fails with `gate` (exit `4`) when the file exists. It does not stage or commit the file.
- `atry policy check` validates `.agent-relay.json` in the working tree at the git root. It fails with `not_found` (exit `3`) when the file is missing. It fails with `validation` (exit `2`) and the same field path as run commands, such as `.agent-relay.json:worktree.enabled`.
- Both commands support `--json`. Neither command writes events.
