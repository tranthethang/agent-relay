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

## Option Details

Every option is read from `.agent-relay.json` at the run's `base` commit, except `worktree`, which `run new` reads at `HEAD`.
`atry policy check` validates the working tree copy before you commit it.

### `schema`

Must be `1`. Any other value fails validation with field `.agent-relay.json:schema`.

### `requireReviews`

- Lists the review kinds that `close` requires: `self`, `cross`, or both. The list is not empty and has no repeats.
- `close --preview` names each missing kind as `missing <kind> review`.
- `close` refuses a missing kind unless the person passes `--waive-review <reason>`, or `strict.reviewIntegrity` is `false` and `--via` is set.

### `smallChange`

- A whole number, `0` or more. It is compared with the added plus deleted lines from `base` to the current tree.
- When the change is smaller than `smallChange`, only `self` is required, even when `requireReviews` lists `cross`.
- `0` turns this off: every change needs every listed kind.

### `testCommand`

- Optional. When set, `review done` runs it at the repository root through the platform shell, without the run lock.
- The completed review event stores `exit`, `ms`, and the tree the tests started on. The last 200 output lines go to `<NN>.test.log`.
- A non-zero exit does not refuse `review done`. `close --preview` lists `failed tests` for the latest completed review.

### `worktree.enabled` and `worktree.dir`

- `enabled: true` gives each run its own worktree and branch. See Worktree Settings below.
- `dir` is optional. It cannot be the repository root or a folder inside the repository.

### `strict.scope`

Controls edits outside the task `files`.

| Command                         | `false` (default)                                   | `true`                                              |
| ------------------------------- | --------------------------------------------------- | --------------------------------------------------- |
| `atry task done`                | Records the outside paths as `extra` with a warning | Refuses with `gate` unless `--allow-extra <reason>` |
| `atry stage done implement`     | Records the outside paths as `extra` with a warning | Refuses with `gate` unless `--allow-extra <reason>` |
| `atry hook check` (Claude Code) | Returns `ask`, so the person decides                | Returns `deny`                                      |

### `strict.plan`

Controls plan size.

| Command                             | `false` (default)                                  | `true`                        |
| ----------------------------------- | -------------------------------------------------- | ----------------------------- |
| `atry plan done`, `atry plan amend` | Accepts more than eight tasks and prints a warning | Refuses more than eight tasks |

### `strict.reviewIntegrity`

Controls the review checks at `close`: missing reviews, a tree that differs from the latest review, changes after the latest review, open items, and failed tests.

| Command      | `false` (default)                                                                                             | `true`                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `atry close` | With `--via`, refuses and lists any warnings until `--ack-warnings` is present; then closes and stores the warnings in the `closed` event. Without `--via`, the checks still refuse. | Refuses until each check passes, or the person passes the matching flag |

`--ack-open` accepts open items. `--ack-fixes` accepts changes after the latest review. `--ack-warnings` accepts the warnings of a non-strict soft close; it does not bypass `strict.reviewIntegrity: true`. `--waive-review <reason>` records a waiver and skips the review checks, but not the open item check or the warning gate.

## Presets

`atry policy init --preset <name>` writes one of these files. The default is `standard`. Each preset passes `atry policy check`.

| Preset     | `requireReviews`    | `smallChange` | `strict.scope` | `strict.plan` | `strict.reviewIntegrity` | `worktree.enabled` |
| ---------- | ------------------- | ------------- | -------------- | ------------- | ------------------------ | ------------------ |
| `lenient`  | `["self"]`          | `100`         | `false`        | `false`       | `false`                  | `false`            |
| `standard` | `["self", "cross"]` | `20`          | `false`        | `false`       | `false`                  | `false`            |
| `strict`   | `["self", "cross"]` | `0`           | `true`         | `true`        | `true`                   | `false`            |

Use `lenient` for solo or exploratory work, `standard` for normal work, and `strict` when an agent works with little supervision.
A missing `.agent-relay.json` behaves like `standard` without the `worktree` key.

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

- `atry policy init [--preset lenient|standard|strict]` writes `.agent-relay.json` at the git root. The default `standard` content is the default policy plus `"worktree": { "enabled": false }`. An unknown preset fails with `usage` (exit `1`). The command fails with `gate` (exit `4`) when the file exists. It does not stage or commit the file.
- `atry policy check` validates `.agent-relay.json` in the working tree at the git root. It fails with `not_found` (exit `3`) when the file is missing. It fails with `validation` (exit `2`) and the same field path as run commands, such as `.agent-relay.json:worktree.enabled`.
- Both commands support `--json`. Neither command writes events.
