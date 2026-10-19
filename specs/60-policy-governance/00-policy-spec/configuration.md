# Policy Configuration Specification

Repository governance policies are committed in `.agent-relay.json` at the root of the repository (`src/core/policy.ts`).

## Schema

```json
{
  "schema": 1,
  "requireReviews": ["self", "cross"],
  "smallChange": 20,
  "testCommand": "npm test"
}
```

## Policy Fields

| Field            | Type       | Default             | Description                                                                                           |
| ---------------- | ---------- | ------------------- | ----------------------------------------------------------------------------------------------------- |
| `requireReviews` | `string[]` | `["self", "cross"]` | Review kinds required before a run can be closed.                                                     |
| `smallChange`    | `number`   | `20`                | Combined line threshold (additions + deletions). Changes below this count require only `self` review. |
| `testCommand`    | `string`   | `undefined`         | Test command executed automatically during `atry review done`.                                        |
