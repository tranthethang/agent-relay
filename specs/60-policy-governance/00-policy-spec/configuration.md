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
| `worktree.enabled` | `boolean`  | off when `worktree` is missing | Reserved for a later worktree plan. Only the type is validated.                                       |
| `worktree.dir`     | `string`   | `undefined`                    | Optional and non-empty. Reserved for a later worktree plan. Only the type is validated.               |

The `worktree` object is strict, so an unknown key in it fails validation. A later worktree plan defines what `worktree.enabled` and `worktree.dir` do. The current CLI does not read them.

## Policy Commands

- `atry policy init` writes `.agent-relay.json` at the git root. The content is the default policy plus `"worktree": { "enabled": false }`. The command fails with `gate` (exit `4`) when the file exists. It does not stage or commit the file.
- `atry policy check` validates `.agent-relay.json` in the working tree at the git root. It fails with `not_found` (exit `3`) when the file is missing. It fails with `validation` (exit `2`) and the same field path as run commands, such as `.agent-relay.json:worktree.enabled`.
- Both commands support `--json`. Neither command writes events.
