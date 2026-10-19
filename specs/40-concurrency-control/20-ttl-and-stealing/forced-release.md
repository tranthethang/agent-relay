# Forced Lock Release

A human operator or supervising agent can forcibly release a task claim lock held by another session using `atry release --force` (`src/core/claim.ts`).

## Invocation

```bash
atry release <run> <task> --session <tag> --force --reason <text>
```

## Behavior

- Bypasses the session ownership verification.
- Requires `--reason <text>` explaining why the forced intervention was necessary.
- Unlinks `locks/<task>.lock`.
- Appends `action: "released"` with `reason` set to the text. The event has no `force` field.
